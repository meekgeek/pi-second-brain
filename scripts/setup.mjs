#!/usr/bin/env node

/**
 * Second Brain Setup Script
 *
 * Run: npm run setup (or node scripts/setup.mjs)
 *
 * This script:
 * 1. Creates the ~/second-brain/ PARA directory structure
 * 2. Initializes git
 * 3. Creates note templates
 * 4. Checks for qmd and offers to install it
 * 5. Registers the collection with qmd
 * 6. Creates the first daily note
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const HOME = process.env.HOME || process.env.USERPROFILE || "~";
const BRAIN_DIR = join(HOME, "second-brain");

const COLORS = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
	red: "\x1b[31m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;
const log = (msg) => console.log(msg);
const ok = (msg) => log(`  ${c("green", "✓")} ${msg}`);
const warn = (msg) => log(`  ${c("yellow", "⚠")} ${msg}`);
const info = (msg) => log(`  ${c("blue", "ℹ")} ${msg}`);
const step = (msg) => log(`\n${c("cyan", c("bold", `▸ ${msg}`))}`);

function ask(question) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(`  ${question} `, (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase());
		});
	});
}

function run(cmd, opts = {}) {
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit", ...opts }).trim();
	} catch {
		return null;
	}
}

function commandExists(cmd) {
	try {
		execSync(`which ${cmd}`, { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

// ─── Templates ──────────────────────────────────────────────────────────

const TEMPLATES = {
	"daily.md": `---
date: {{DATE}}
---
# {{DAY_NAME}}, {{FULL_DATE}}

## Priorities
- [ ] 

## Log
<!-- Auto-populated by second-brain extension -->

## Notes

## Decisions
<!-- Key decisions made today -->

## Learned
<!-- Things learned today -->
`,
	"project.md": `---
title: {{TITLE}}
created: {{DATE}}
status: active
---
# {{TITLE}}

## Goal

## Key Decisions

## Progress

## Open Questions

## Related
`,
	"area.md": `---
title: {{TITLE}}
created: {{DATE}}
---
# {{TITLE}}

## Responsibilities

## Standards & Practices

## Key Knowledge

## Related
`,
	"resource.md": `---
title: {{TITLE}}
created: {{DATE}}
tags: []
---
# {{TITLE}}

## Summary

## Key Points

## Examples

## References

## Related
`,
};

const README = `# 🧠 Second Brain

A PARA-based knowledge management system powered by [pi](https://github.com/badlogic/pi-mono) and [qmd](https://github.com/tobi/qmd).

## Structure

| Folder | Purpose |
|--------|---------|
| \`0-inbox/\` | Quick capture, unsorted |
| \`1-projects/\` | Active projects with clear goals & deadlines |
| \`2-areas/\` | Ongoing responsibilities |
| \`3-resources/\` | Reference material & knowledge |
| \`4-archive/\` | Completed/inactive items |
| \`daily/\` | Daily notes (one per day) |
| \`templates/\` | Note templates |

## Commands

| Command | Description |
|---------|-------------|
| \`/brain\` | Dashboard |
| \`/capture\` | Quick capture |
| \`/daily\` | Today's note |
| \`/search\` | Search notes |
| \`/review\` | Weekly review |
| \`/priorities\` | Today's priorities |
| \`/second-brain\` | Status report |
`;

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
	log("");
	log(c("bold", "  🧠 Second Brain Setup"));
	log(c("dim", "  ─────────────────────────────────────"));
	log(c("dim", "  PARA knowledge management for pi"));
	log("");

	// Step 1: Create directory structure
	step("Creating knowledge base directory structure");

	const dirs = [
		"0-inbox",
		"1-projects",
		"2-areas/infrastructure",
		"2-areas/coding-practices",
		"3-resources",
		"4-archive",
		"daily",
		"templates",
	];

	if (existsSync(BRAIN_DIR)) {
		info(`${BRAIN_DIR} already exists — preserving existing files`);
	}

	for (const dir of dirs) {
		const full = join(BRAIN_DIR, dir);
		mkdirSync(full, { recursive: true });
	}
	ok(`Created PARA structure at ${c("cyan", BRAIN_DIR)}`);

	// Step 2: Write templates
	step("Writing note templates");

	for (const [name, content] of Object.entries(TEMPLATES)) {
		const path = join(BRAIN_DIR, "templates", name);
		if (!existsSync(path)) {
			writeFileSync(path, content, "utf-8");
			ok(`Created templates/${name}`);
		} else {
			info(`templates/${name} already exists — skipping`);
		}
	}

	// Write README
	const readmePath = join(BRAIN_DIR, "README.md");
	if (!existsSync(readmePath)) {
		writeFileSync(readmePath, README, "utf-8");
		ok("Created README.md");
	}

	// Step 3: Create first daily note
	step("Creating today's daily note");

	const now = new Date();
	const dateStr = now.toISOString().split("T")[0];
	const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	const dayName = days[now.getDay()];
	const fullDate = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

	const dailyPath = join(BRAIN_DIR, "daily", `${dateStr}.md`);
	if (!existsSync(dailyPath)) {
		const template = readFileSync(join(BRAIN_DIR, "templates", "daily.md"), "utf-8");
		const content = template
			.replace(/\{\{DATE\}\}/g, dateStr)
			.replace(/\{\{DAY_NAME\}\}/g, dayName)
			.replace(/\{\{FULL_DATE\}\}/g, fullDate);
		writeFileSync(dailyPath, content, "utf-8");
		ok(`Created daily/${dateStr}.md`);
	} else {
		info("Today's daily note already exists");
	}

	// Step 4: Initialize git
	step("Initializing git repository");

	const gitDir = join(BRAIN_DIR, ".git");
	if (existsSync(gitDir)) {
		info("Git already initialized");
	} else {
		run(`git -C "${BRAIN_DIR}" init`);
		run(`git -C "${BRAIN_DIR}" add -A`);
		run(`git -C "${BRAIN_DIR}" commit -m "Initial second-brain setup"`, { silent: true });
		ok("Git initialized with initial commit");
	}

	// Step 5: Check for qmd
	step("Checking for qmd (markdown search engine)");

	if (commandExists("qmd")) {
		ok(`qmd found: ${run("which qmd", { silent: true })}`);

		// Check if collection exists
		const status = run("qmd status", { silent: true }) || "";
		if (status.includes("second-brain")) {
			info("qmd collection 'second-brain' already registered");
		} else {
			info("Registering collection with qmd...");
			run(`qmd collection add "${BRAIN_DIR}" --name second-brain`);
			run(`qmd context add "qmd://second-brain" "Personal knowledge base using PARA method. Contains projects, areas, resources, archived items, and daily notes."`);
			ok("qmd collection 'second-brain' registered");

			const doEmbed = await ask("Generate embeddings for semantic search? (y/n)");
			if (doEmbed === "y" || doEmbed === "yes") {
				info("Generating embeddings (this downloads a ~330MB model on first run)...");
				run("qmd embed");
				ok("Embeddings generated");
			} else {
				info("Skipping embeddings. Run 'qmd embed' later for semantic search.");
			}
		}
	} else {
		warn("qmd is not installed");
		log("");
		info("qmd provides fast full-text and semantic search for your knowledge base.");
		info("The extension still works without it, but search tools won't return results.");
		log("");
		info("Install with:");
		log(`    ${c("cyan", "npm install -g @tobilu/qmd")}`);
		log("");
		info("Then run setup again, or manually register:");
		log(`    ${c("cyan", `qmd collection add "${BRAIN_DIR}" --name second-brain`)}`);
		log(`    ${c("cyan", "qmd embed")}`);
	}

	// Done
	log("");
	log(c("dim", "  ─────────────────────────────────────"));
	log(c("bold", "  🧠 Setup complete!"));
	log("");
	log("  Your knowledge base is at:");
	log(`    ${c("cyan", BRAIN_DIR)}`);
	log("");
	log("  Get started:");
	log(`    ${c("dim", "•")} Launch ${c("cyan", "pi")} and try ${c("cyan", "/brain")} for the dashboard`);
	log(`    ${c("dim", "•")} Use ${c("cyan", "/capture")} to save a note`);
	log(`    ${c("dim", "•")} Use ${c("cyan", "/search <query>")} to find knowledge`);
	log(`    ${c("dim", "•")} Use ${c("cyan", "/second-brain")} for a status report`);
	log(`    ${c("dim", "•")} Knowledge is captured automatically as you work`);
	log("");
}

main().catch((err) => {
	console.error(c("red", `\n  ✗ Setup failed: ${err.message}`));
	process.exit(1);
});
