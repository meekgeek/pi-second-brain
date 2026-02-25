/**
 * PARA - Projects, Areas, Resources, Archive
 *
 * Utilities for organizing knowledge into the PARA structure.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export const BRAIN_DIR = join(process.env.HOME ?? "~", "second-brain");
export const INBOX_DIR = join(BRAIN_DIR, "0-inbox");
export const PROJECTS_DIR = join(BRAIN_DIR, "1-projects");
export const AREAS_DIR = join(BRAIN_DIR, "2-areas");
export const RESOURCES_DIR = join(BRAIN_DIR, "3-resources");
export const ARCHIVE_DIR = join(BRAIN_DIR, "4-archive");
export const DAILY_DIR = join(BRAIN_DIR, "daily");
export const TEMPLATES_DIR = join(BRAIN_DIR, "templates");

export type ParaCategory = "inbox" | "projects" | "areas" | "resources" | "archive";

export const PARA_DIRS: Record<ParaCategory, string> = {
	inbox: INBOX_DIR,
	projects: PROJECTS_DIR,
	areas: AREAS_DIR,
	resources: RESOURCES_DIR,
	archive: ARCHIVE_DIR,
};

export const PARA_ICONS: Record<ParaCategory, string> = {
	inbox: "📥",
	projects: "📦",
	areas: "🔄",
	resources: "📚",
	archive: "🗄️",
};

export interface NoteInfo {
	path: string;
	name: string;
	title: string;
	category: ParaCategory;
	modified: Date;
}

/** Ensure all PARA directories exist */
export function ensureDirs(): void {
	for (const dir of Object.values(PARA_DIRS)) {
		mkdirSync(dir, { recursive: true });
	}
	mkdirSync(DAILY_DIR, { recursive: true });
	mkdirSync(TEMPLATES_DIR, { recursive: true });
}

/** List notes in a PARA category */
export function listNotes(category: ParaCategory): NoteInfo[] {
	const dir = PARA_DIRS[category];
	if (!existsSync(dir)) return [];

	const notes: NoteInfo[] = [];
	const entries = readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".md")) {
			const fullPath = join(dir, entry.name);
			const stat = statSync(fullPath);
			const content = readFileSync(fullPath, "utf-8");
			const titleMatch = content.match(/^#\s+(.+)$/m);
			notes.push({
				path: fullPath,
				name: entry.name.replace(/\.md$/, ""),
				title: titleMatch?.[1] ?? entry.name.replace(/\.md$/, ""),
				category,
				modified: stat.mtime,
			});
		} else if (entry.isDirectory()) {
			// Check for subdirectory notes
			const subDir = join(dir, entry.name);
			const subEntries = readdirSync(subDir, { withFileTypes: true });
			for (const sub of subEntries) {
				if (sub.isFile() && sub.name.endsWith(".md")) {
					const fullPath = join(subDir, sub.name);
					const stat = statSync(fullPath);
					const content = readFileSync(fullPath, "utf-8");
					const titleMatch = content.match(/^#\s+(.+)$/m);
					notes.push({
						path: fullPath,
						name: `${entry.name}/${sub.name.replace(/\.md$/, "")}`,
						title: titleMatch?.[1] ?? sub.name.replace(/\.md$/, ""),
						category,
						modified: stat.mtime,
					});
				}
			}
		}
	}

	return notes.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** Get counts for all categories */
export function getCounts(): Record<ParaCategory, number> {
	return {
		inbox: listNotes("inbox").length,
		projects: listNotes("projects").length,
		areas: listNotes("areas").length,
		resources: listNotes("resources").length,
		archive: listNotes("archive").length,
	};
}

/** Slugify a title for use as filename */
export function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60);
}

/** Detect project from a working directory path */
export function detectProject(cwd: string): string | undefined {
	const dirName = basename(cwd);
	const projects = listNotes("projects");
	// Try exact match on slugified directory name
	const match = projects.find((p) => p.name === dirName || slugify(p.title) === slugify(dirName));
	return match?.name;
}
