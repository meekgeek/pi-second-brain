/**
 * TUI Components for Second Brain
 *
 * Dashboard, search, review wizard, and custom renderers.
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Key, Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { ParaCategory, NoteInfo } from "./para.js";
import { PARA_ICONS, getCounts, listNotes } from "./para.js";

// ─── Dashboard Component ───────────────────────────────────────────────

export interface DashboardData {
	counts: Record<ParaCategory, number>;
	priorities: Array<{ text: string; done: boolean }>;
	recentNotes: NoteInfo[];
	totalNotes: number;
	dailyCount: number;
}

export class DashboardComponent {
	private data: DashboardData;
	private theme: Theme;
	private onClose: () => void;
	private selectedSection = 0;
	private sections = ["overview", "projects", "areas", "resources", "inbox"];
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(data: DashboardData, theme: Theme, onClose: () => void) {
		this.data = data;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
			this.onClose();
		} else if (matchesKey(data, Key.left) || matchesKey(data, "h")) {
			this.selectedSection = Math.max(0, this.selectedSection - 1);
			this.invalidate();
		} else if (matchesKey(data, Key.right) || matchesKey(data, "l")) {
			this.selectedSection = Math.min(this.sections.length - 1, this.selectedSection + 1);
			this.invalidate();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const th = this.theme;
		const lines: string[] = [];

		// Header
		lines.push("");
		const title = th.fg("accent", th.bold(" 🧠 Second Brain "));
		const borderLine =
			th.fg("borderAccent", "━".repeat(3)) + title + th.fg("borderAccent", "━".repeat(Math.max(0, width - 22)));
		lines.push(truncateToWidth(borderLine, width));
		lines.push("");

		// Tab bar
		const tabs = this.sections.map((s, i) => {
			const label = s.charAt(0).toUpperCase() + s.slice(1);
			return i === this.selectedSection ? th.bg("selectedBg", th.fg("accent", ` ${label} `)) : th.fg("dim", ` ${label} `);
		});
		lines.push(truncateToWidth("  " + tabs.join(th.fg("borderMuted", "│")), width));
		lines.push(truncateToWidth("  " + th.fg("borderMuted", "─".repeat(Math.max(0, width - 4))), width));
		lines.push("");

		const section = this.sections[this.selectedSection];

		if (section === "overview") {
			this.renderOverview(lines, width, th);
		} else {
			this.renderCategoryDetail(lines, width, th, section as ParaCategory);
		}

		// Footer
		lines.push("");
		lines.push(
			truncateToWidth(
				"  " + th.fg("dim", "← → navigate sections • q/Esc close"),
				width
			)
		);
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderOverview(lines: string[], width: number, th: Theme): void {
		// Stats bar
		const cats: ParaCategory[] = ["projects", "areas", "resources", "inbox", "archive"];
		for (const cat of cats) {
			const icon = PARA_ICONS[cat];
			const count = this.data.counts[cat];
			const label = cat.charAt(0).toUpperCase() + cat.slice(1);
			const countColor = cat === "inbox" && count > 0 ? "warning" : "accent";
			lines.push(
				truncateToWidth(
					`  ${icon} ${th.fg("text", label)}: ${th.fg(countColor, String(count))}`,
					width
				)
			);
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("accent", th.bold("📅 Today's Priorities"))}`, width));

		if (this.data.priorities.length === 0) {
			lines.push(truncateToWidth(`    ${th.fg("dim", "No priorities set. Use /priorities to add some.")}`, width));
		} else {
			for (const p of this.data.priorities) {
				const check = p.done ? th.fg("success", "☑") : th.fg("muted", "☐");
				const text = p.done ? th.fg("dim", th.strikethrough(p.text)) : th.fg("text", p.text);
				lines.push(truncateToWidth(`    ${check} ${text}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("accent", th.bold("📝 Recent Notes"))}`, width));
		const recent = this.data.recentNotes.slice(0, 5);
		if (recent.length === 0) {
			lines.push(truncateToWidth(`    ${th.fg("dim", "No notes yet.")}`, width));
		} else {
			for (const note of recent) {
				const icon = PARA_ICONS[note.category];
				const age = this.timeAgo(note.modified);
				lines.push(
					truncateToWidth(
						`    ${icon} ${th.fg("text", note.title)} ${th.fg("dim", `(${age})`)}`,
						width
					)
				);
			}
		}

		// Total stats
		lines.push("");
		const total = th.fg("dim", `Total: ${this.data.totalNotes} notes • ${this.data.dailyCount} daily entries`);
		lines.push(truncateToWidth(`  ${total}`, width));
	}

	private renderCategoryDetail(lines: string[], width: number, th: Theme, category: ParaCategory): void {
		const icon = PARA_ICONS[category];
		const label = category.charAt(0).toUpperCase() + category.slice(1);
		lines.push(truncateToWidth(`  ${icon} ${th.fg("accent", th.bold(label))}`, width));
		lines.push("");

		const notes = listNotes(category);
		if (notes.length === 0) {
			lines.push(truncateToWidth(`    ${th.fg("dim", `No ${category} notes yet.`)}`, width));
		} else {
			for (const note of notes.slice(0, 15)) {
				const age = this.timeAgo(note.modified);
				lines.push(
					truncateToWidth(
						`    ${th.fg("muted", "•")} ${th.fg("text", note.title)} ${th.fg("dim", `(${age})`)}`,
						width
					)
				);
			}
			if (notes.length > 15) {
				lines.push(truncateToWidth(`    ${th.fg("dim", `... and ${notes.length - 15} more`)}`, width));
			}
		}
	}

	private timeAgo(date: Date): string {
		const ms = Date.now() - date.getTime();
		const mins = Math.floor(ms / 60000);
		if (mins < 1) return "just now";
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ─── Search Results Component ──────────────────────────────────────────

export interface SearchResult {
	path: string;
	title: string;
	score: string;
	snippet: string;
}

export class SearchResultsComponent {
	private results: SearchResult[];
	private theme: Theme;
	private selected = 0;
	private onClose: () => void;
	private onSelect: (result: SearchResult) => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		results: SearchResult[],
		theme: Theme,
		onSelect: (r: SearchResult) => void,
		onClose: () => void
	) {
		this.results = results;
		this.theme = theme;
		this.onSelect = onSelect;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onClose();
		} else if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
			this.selected = Math.max(0, this.selected - 1);
			this.invalidate();
		} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
			this.selected = Math.min(this.results.length - 1, this.selected + 1);
			this.invalidate();
		} else if (matchesKey(data, Key.enter)) {
			if (this.results[this.selected]) {
				this.onSelect(this.results[this.selected]);
			}
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const th = this.theme;
		const lines: string[] = [];

		lines.push("");
		const title = th.fg("accent", th.bold(" 🔍 Search Results "));
		lines.push(
			truncateToWidth(
				th.fg("borderAccent", "━".repeat(3)) + title + th.fg("borderAccent", "━".repeat(Math.max(0, width - 24))),
				width
			)
		);
		lines.push("");

		if (this.results.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No results found.")}`, width));
		} else {
			for (let i = 0; i < this.results.length && i < 15; i++) {
				const r = this.results[i];
				const prefix = i === this.selected ? th.fg("accent", "▸ ") : "  ";
				const titleText =
					i === this.selected ? th.fg("accent", r.title) : th.fg("text", r.title);
				const score = th.fg("dim", `[${r.score}]`);
				lines.push(truncateToWidth(`${prefix}${titleText} ${score}`, width));

				const snippet = r.snippet.split("\n")[0] ?? "";
				if (snippet.trim()) {
					lines.push(truncateToWidth(`    ${th.fg("muted", snippet.trim().slice(0, 80))}`, width));
				}
				lines.push("");
			}
		}

		lines.push(
			truncateToWidth(
				"  " + th.fg("dim", "↑↓ navigate • Enter view • Esc close"),
				width
			)
		);
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ─── Priority Widget ───────────────────────────────────────────────────

export function buildPriorityWidget(
	priorities: Array<{ text: string; done: boolean }>,
	theme: Theme
): string[] {
	if (priorities.length === 0) return [];

	const lines: string[] = [];
	const header = theme.fg("accent", "📅 ") + theme.fg("dim", "Priorities:");
	lines.push(header);

	for (const p of priorities.slice(0, 3)) {
		const check = p.done ? theme.fg("success", "☑") : theme.fg("muted", "☐");
		const text = p.done ? theme.fg("dim", theme.strikethrough(p.text)) : theme.fg("text", p.text);
		lines.push(`  ${check} ${text}`);
	}

	if (priorities.length > 3) {
		lines.push(theme.fg("dim", `  +${priorities.length - 3} more`));
	}

	return lines;
}

// ─── Status Line Builder ───────────────────────────────────────────────

export function buildStatusLine(
	totalNotes: number,
	inboxCount: number,
	theme: Theme
): string {
	const brain = theme.fg("accent", "🧠");
	const notes = theme.fg("dim", `${totalNotes}`);
	const inbox =
		inboxCount > 0
			? theme.fg("warning", ` 📥 ${inboxCount}`)
			: "";
	const sep = theme.fg("dim", "│");
	const date = theme.fg("dim", new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }));

	return `${brain} ${notes}${inbox} ${sep} ${date}`;
}
