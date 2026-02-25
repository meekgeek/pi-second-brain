---
name: second-brain
description: Knowledge management using the PARA method. Use when you need to capture important information, search past knowledge, manage daily notes, or organize notes into Projects, Areas, Resources, and Archive categories. Also use when starting a new topic to check if relevant knowledge already exists.
---

# Second Brain — PARA Knowledge Management

A persistent knowledge management system based on Tiago Forte's PARA method. Your knowledge base lives at `~/second-brain/` and is automatically managed by the second-brain extension.

## Available Tools

### `second_brain_search`
Search the knowledge base using qmd (full-text + semantic search).
```
Use this tool when:
- Starting work on a topic to check for existing knowledge
- The user asks "what did we decide about X?"
- You need to recall past solutions or patterns
```

### `second_brain_capture`
Capture a note to the knowledge base. Categories:
- **inbox** — Quick capture, unsorted (default). Process later with `/review`.
- **projects** — Active work with a clear goal and timeline.
- **areas** — Ongoing responsibilities with no end date.
- **resources** — Reference material useful in the future.

```
Use this tool when:
- A key decision is made
- A problem is solved (capture the problem + solution)
- The user shares important context about a project
- You discover a useful pattern, command, or technique
- The user explicitly asks to remember something
```

### `second_brain_daily`
Read or append to today's daily note. Actions:
- `read` — View today's full daily note
- `append_log` — Add a timestamped log entry
- `append_notes` — Add to the Notes section
- `append_decisions` — Add to the Decisions section
- `append_learned` — Add to the Learned section

## User Commands

| Command | Description |
|---------|-------------|
| `/brain` | Open the dashboard (overview, projects, areas, resources, inbox) |
| `/capture` | Interactive capture wizard |
| `/daily` | View today's daily note |
| `/search <query>` | Search all notes |
| `/review` | Weekly review — process inbox, archive projects, set priorities |
| `/priorities` | View/set today's priorities |
| `Ctrl+Shift+B` | Toggle dashboard |

## Knowledge Base Structure

```
~/second-brain/
├── 0-inbox/        # Unsorted captures
├── 1-projects/     # Active projects
├── 2-areas/        # Ongoing responsibilities
├── 3-resources/    # Reference material
├── 4-archive/      # Completed/inactive
├── daily/          # Daily notes (YYYY-MM-DD.md)
└── templates/      # Note templates
```

## Best Practices

1. **Capture liberally, organize later** — Use inbox for quick captures, `/review` to sort.
2. **Search before creating** — Check if knowledge already exists before duplicating.
3. **Be specific in titles** — "Terraform S3 bucket policy for CloudFront OAI" > "S3 stuff".
4. **Include context** — Capture the *why*, not just the *what*.
5. **Link related notes** — Reference other notes when relevant.
