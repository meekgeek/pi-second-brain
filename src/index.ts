/**
 * 🧠 Second Brain Extension
 *
 * PARA-based knowledge management system for pi.
 * Automatically captures, organizes, and surfaces knowledge
 * using Tiago Forte's PARA method + daily notes.
 *
 * Lifecycle hooks:
 *   session_start       → Load daily note, show priorities widget, inject context
 *   before_agent_start  → Search knowledge base for relevant context
 *   agent_end           → Light extraction of key facts to daily note
 *   session_before_compact → Deep extraction before conversation is compacted
 *   session_shutdown    → Final consolidation, git commit, qmd re-index
 *
 * Commands: /brain, /capture, /daily, /search, /review, /priorities
 * Tools: second_brain_search, second_brain_capture, second_brain_daily
 * Shortcut: Ctrl+Shift+B → toggle brain dashboard
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Key, matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { readFileSync } from "node:fs";

import {
	BRAIN_DIR,
	ensureDirs,
	getCounts,
	listNotes,
	PARA_DIRS,
	PARA_ICONS,
	slugify,
	detectProject,
	type ParaCategory,
} from "./para.js";
import {
	ensureDailyNote,
	appendToLog,
	readDailyNote,
	getPriorities,
	listRecentDailies,
	appendToSection,
} from "./daily.js";
import {
	lightExtract,
	writeToDaily,
	buildDeepExtractionPrompt,
	parseDeepExtraction,
	writeDeepExtraction,
} from "./extractor.js";
import {
	DashboardComponent,
	type DashboardData,
	SearchResultsComponent,
	type SearchResult,
	buildPriorityWidget,
	buildStatusLine,
} from "./ui.js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── Helper: run qmd search ────────────────────────────────────────────

async function qmdSearch(pi: ExtensionAPI, query: string, maxResults = 5): Promise<SearchResult[]> {
	const { stdout, code } = await pi.exec("qmd", ["search", query, "-n", String(maxResults), "--json"], {
		timeout: 10000,
	});
	if (code !== 0 || !stdout.trim()) return [];

	try {
		const parsed = JSON.parse(stdout);
		const results: SearchResult[] = [];
		const items = Array.isArray(parsed) ? parsed : parsed.results ?? [];
		for (const item of items) {
			results.push({
				path: item.path ?? item.document ?? "",
				title: item.title ?? "",
				score: item.score != null ? `${Math.round(Number(item.score) * 100)}%` : "?",
				snippet: item.snippet ?? item.text ?? item.content ?? "",
			});
		}
		return results;
	} catch {
		// Fallback: parse text output
		return parseTextSearchResults(stdout);
	}
}

function parseTextSearchResults(output: string): SearchResult[] {
	const results: SearchResult[] = [];
	const blocks = output.split("\n\n");

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length === 0) continue;

		const pathLine = lines[0] ?? "";
		const pathMatch = pathLine.match(/^(qmd:\/\/[^\s]+)/);
		if (!pathMatch) continue;

		const titleLine = lines.find((l) => l.startsWith("Title:"));
		const scoreLine = lines.find((l) => l.startsWith("Score:"));
		const snippetLines = lines.filter(
			(l) =>
				!l.startsWith("Title:") &&
				!l.startsWith("Score:") &&
				!l.startsWith("Context:") &&
				l !== pathLine &&
				!l.startsWith("@@")
		);

		results.push({
			path: pathMatch[1],
			title: titleLine?.replace("Title:", "").trim() ?? "",
			score: scoreLine?.replace("Score:", "").trim() ?? "?",
			snippet: snippetLines.join("\n").trim(),
		});
	}

	return results;
}

async function qmdUpdate(pi: ExtensionAPI): Promise<void> {
	await pi.exec("qmd", ["update"], { timeout: 30000 });
}

// ─── Conversation serializer ───────────────────────────────────────────

type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

function buildConversationText(entries: SessionEntry[]): string {
	const parts: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const role = entry.message.role;
		if (role !== "user" && role !== "assistant") continue;

		const content = entry.message.content;
		let text = "";
		if (typeof content === "string") {
			text = content;
		} else if (Array.isArray(content)) {
			text = content
				.filter((c: any) => c?.type === "text")
				.map((c: any) => c.text ?? "")
				.join("\n");
		}
		if (text.trim()) {
			parts.push(`${role === "user" ? "User" : "Assistant"}: ${text.trim()}`);
		}
	}
	return parts.join("\n\n");
}

// ─── Main Extension ────────────────────────────────────────────────────

export default function secondBrain(pi: ExtensionAPI): void {
	// Ensure directory structure exists
	ensureDirs();

	let reindexQueued = false;

	// ─── Session Start ──────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Ensure today's daily note exists (with priority rollover)
		ensureDailyNote();

		// Update widgets
		updateWidgets(ctx);

		// Auto-name session based on project
		const project = detectProject(ctx.cwd);
		if (project) {
			const existing = pi.getSessionName();
			if (!existing) {
				pi.setSessionName(`🧠 ${project}`);
			}
		}
	});

	// Also update widgets on session switch/fork/tree
	pi.on("session_switch", async (_event, ctx) => updateWidgets(ctx));
	pi.on("session_fork", async (_event, ctx) => updateWidgets(ctx));
	pi.on("session_tree", async (_event, ctx) => updateWidgets(ctx));

	// ─── Before Agent Start: Inject Knowledge Context ───────────────

	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = event.prompt;
		if (!prompt || prompt.startsWith("/")) return; // Skip commands

		// Search knowledge base for relevant context
		const results = await qmdSearch(pi, prompt, 3);

		if (results.length === 0) return;

		// Build context injection
		const contextLines: string[] = [];
		contextLines.push("[Second Brain — Relevant Knowledge]");

		const project = detectProject(ctx.cwd);
		if (project) {
			contextLines.push(`Active project: ${project}`);
		}

		for (const r of results) {
			if (r.title) contextLines.push(`• ${r.title} (${r.score}): ${r.snippet.slice(0, 150).trim()}`);
		}

		contextLines.push("[End Second Brain Context]");

		return {
			systemPrompt: event.systemPrompt + "\n\n" + contextLines.join("\n"),
		};
	});

	// ─── Agent End: Light Extraction ────────────────────────────────

	pi.on("agent_end", async (event, ctx) => {
		try {
			const entries = event.messages as unknown as SessionEntry[];
			if (!entries || entries.length === 0) return;

			const knowledge = lightExtract(entries, ctx.cwd);
			const hasContent =
				knowledge.decisions.length > 0 ||
				knowledge.solutions.length > 0 ||
				knowledge.learnings.length > 0;

			if (hasContent) {
				writeToDaily(knowledge);
				reindexQueued = true;
			}
		} catch {
			// Silently fail — don't disrupt the user's work
		}
	});

	// ─── Session Before Compact: Deep Extraction ────────────────────

	pi.on("session_before_compact", async (event, ctx) => {
		try {
			const { preparation } = event;
			const { messagesToSummarize, turnPrefixMessages } = preparation;

			const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
			if (allMessages.length < 3) return; // Not enough to extract from

			const conversationText = serializeConversation(convertToLlm(allMessages));
			if (conversationText.length < 200) return;

			// Use current model for deep extraction
			const model = ctx.model;
			if (!model) return;

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) return;

			const extractionPrompt = buildDeepExtractionPrompt(conversationText, ctx.cwd);

			const response = await complete(
				model,
				{
					messages: [
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: extractionPrompt }],
							timestamp: Date.now(),
						},
					],
				},
				{ apiKey, maxTokens: 4096, signal: event.signal }
			);

			const responseText = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			const extraction = parseDeepExtraction(responseText);
			if (extraction) {
				writeDeepExtraction(extraction, ctx.cwd);
				reindexQueued = true;

				if (ctx.hasUI) {
					ctx.ui.notify("🧠 Knowledge captured before compaction", "info");
				}
			}
		} catch {
			// Don't block compaction if extraction fails
		}
	});

	// ─── Session Shutdown: Final Consolidation ──────────────────────

	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			appendToLog("Session ended.");

			// Re-index with qmd
			if (reindexQueued) {
				await qmdUpdate(pi);
			}

			// Git commit
			const { code: statusCode, stdout: status } = await pi.exec("git", ["-C", BRAIN_DIR, "status", "--porcelain"]);
			if (statusCode === 0 && status.trim().length > 0) {
				await pi.exec("git", ["-C", BRAIN_DIR, "add", "-A"]);
				const date = new Date().toISOString().split("T")[0];
				const project = detectProject(ctx.cwd) ?? "general";
				await pi.exec("git", [
					"-C",
					BRAIN_DIR,
					"commit",
					"-m",
					`[second-brain] ${date} — ${project} session`,
				]);
			}
		} catch {
			// Best effort
		}
	});

	// ─── Context Event: Prune Stale Brain Context ───────────────────

	pi.on("context", async (event) => {
		// Remove second-brain context messages from older turns to avoid bloat
		// Keep only the most recent one
		const messages = event.messages;
		let lastBrainIdx = -1;

		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i] as any;
			if (msg.customType === "second-brain-context") {
				if (lastBrainIdx === -1) {
					lastBrainIdx = i;
				} else {
					messages.splice(i, 1);
					lastBrainIdx--;
				}
			}
		}

		return { messages };
	});

	// ─── Custom Tools ───────────────────────────────────────────────

	pi.registerTool({
		name: "second_brain_search",
		label: "Brain Search",
		description:
			"Search the second brain knowledge base. Use this to find previously captured knowledge, decisions, solutions, and notes.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			maxResults: Type.Optional(Type.Number({ description: "Max results (default 5)" })),
		}),
		async execute(_toolCallId, params) {
			const results = await qmdSearch(pi, params.query, params.maxResults ?? 5);
			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No results found in second brain." }],
					details: { results: [] },
				};
			}

			const text = results
				.map((r) => `**${r.title}** (${r.score})\n${r.path}\n${r.snippet.slice(0, 200)}`)
				.join("\n\n");

			return {
				content: [{ type: "text", text }],
				details: { results },
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("brain search ")) + theme.fg("muted", `"${args.query}"`),
				0,
				0
			);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as { results: SearchResult[] } | undefined;
			const count = details?.results?.length ?? 0;
			let text = theme.fg("accent", "🧠 ") + theme.fg("muted", `${count} result(s)`);

			if (expanded && details?.results) {
				for (const r of details.results) {
					text += `\n  ${theme.fg("accent", r.title)} ${theme.fg("dim", `[${r.score}]`)}`;
					if (r.snippet) {
						text += `\n    ${theme.fg("dim", r.snippet.slice(0, 100).trim())}`;
					}
				}
			}
			return new Text(text, 0, 0);
		},
	});

	pi.registerTool({
		name: "second_brain_capture",
		label: "Brain Capture",
		description:
			"Capture a note to the second brain. Specify a category (inbox, projects, areas, resources) and title.",
		parameters: Type.Object({
			title: Type.String({ description: "Note title" }),
			content: Type.String({ description: "Note content (markdown)" }),
			category: Type.Optional(
				StringEnum(["inbox", "projects", "areas", "resources"] as const)
			),
		}),
		async execute(_toolCallId, params) {
			const category = (params.category ?? "inbox") as ParaCategory;
			const dir = PARA_DIRS[category];
			const slug = slugify(params.title);
			const filePath = join(dir, `${slug}.md`);

			mkdirSync(dir, { recursive: true });

			const date = new Date().toISOString().split("T")[0];
			const fileContent = `---\ntitle: ${params.title}\ncreated: ${date}\n---\n# ${params.title}\n\n${params.content}\n`;

			writeFileSync(filePath, fileContent, "utf-8");
			reindexQueued = true;

			return {
				content: [
					{
						type: "text",
						text: `Captured to ${PARA_ICONS[category]} ${category}: ${params.title}\nPath: ${filePath}`,
					},
				],
				details: { category, title: params.title, path: filePath },
			};
		},
		renderCall(args, theme) {
			const cat = (args.category as ParaCategory) ?? "inbox";
			const icon = PARA_ICONS[cat] ?? "📥";
			return new Text(
				theme.fg("toolTitle", theme.bold("brain capture ")) +
					`${icon} ` +
					theme.fg("muted", `"${args.title}"`),
				0,
				0
			);
		},
		renderResult(result, _options, theme) {
			const text = result.content[0];
			return new Text(theme.fg("success", "✓ ") + theme.fg("muted", text?.type === "text" ? text.text : ""), 0, 0);
		},
	});

	pi.registerTool({
		name: "second_brain_daily",
		label: "Brain Daily",
		description: "Read or append to today's daily note.",
		parameters: Type.Object({
			action: StringEnum(["read", "append_log", "append_notes", "append_decisions", "append_learned"] as const),
			content: Type.Optional(Type.String({ description: "Content to append (for append actions)" })),
		}),
		async execute(_toolCallId, params) {
			if (params.action === "read") {
				const content = readDailyNote();
				return {
					content: [{ type: "text", text: content }],
					details: { action: "read" },
				};
			}

			const sectionMap: Record<string, string> = {
				append_log: "Log",
				append_notes: "Notes",
				append_decisions: "Decisions",
				append_learned: "Learned",
			};

			const section = sectionMap[params.action];
			if (section && params.content) {
				if (params.action === "append_log") {
					appendToLog(params.content);
				} else {
					appendToSection(section, `- ${params.content}`);
				}
				reindexQueued = true;
				return {
					content: [{ type: "text", text: `Appended to ${section} in today's daily note.` }],
					details: { action: params.action, section },
				};
			}

			return {
				content: [{ type: "text", text: "No content provided for append action." }],
				details: { action: params.action, error: true },
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("brain daily ")) + theme.fg("muted", args.action),
				0,
				0
			);
		},
	});

	// ─── Commands ───────────────────────────────────────────────────

	pi.registerCommand("brain", {
		description: "Open the Second Brain dashboard",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/brain requires interactive mode", "error");
				return;
			}

			const counts = getCounts();
			const priorities = getPriorities();
			const allNotes = [
				...listNotes("projects"),
				...listNotes("areas"),
				...listNotes("resources"),
				...listNotes("inbox"),
			];
			const dailies = listRecentDailies();

			const data: DashboardData = {
				counts,
				priorities,
				recentNotes: allNotes.sort((a, b) => b.modified.getTime() - a.modified.getTime()).slice(0, 10),
				totalNotes: allNotes.length,
				dailyCount: dailies.length,
			};

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const dash = new DashboardComponent(data, theme, () => done());
				return {
					render: (w: number) => dash.render(w),
					invalidate: () => dash.invalidate(),
					handleInput: (d: string) => {
						dash.handleInput(d);
						tui.requestRender();
					},
				};
			});
		},
	});

	pi.registerCommand("capture", {
		description: "Quick capture a note to the second brain",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const categories: ParaCategory[] = ["inbox", "projects", "areas", "resources"];
			const labels = categories.map((c) => `${PARA_ICONS[c]} ${c.charAt(0).toUpperCase() + c.slice(1)}`);

			const choice = await ctx.ui.select("Capture to:", labels);
			if (!choice) return;

			const categoryIdx = labels.indexOf(choice);
			const category = categories[categoryIdx];

			const title = await ctx.ui.input("Note title:", "");
			if (!title?.trim()) return;

			const content = await ctx.ui.editor("Note content:", "");
			if (!content?.trim()) return;

			const slug = slugify(title);
			const dir = PARA_DIRS[category];
			const filePath = join(dir, `${slug}.md`);
			const date = new Date().toISOString().split("T")[0];

			mkdirSync(dir, { recursive: true });
			writeFileSync(
				filePath,
				`---\ntitle: ${title}\ncreated: ${date}\n---\n# ${title}\n\n${content}\n`,
				"utf-8"
			);
			reindexQueued = true;

			ctx.ui.notify(`${PARA_ICONS[category]} Captured: ${title}`, "success");
			updateWidgets(ctx);
		},
	});

	pi.registerCommand("daily", {
		description: "View today's daily note",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const content = readDailyNote();
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(
					new Text(theme.fg("accent", theme.bold("📅 Today's Daily Note")), 1, 0)
				);
				container.addChild(new Text("", 0, 0));

				// Show the note content (simplified, no full markdown rendering to avoid complexity)
				const noteLines = content.split("\n").map((line) => {
					if (line.startsWith("# ")) return theme.fg("accent", theme.bold(line));
					if (line.startsWith("## ")) return theme.fg("accent", line);
					if (line.startsWith("- [x]")) return theme.fg("success", "☑") + theme.fg("dim", line.slice(5));
					if (line.startsWith("- [ ]")) return theme.fg("muted", "☐") + theme.fg("text", line.slice(5));
					if (line.startsWith("- ")) return theme.fg("muted", "•") + theme.fg("text", line.slice(2));
					if (line.startsWith("<!--")) return "";
					return theme.fg("text", line);
				});

				container.addChild(new Text(noteLines.filter(Boolean).join("\n"), 1, 0));
				container.addChild(new Text("", 0, 0));
				container.addChild(new Text(theme.fg("dim", "Press Esc to close"), 1, 0));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (d: string) => {
						if (matchesKey(d, Key.escape)) done();
					},
				};
			});
		},
	});

	pi.registerCommand("search", {
		description: "Search the second brain knowledge base",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;

			let query = args?.trim();
			if (!query) {
				query = await ctx.ui.input("Search:", "");
				if (!query?.trim()) return;
			}

			ctx.ui.notify("🔍 Searching...", "info");
			const results = await qmdSearch(pi, query, 10);

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const comp = new SearchResultsComponent(
					results,
					theme,
					(result) => {
						ctx.ui.notify(`📄 ${result.title}\n${result.path}`, "info");
						done();
					},
					() => done()
				);
				return {
					render: (w: number) => comp.render(w),
					invalidate: () => comp.invalidate(),
					handleInput: (d: string) => {
						comp.handleInput(d);
						tui.requestRender();
					},
				};
			});
		},
	});

	pi.registerCommand("priorities", {
		description: "View, set, and toggle today's priorities",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const priorities = getPriorities();
			const hasPriorities = priorities.length > 0 && priorities.some((p) => p.text.trim() && p.text !== " ");

			if (!hasPriorities) {
				// No priorities — open editor to set them
				const input = await ctx.ui.editor(
					"Set today's priorities (one per line):",
					""
				);
				if (input?.trim()) {
					const lines = input
						.split("\n")
						.filter((l) => l.trim())
						.map((l) => `- [ ] ${l.trim()}`);
					writePriorities(lines);
					reindexQueued = true;
					ctx.ui.notify("✅ Priorities set!", "success");
					updateWidgets(ctx);
				}
			} else {
				// Interactive toggle UI
				await ctx.ui.custom<void>((tui, theme, _kb, done) => {
					let selected = 0;
					let items = [...priorities];

					function buildLines(width: number): string[] {
						const lines: string[] = [];
						lines.push("");
						const title = theme.fg("accent", theme.bold(" 📅 Priorities "));
						lines.push(
							truncateToWidth(
								theme.fg("borderAccent", "━".repeat(3)) + title + theme.fg("borderAccent", "━".repeat(Math.max(0, width - 20))),
								width
							)
						);
						lines.push("");

						const done = items.filter((p) => p.done).length;
						lines.push(truncateToWidth(`  ${theme.fg("muted", `${done}/${items.length} completed`)}`, width));
						lines.push("");

						for (let i = 0; i < items.length; i++) {
							const p = items[i];
							const pointer = i === selected ? theme.fg("accent", "▸ ") : "  ";
							const check = p.done ? theme.fg("success", "☑") : theme.fg("muted", "☐");
							const text = p.done
								? theme.fg("dim", theme.strikethrough(p.text))
								: theme.fg("text", p.text);
							lines.push(truncateToWidth(`${pointer}${check} ${text}`, width));
						}

						lines.push("");
						lines.push(truncateToWidth("  " + theme.fg("dim", "↑↓ navigate • Space/Enter toggle • a add • Esc close"), width));
						lines.push("");
						return lines;
					}

					let cachedLines: string[] | undefined;
					let cachedWidth: number | undefined;

					return {
						render: (w: number) => {
							if (cachedLines && cachedWidth === w) return cachedLines;
							cachedLines = buildLines(w);
							cachedWidth = w;
							return cachedLines;
						},
						invalidate: () => { cachedWidth = undefined; cachedLines = undefined; },
						handleInput: (data: string) => {
							if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
								done();
							} else if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
								selected = Math.max(0, selected - 1);
							} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
								selected = Math.min(items.length - 1, selected + 1);
							} else if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
								// Toggle the selected priority
								items[selected] = { ...items[selected], done: !items[selected].done };
								// Write back to daily note
								const lines = items.map((p) =>
									p.done ? `- [x] ${p.text}` : `- [ ] ${p.text}`
								);
								writePriorities(lines);
								reindexQueued = true;
								updateWidgets(ctx);
							} else if (data === "a") {
								// Can't open editor inside custom, so close and re-enter
								// For now, just notify
								ctx.ui.notify("Use /priorities when no priorities exist, or edit daily note directly", "info");
							}
							cachedWidth = undefined;
							cachedLines = undefined;
							tui.requestRender();
						},
					};
				});
			}
		},
	});

	/** Helper: write priority lines back to the daily note */
	function writePriorities(lines: string[]): void {
		const path = ensureDailyNote();
		const content = readFileSync(path, "utf-8");
		const fileLines = content.split("\n");
		let startIdx = -1;
		let endIdx = -1;

		for (let i = 0; i < fileLines.length; i++) {
			if (fileLines[i].startsWith("## Priorities")) {
				startIdx = i + 1;
			} else if (startIdx >= 0 && fileLines[i].startsWith("## ")) {
				endIdx = i;
				break;
			}
		}

		if (startIdx >= 0) {
			if (endIdx === -1) endIdx = fileLines.length;
			fileLines.splice(startIdx, endIdx - startIdx, ...lines, "");
			writeFileSync(path, fileLines.join("\n"), "utf-8");
		}
	}

	pi.registerCommand("review", {
		description: "Weekly review wizard — process inbox, review projects, update priorities",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			// Step 1: Process inbox
			const inboxNotes = listNotes("inbox");
			if (inboxNotes.length > 0) {
				ctx.ui.notify(`📥 Inbox has ${inboxNotes.length} item(s) to process`, "info");

				for (const note of inboxNotes.slice(0, 5)) {
					const content = readFileSync(note.path, "utf-8").slice(0, 300);
					const choice = await ctx.ui.select(
						`${note.title}\n${content.slice(0, 100)}...`,
						[
							"📦 Move to Projects",
							"🔄 Move to Areas",
							"📚 Move to Resources",
							"🗄️ Archive",
							"⏭️ Skip",
							"❌ Stop reviewing",
						]
					);

					if (!choice || choice.startsWith("❌")) break;
					if (choice.startsWith("⏭️")) continue;

					const targetMap: Record<string, ParaCategory> = {
						"📦": "projects",
						"🔄": "areas",
						"📚": "resources",
						"🗄️": "archive",
					};
					const icon = choice.slice(0, 2);
					const target = targetMap[icon];
					if (target) {
						const targetDir = PARA_DIRS[target];
						const { code } = await pi.exec("mv", [note.path, join(targetDir, note.name + ".md")]);
						if (code === 0) {
							ctx.ui.notify(`Moved to ${target}: ${note.title}`, "success");
						}
					}
				}
			} else {
				ctx.ui.notify("📥 Inbox is empty — nothing to process!", "success");
			}

			// Step 2: Review active projects
			const projects = listNotes("projects");
			if (projects.length > 0) {
				const archiveChoice = await ctx.ui.select(
					"Any projects to archive?",
					[...projects.map((p) => p.title), "None — all active"]
				);
				if (archiveChoice && archiveChoice !== "None — all active") {
					const project = projects.find((p) => p.title === archiveChoice);
					if (project) {
						await pi.exec("mv", [project.path, join(PARA_DIRS.archive, project.name + ".md")]);
						ctx.ui.notify(`Archived: ${project.title}`, "success");
					}
				}
			}

			// Step 3: Set tomorrow's priorities
			const setPriorities = await ctx.ui.confirm(
				"Set priorities?",
				"Would you like to set priorities for your next session?"
			);
			if (setPriorities) {
				const input = await ctx.ui.editor("Priorities (one per line):", "");
				if (input?.trim()) {
					appendToSection(
						"Notes",
						`**Next session priorities:**\n${input
							.split("\n")
							.filter((l) => l.trim())
							.map((l) => `- [ ] ${l.trim()}`)
							.join("\n")}`
					);
				}
			}

			// Final stats
			const counts = getCounts();
			ctx.ui.notify(
				`📊 Review Complete!\n📦 ${counts.projects} projects • 🔄 ${counts.areas} areas • 📚 ${counts.resources} resources • 📥 ${counts.inbox} inbox • 🗄️ ${counts.archive} archived`,
				"success"
			);

			reindexQueued = true;
			updateWidgets(ctx);
		},
	});

	// ─── Keyboard Shortcut ──────────────────────────────────────────

	pi.registerShortcut(Key.ctrlShift("b"), {
		description: "Toggle Second Brain dashboard",
		handler: async (ctx) => {
			// Trigger the /brain command
			pi.sendUserMessage("/brain");
		},
	});

	// ─── Custom Message Renderer ────────────────────────────────────

	pi.registerMessageRenderer("second-brain-capture", (message, options, theme) => {
		const icon = theme.fg("accent", "🧠 ");
		let text = icon + theme.fg("accent", theme.bold("Knowledge Captured"));
		text += "\n" + theme.fg("text", String(message.content));

		if (options.expanded && message.details) {
			text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
		}

		return new Text(text, 0, 0);
	});

	// ─── Widget & Status Updates ────────────────────────────────────

	function updateWidgets(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		const theme = ctx.ui.theme;

		// Priority widget above editor
		const priorities = getPriorities();
		const widgetLines = buildPriorityWidget(priorities, theme);
		if (widgetLines.length > 0) {
			ctx.ui.setWidget("second-brain-priorities", widgetLines);
		} else {
			ctx.ui.setWidget("second-brain-priorities", undefined);
		}

		// Status line in footer
		const counts = getCounts();
		const totalNotes =
			counts.projects + counts.areas + counts.resources + counts.inbox + counts.archive;
		const statusText = buildStatusLine(totalNotes, counts.inbox, theme);
		ctx.ui.setStatus("second-brain", statusText);
	}
}
