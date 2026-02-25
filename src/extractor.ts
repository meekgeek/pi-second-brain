/**
 * Knowledge Extractor
 *
 * Extracts important information from conversation messages.
 * Two modes:
 *   - Light extraction (agent_end): fast heuristic scan for key facts
 *   - Deep extraction (session_before_compact / shutdown): LLM-powered full analysis
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { BRAIN_DIR, INBOX_DIR, PROJECTS_DIR, RESOURCES_DIR, slugify, detectProject } from "./para.js";
import { appendToLog, appendToSection } from "./daily.js";

interface ExtractedKnowledge {
	decisions: string[];
	solutions: string[];
	learnings: string[];
	todos: string[];
	commands: string[];
	projectContext?: string;
}

type ContentBlock = {
	type?: string;
	text?: string;
};

type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

/** Extract text from message content */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is ContentBlock => c && typeof c === "object" && c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

/** Light extraction: scan conversation text with heuristics */
export function lightExtract(entries: SessionEntry[], cwd: string): ExtractedKnowledge {
	const result: ExtractedKnowledge = {
		decisions: [],
		solutions: [],
		learnings: [],
		todos: [],
		commands: [],
		projectContext: detectProject(cwd),
	};

	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const text = extractText(entry.message.content);
		if (!text) continue;

		const lines = text.split("\n");
		for (const line of lines) {
			const lower = line.toLowerCase().trim();

			// Decisions
			if (
				/\b(decided|going with|let's (go with|use|do)|we('ll| will) (use|go))\b/i.test(line) &&
				line.length > 15 &&
				line.length < 300
			) {
				result.decisions.push(line.trim());
			}

			// Solutions (error → fix pattern)
			if (
				/\b(fix(ed)?|solv(ed|e)|resolv(ed|e)|the (issue|problem|error) was|workaround)\b/i.test(line) &&
				line.length > 15 &&
				line.length < 300
			) {
				result.solutions.push(line.trim());
			}

			// Learnings
			if (
				/\b(turns out|TIL|learned|discovered|important(ly)?:?\s|note:?\s|key (insight|takeaway))\b/i.test(line) &&
				line.length > 10 &&
				line.length < 300
			) {
				result.learnings.push(line.trim());
			}

			// TODOs
			if (
				/\b(TODO|FIXME|need to|should (also )?|remember to|don't forget)\b/i.test(line) &&
				line.length > 10 &&
				line.length < 200
			) {
				result.todos.push(line.trim());
			}

			// Useful commands
			if (
				entry.message.role === "assistant" &&
				/^```/.test(line.trim()) === false &&
				/^\$?\s*(npm |yarn |pnpm |brew |go |cargo |pip |terraform |aws |gcloud |kubectl |docker |git )/.test(
					line.trim()
				) &&
				line.length < 200
			) {
				result.commands.push(line.trim());
			}
		}
	}

	// Deduplicate
	result.decisions = [...new Set(result.decisions)].slice(0, 5);
	result.solutions = [...new Set(result.solutions)].slice(0, 5);
	result.learnings = [...new Set(result.learnings)].slice(0, 5);
	result.todos = [...new Set(result.todos)].slice(0, 5);
	result.commands = [...new Set(result.commands)].slice(0, 5);

	return result;
}

/** Write light extraction results to daily note */
export function writeToDaily(knowledge: ExtractedKnowledge): void {
	const parts: string[] = [];

	if (knowledge.projectContext) {
		parts.push(`Working on **${knowledge.projectContext}**`);
	}

	const items: string[] = [];
	if (knowledge.decisions.length > 0) items.push(`${knowledge.decisions.length} decision(s)`);
	if (knowledge.solutions.length > 0) items.push(`${knowledge.solutions.length} solution(s)`);
	if (knowledge.learnings.length > 0) items.push(`${knowledge.learnings.length} learning(s)`);
	if (items.length > 0) parts.push(items.join(", "));

	if (parts.length > 0) {
		appendToLog(parts.join(". "));
	}

	// Write decisions
	for (const d of knowledge.decisions) {
		appendToSection("Decisions", `- ${d}`);
	}

	// Write learnings
	for (const l of knowledge.learnings) {
		appendToSection("Learned", `- ${l}`);
	}
}

/** Build the LLM prompt for deep extraction */
export function buildDeepExtractionPrompt(conversationText: string, cwd: string): string {
	const project = detectProject(cwd) ?? basename(cwd);
	return `You are a knowledge extraction assistant. Analyze this conversation and extract structured knowledge.

Current project context: ${project}
Working directory: ${cwd}

Extract the following as JSON (use empty arrays if none found):

{
  "summary": "2-3 sentence summary of what was accomplished",
  "decisions": ["key decisions made and their rationale"],
  "solutions": ["problems encountered and how they were solved"],
  "learnings": ["new knowledge, patterns, or insights discovered"],
  "todos": ["action items or things to follow up on"],
  "commands": ["useful commands or patterns worth remembering"],
  "projectNotes": "any notes specific to the current project",
  "resourceTopics": ["topics that deserve their own resource note, e.g. 'terraform state locking'"]
}

<conversation>
${conversationText}
</conversation>

Respond with ONLY the JSON object, no markdown fences.`;
}

/** Parse the LLM deep extraction response */
export interface DeepExtraction {
	summary: string;
	decisions: string[];
	solutions: string[];
	learnings: string[];
	todos: string[];
	commands: string[];
	projectNotes: string;
	resourceTopics: string[];
}

export function parseDeepExtraction(response: string): DeepExtraction | null {
	try {
		// Strip markdown fences if present
		const cleaned = response.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "");
		return JSON.parse(cleaned);
	} catch {
		return null;
	}
}

/** Write deep extraction results to the knowledge base */
export function writeDeepExtraction(extraction: DeepExtraction, cwd: string): void {
	const project = detectProject(cwd) ?? basename(cwd);

	// Update daily note with summary
	appendToLog(`Session summary: ${extraction.summary}`);

	for (const d of extraction.decisions) {
		appendToSection("Decisions", `- ${d}`);
	}
	for (const l of extraction.learnings) {
		appendToSection("Learned", `- ${l}`);
	}

	// Update project note if it exists
	if (extraction.projectNotes) {
		const projectPath = join(PROJECTS_DIR, `${slugify(project)}.md`);
		if (existsSync(projectPath)) {
			const content = readFileSync(projectPath, "utf-8");
			const date = new Date().toISOString().split("T")[0];
			const note = `- ${date}: ${extraction.projectNotes}`;

			if (content.includes("## Progress")) {
				const lines = content.split("\n");
				const idx = lines.findIndex((l) => l.startsWith("## Progress"));
				if (idx >= 0) {
					// Find the insertion point (after header, skip blanks)
					let insertIdx = idx + 1;
					while (insertIdx < lines.length && lines[insertIdx].trim() === "") insertIdx++;
					lines.splice(insertIdx, 0, note);
					writeFileSync(projectPath, lines.join("\n"), "utf-8");
				}
			}
		}
	}

	// Create resource stubs for new topics
	for (const topic of extraction.resourceTopics) {
		const slug = slugify(topic);
		const resourcePath = join(RESOURCES_DIR, `${slug}.md`);
		if (!existsSync(resourcePath)) {
			const date = new Date().toISOString().split("T")[0];
			const content = `---\ntitle: ${topic}\ncreated: ${date}\ntags: []\n---\n# ${topic}\n\n## Summary\n*Auto-created from conversation. Needs expansion.*\n\n## Key Points\n\n## Related\n`;
			writeFileSync(resourcePath, content, "utf-8");
		}
	}

	// Write solutions and commands to inbox for later categorization
	const items: string[] = [];
	for (const s of extraction.solutions) items.push(`- **Solution:** ${s}`);
	for (const c of extraction.commands) items.push(`- **Command:** \`${c}\``);
	for (const t of extraction.todos) items.push(`- **TODO:** ${t}`);

	if (items.length > 0) {
		const date = new Date().toISOString().split("T")[0];
		const time = new Date().toTimeString().split(" ")[0];
		const inboxPath = join(INBOX_DIR, `session-${date}-${time.replace(/:/g, "")}.md`);
		const content = `---\ncaptured: ${date}\nproject: ${project}\n---\n# Session Capture: ${project}\n\n${items.join("\n")}\n`;
		mkdirSync(INBOX_DIR, { recursive: true });
		writeFileSync(inboxPath, content, "utf-8");
	}
}
