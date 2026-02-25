# 🧠 pi-second-brain

A [pi](https://github.com/badlogic/pi-mono) extension that gives your AI agent persistent memory using [Tiago Forte's PARA method](https://fortelabs.com/blog/para/) and [qmd](https://github.com/tobi/qmd) for search.

Knowledge is automatically captured from every conversation, organized into Projects/Areas/Resources/Archive, and surfaced when relevant — so your agent remembers what you've worked on across sessions.

## Install

```bash
# Install the pi package
pi install git:github.com/meekgeek/pi-second-brain

# Run the setup script to create your knowledge base
cd ~/.pi/agent/git/github.com/meekgeek/pi-second-brain
npm run setup
```

Or install manually:

```bash
# Clone to the global extensions directory
git clone https://github.com/meekgeek/pi-second-brain ~/.pi/agent/extensions/second-brain

# Run setup
cd ~/.pi/agent/extensions/second-brain
npm run setup
```

### Prerequisites

- **[pi](https://github.com/badlogic/pi-mono)** — The coding agent
- **[qmd](https://github.com/tobi/qmd)** — Markdown search engine (optional but recommended)
  ```bash
  npm install -g @tobilu/qmd
  ```

## What It Does

The extension hooks into pi's lifecycle to automatically manage knowledge:

| Lifecycle Event | Action |
|----------------|--------|
| **Session start** | Creates daily note, shows priorities, injects relevant context |
| **Each prompt** | Searches knowledge base for related context, adds to system prompt |
| **After each exchange** | Extracts decisions, solutions, and learnings to daily note |
| **Before compaction** | Deep LLM extraction of all knowledge before conversation is lost |
| **Session exit** | Git commits changes, re-indexes with qmd |

**You don't change how you work.** Knowledge capture is automatic. The agent also has tools to explicitly search and capture when needed.

## Commands

| Command | Description |
|---------|-------------|
| `/brain` | 📊 Full TUI dashboard with PARA overview |
| `/capture` | 📥 Interactive capture wizard |
| `/daily` | 📅 View today's daily note |
| `/search <query>` | 🔍 Search across all notes |
| `/review` | 📋 Weekly review — process inbox, archive projects |
| `/priorities` | ✅ View/set today's priorities |
| `/second-brain` | 📊 Quick status report (prompt template) |
| `Ctrl+Shift+B` | Toggle brain dashboard |

## Tools (for the LLM)

The agent can call these directly during conversation:

- **`second_brain_search`** — Search the knowledge base
- **`second_brain_capture`** — Save a note to a PARA category
- **`second_brain_daily`** — Read or append to today's daily note

## Knowledge Base Structure

Created at `~/second-brain/` by the setup script:

```
~/second-brain/
├── 0-inbox/        # Quick captures, process during /review
├── 1-projects/     # Active projects with clear goals
├── 2-areas/        # Ongoing responsibilities
├── 3-resources/    # Reference material & patterns
├── 4-archive/      # Completed/inactive items
├── daily/          # Daily notes (YYYY-MM-DD.md)
└── templates/      # Note templates
```

All notes are plain markdown. The knowledge base is a git repo — every session exit creates a commit, giving you full history.

## How Context Injection Works

When you send a prompt, the extension:

1. Searches qmd for notes matching your prompt keywords
2. Detects the current project from your working directory
3. Injects a compact context block into the system prompt

The agent sees something like:

```
[Second Brain — Relevant Knowledge]
Active project: hagerty-media-terraform
• Terraform S3 bucket policy (85%): Use OAI for CloudFront...
• Pipeline deploy stage issues (72%): TF_VAR_NEW_TENANCY inconsistency...
[End Second Brain Context]
```

This means the agent "remembers" relevant context without you asking.

## Daily Notes

Each day gets a note with sections:

- **Priorities** — Auto-rolled from yesterday if incomplete
- **Log** — Timestamped entries added automatically
- **Notes** — General observations
- **Decisions** — Key decisions captured during conversations
- **Learned** — New knowledge and insights

## Configuration

The extension works out of the box with no configuration. The knowledge base location is `~/second-brain/` (hardcoded for simplicity — PRs welcome to make it configurable).

## Package Contents

```
pi-second-brain/
├── src/
│   ├── index.ts        # Main extension (lifecycle hooks, tools, commands)
│   ├── para.ts         # PARA directory management
│   ├── daily.ts        # Daily note creation and management
│   ├── extractor.ts    # Knowledge extraction (light + deep)
│   └── ui.ts           # TUI components (dashboard, search, widgets)
├── skills/
│   └── second-brain/
│       └── SKILL.md    # Teaches the agent when/how to use the tools
├── prompts/
│   └── second-brain.md # /second-brain status report template
├── scripts/
│   └── setup.mjs       # One-command setup script
├── package.json
└── README.md
```

## License

MIT
