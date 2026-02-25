/**
 * Daily Note Management
 *
 * Auto-creates daily notes, appends log entries, rolls up priorities.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DAILY_DIR, TEMPLATES_DIR, ensureDirs } from "./para.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

function formatDate(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fullDate(d: Date): string {
	return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function dayName(d: Date): string {
	return DAYS[d.getDay()];
}

/** Get the path for a daily note */
export function dailyPath(date?: Date): string {
	const d = date ?? new Date();
	return join(DAILY_DIR, `${formatDate(d)}.md`);
}

/** Ensure today's daily note exists. Creates from template if not. */
export function ensureDailyNote(date?: Date): string {
	ensureDirs();
	const d = date ?? new Date();
	const path = dailyPath(d);

	if (existsSync(path)) return path;

	// Load template
	const templatePath = join(TEMPLATES_DIR, "daily.md");
	let content: string;
	if (existsSync(templatePath)) {
		content = readFileSync(templatePath, "utf-8")
			.replace(/\{\{DATE\}\}/g, formatDate(d))
			.replace(/\{\{DAY_NAME\}\}/g, dayName(d))
			.replace(/\{\{FULL_DATE\}\}/g, fullDate(d));
	} else {
		content = `---\ndate: ${formatDate(d)}\n---\n# ${dayName(d)}, ${fullDate(d)}\n\n## Priorities\n- [ ] \n\n## Log\n\n## Notes\n\n## Decisions\n\n## Learned\n`;
	}

	// Roll up incomplete priorities from yesterday
	const yesterday = new Date(d);
	yesterday.setDate(yesterday.getDate() - 1);
	const yesterdayPath = dailyPath(yesterday);
	if (existsSync(yesterdayPath)) {
		const yesterdayContent = readFileSync(yesterdayPath, "utf-8");
		const incomplete = extractIncompletePriorities(yesterdayContent);
		if (incomplete.length > 0) {
			const prioritiesSection = incomplete.map((p) => `- [ ] ${p} *(rolled over)*`).join("\n");
			content = content.replace("- [ ] \n", prioritiesSection + "\n- [ ] \n");
		}
	}

	writeFileSync(path, content, "utf-8");
	return path;
}

/** Extract incomplete priorities from a daily note */
function extractIncompletePriorities(content: string): string[] {
	const lines = content.split("\n");
	const priorities: string[] = [];
	let inPriorities = false;

	for (const line of lines) {
		if (line.startsWith("## Priorities")) {
			inPriorities = true;
			continue;
		}
		if (inPriorities && line.startsWith("## ")) break;
		if (inPriorities) {
			const match = line.match(/^-\s+\[\s\]\s+(.+)/);
			if (match && match[1].trim()) {
				// Don't roll over empty or placeholder items
				priorities.push(match[1].replace(/\s*\*\(rolled over\)\*\s*$/, ""));
			}
		}
	}
	return priorities;
}

/** Append a timestamped entry to the Log section of today's note */
export function appendToLog(entry: string, date?: Date): void {
	const path = ensureDailyNote(date);
	const content = readFileSync(path, "utf-8");

	const now = new Date();
	const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	const logEntry = `- ${time} — ${entry}`;

	// Insert after "## Log" line
	const lines = content.split("\n");
	let insertIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith("## Log")) {
			// Find first non-empty, non-comment line after Log header, or the next section
			insertIndex = i + 1;
			// Skip blank lines and HTML comments right after the header
			while (insertIndex < lines.length) {
				const ln = lines[insertIndex];
				if (ln.startsWith("## ") && !ln.startsWith("## Log")) break;
				if (ln.startsWith("<!-- ")) {
					insertIndex++;
					continue;
				}
				if (ln.trim() === "") {
					insertIndex++;
					continue;
				}
				break;
			}
			break;
		}
	}

	if (insertIndex === -1) {
		// No Log section, append at end
		writeFileSync(path, content + "\n" + logEntry + "\n", "utf-8");
	} else {
		lines.splice(insertIndex, 0, logEntry);
		writeFileSync(path, lines.join("\n"), "utf-8");
	}
}

/** Append content to a specific section of today's note */
export function appendToSection(section: string, content: string, date?: Date): void {
	const path = ensureDailyNote(date);
	const fileContent = readFileSync(path, "utf-8");
	const lines = fileContent.split("\n");

	let insertIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith(`## ${section}`)) {
			insertIndex = i + 1;
			// Skip blanks/comments
			while (insertIndex < lines.length) {
				const ln = lines[insertIndex];
				if (ln.startsWith("## ") && !ln.startsWith(`## ${section}`)) break;
				if (ln.startsWith("<!-- ")) {
					insertIndex++;
					continue;
				}
				if (ln.trim() === "") {
					insertIndex++;
					continue;
				}
				break;
			}
			break;
		}
	}

	if (insertIndex >= 0) {
		lines.splice(insertIndex, 0, content);
		writeFileSync(path, lines.join("\n"), "utf-8");
	}
}

/** Read today's daily note content */
export function readDailyNote(date?: Date): string {
	const path = ensureDailyNote(date);
	return readFileSync(path, "utf-8");
}

/** Get priorities from today's note */
export function getPriorities(date?: Date): Array<{ text: string; done: boolean }> {
	const content = readDailyNote(date);
	const lines = content.split("\n");
	const priorities: Array<{ text: string; done: boolean }> = [];
	let inPriorities = false;

	for (const line of lines) {
		if (line.startsWith("## Priorities")) {
			inPriorities = true;
			continue;
		}
		if (inPriorities && line.startsWith("## ")) break;
		if (inPriorities) {
			const doneMatch = line.match(/^-\s+\[x\]\s+(.+)/i);
			const todoMatch = line.match(/^-\s+\[\s\]\s+(.+)/);
			if (doneMatch) priorities.push({ text: doneMatch[1], done: true });
			else if (todoMatch && todoMatch[1].trim()) priorities.push({ text: todoMatch[1], done: false });
		}
	}
	return priorities;
}

/** List recent daily notes */
export function listRecentDailies(count: number = 7): string[] {
	if (!existsSync(DAILY_DIR)) return [];
	return readdirSync(DAILY_DIR)
		.filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
		.sort()
		.reverse()
		.slice(0, count);
}
