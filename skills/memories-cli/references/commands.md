# CLI Command Reference

Complete reference for all `memories` CLI commands.

## Table of Contents

- [Core Commands](#core-commands)
- [Query Commands](#query-commands)
- [Management Commands](#management-commands)
- [Lifecycle Commands](#lifecycle-commands)
- [Advanced Commands](#advanced-commands)
- [Reminders](#reminders)
- [Auth Commands](#auth-commands)

---

## Core Commands

### `memories init`

Initialize memories.sh in the current project.

**Options:**
- `--name <name>` — Project name (default: directory name)
- `--global` — Initialize global config only
- `--skip-mcp` — Skip MCP server setup
- `--skip-generate` — Skip generating instruction files

**Behavior:** Detects AI tools (Claude Code, Cursor, Windsurf, VS Code), configures MCP in each tool's config, generates instruction files, creates `.agents/config.yaml`.

### `memories add <content>`

Add a new memory.

**Options:**
- `-t, --type <type>` — Memory type: rule, decision, fact, note (default: note)
- `--tags <tags>` — Comma-separated tags
- `-g, --global` — Store as global memory
- `--template <name>` — Use a template (decision, error-fix, api-endpoint, dependency, pattern, gotcha)

### `memories recall`

Get context-aware memories for the current project.

**Options:**
- `-q, --query <query>` — Filter by relevance
- `-n, --limit <n>` — Max results (default: 20)
- `--json` — JSON output

**Behavior:** Returns rules first (always included), then relevant memories. Uses project detection via git remote.

### `memories prompt`

Generate a system prompt from memories.

**Options:**
- `-t, --type <type>` — Filter by type
- `--include-global` — Include global memories
- `--format <format>` — Output format: markdown, xml, text

---

## Query Commands

### `memories search <query>`

Full-text search across memories.

**Options:**
- `-n, --limit <n>` — Max results (default: 20)
- `--type <type>` — Filter by type
- `--semantic` — Use vector similarity (requires embeddings)
- `--threshold <n>` — Similarity threshold for semantic search
- `--json` — JSON output

### `memories list`

List memories with optional filters.

**Options:**
- `-n, --limit <n>` — Max results (default: 50)
- `--type <type>` — Filter by type
- `--tags <tags>` — Filter by tags
- `--scope <scope>` — Filter: global, project
- `--json` — JSON output

---

## Management Commands

### `memories edit <id>`

Edit an existing memory.

**Options:**
- `-c, --content <content>` — New content
- `-t, --type <type>` — New type
- `--tags <tags>` — New tags (replaces existing)

**Behavior:** Interactive if no options given (opens prompt). Supports `--editor` flag for external editor.

### `memories forget <id>`

Soft-delete a memory.

**Options:**
- `--hard` — Permanent deletion
- `-f, --force` — Skip confirmation

### `memories tag <id> <action> [tags]`

Manage tags on a memory.

**Actions:** `add`, `remove`, `set`, `clear`

```bash
memories tag abc123 add api,auth
memories tag abc123 remove stale
memories tag abc123 set "api,v2"
memories tag abc123 clear
```

### `memories generate [target]`

Generate native config files for AI tools.

**Arguments:**
- `[target]` — Optional: claude, cursor, copilot, windsurf, cline, roo, gemini (default: all detected)

**Options:**
- `--dry-run` — Preview without writing
- `-f, --force` — Overwrite without confirmation

**Output Paths:**
| Target | File |
|--------|------|
| claude | `CLAUDE.md` |
| cursor | `.cursor/rules/memories.mdc` |
| copilot | `.github/copilot-instructions.md` |
| windsurf | `.windsurfrules` |

### `memories diff [target]`

Compare generated vs existing config files.

**Options:**
- `--json` — JSON diff output

### `memories export`

Export memories to YAML.

**Options:**
- `--type <type>` — Filter by type
- `--scope <scope>` — Filter by scope
- `-o, --output <file>` — Output file (default: stdout)

### `memories import <file>`

Import memories from YAML.

**Options:**
- `--dry-run` — Preview without importing
- `--merge` — Merge with existing (skip duplicates)

### `memories ingest [source]`

Import existing rule files as memories.

**Arguments:**
- `[source]` — claude, cursor, copilot, windsurf, auto (default: auto-detect)

**Options:**
- `--dry-run` — Preview what would be imported

### `memories config [key] [value]`

View or set configuration.

```bash
memories config                    # Show all config
memories config model              # Show current model
memories config model <name>       # Set embedding model
```

### `memories serve`

Start the MCP server.

**Options:**
- `--sse` — Use HTTP/SSE transport instead of stdio
- `-p, --port <port>` — Port for SSE (default: 3030)
- `--host <host>` — Host to bind (default: 127.0.0.1)
- `--cors` — Enable CORS

---

## Lifecycle Commands

### `memories session <subcommand>`

Manage explicit memory sessions.

#### `memories session start`

Start a new session.

**Options:**
- `--title <title>` — Session title
- `--client <client>` — Client label (default: `cli`)
- `--user-id <id>` — Optional user identifier
- `--metadata <json>` — Session metadata JSON object
- `-g, --global` — Create as global session
- `--project-id <id>` — Explicit project id
- `--json` — JSON output

#### `memories session checkpoint <session-id> <content...>`

Write a session event/checkpoint.

**Options:**
- `--role <role>` — `user`, `assistant`, `tool` (default: `assistant`)
- `--kind <kind>` — `message`, `checkpoint`, `summary`, `event` (default: `checkpoint`)
- `--token-count <n>` — Optional token count
- `--turn-index <n>` — Optional turn index
- `--not-meaningful` — Mark event as non-meaningful
- `--json` — JSON output

#### `memories session status [session-id]`

Read status for a specific session or latest active session.

#### `memories session end <session-id>`

End an active session.

**Options:**
- `--status <status>` — `closed` or `compacted` (default: `closed`)
- `--json` — JSON output

#### `memories session snapshot <session-id>`

Create a raw session snapshot from transcript input or recent events.

**Options:**
- `--trigger <trigger>` — `new_session`, `reset`, `manual`, `auto_compaction`
- `--slug <slug>` — Optional snapshot slug
- `-m, --messages <n>` — Number of events (default: `15`)
- `--include-noise` — Include non-meaningful events
- `--transcript <markdown>` — Explicit transcript markdown
- `--json` — JSON output

### `memories compact run`

Run inactivity compaction worker for active sessions.

**Options:**
- `--inactivity-minutes <n>` — Inactivity threshold minutes (default: `60`)
- `--limit <n>` — Max sessions to process (default: `25`)
- `--event-window <n>` — Meaningful event window for checkpoint summaries (default: `8`)
- `--json` — JSON output

### `memories consolidate run`

Consolidate duplicate memories and supersede outdated entries.

**Options:**
- `--types <types>` — Comma-separated types (default: `rule,decision,fact,note`)
- `--project-id <id>` — Explicit project id
- `--global-only` — Restrict to global scope
- `--no-include-global` — Exclude global memories for project-scoped run
- `--dry-run` — Preview only
- `--model <name>` — Optional model label for audit metadata
- `--json` — JSON output

### `memories openclaw memory <subcommand>`

Manage OpenClaw file-mode memory (`memory.md`, daily logs, snapshots).

#### `bootstrap`
- Reads semantic memory + today/yesterday daily logs.
- Options: `--workspace <path>`, `--json`

#### `flush <session-id>`
- Appends recent meaningful session events to today's daily log.
- Options: `-m, --messages <n>`, `--workspace <path>`, `--json`

#### `snapshot <session-id>`
- Writes DB snapshot + OpenClaw snapshot file.
- Options: `--trigger <trigger>`, `--slug <slug>`, `-m, --messages <n>`, `--workspace <path>`, `--json`

#### `sync`
- Import/export DB <-> OpenClaw memory files.
- Options: `--direction <import|export|both>`, `--workspace <path>`, `--json`

---

## Reminders

### `memories reminders add <cron> <message...>`

Create a reminder with a 5-field cron expression.

**Options:**
- `-g, --global` — Store as global reminder
- `--json` — JSON output

### `memories reminders list`

List reminders in current scope.

**Options:**
- `--all` — Include disabled reminders
- `--json` — JSON output

### `memories reminders run`

Evaluate and emit due reminders.

**Options:**
- `--dry-run` — Preview due reminders without updating schedule
- `--json` — JSON output

### `memories reminders enable <id>`

Enable a reminder and recompute next trigger.

### `memories reminders disable <id>`

Disable a reminder without deleting it.

### `memories reminders delete <id>`

Delete a reminder by ID.

### `memories sync`

Sync local database with cloud (requires login).

**Options:**
- `--force` — Force full sync
- `--dry-run` — Preview sync changes

### `memories embed`

Generate embeddings for memories.

**Options:**
- `--all` — Re-embed all (even existing)
- `--dry-run` — Preview only

### `memories stats`

Show memory statistics (counts, types, tags).

**Options:**
- `--json` — JSON output

### `memories doctor`

Diagnose common issues. Checks: database integrity, MCP config, tool detection, sync status.

### `memories hook <action>`

Manage git hooks.

**Actions:** `install`, `uninstall`, `status`

Installs a post-commit hook that auto-runs `memories generate`.

---

## Advanced Commands

### `memories stale`

Find memories not updated within threshold.

**Options:**
- `--days <n>` — Staleness threshold (default: 90)
- `--type <type>` — Filter by type
- `--include-superseded` — Include superseded memories
- `--superseded-only` — Only superseded memories
- `--conflicts-only` — Only memories with contradiction links
- `--json` — JSON output

### `memories review`

Interactive review of stale memories. Options per memory: keep, delete, skip, quit.

**Options:**
- `--days <n>` — Staleness threshold (default: 90)
- `--include-superseded` — Include superseded memories
- `--superseded-only` — Only superseded memories
- `--conflicts-only` — Only memories with contradiction links

### `memories link <id1> <id2>`

Link two related memories.

**Options:**
- `-t, --type <type>` — Link type: related, supports, supersedes, contradicts (default: related)

### `memories unlink <id1> <id2>`

Remove a link between memories.

### `memories show <id>`

Show memory details with linked memories.

**Options:**
- `--links` — Include linked memories

### `memories template <action>`

Manage memory templates.

**Subcommands:**
- `list` — List available templates
- `show <name>` — Show template fields
- `use <name>` — Create memory from template

### `memories history <id>`

View version history of a memory.

### `memories revert <id>`

Revert to a previous version.

**Options:**
- `--to <version>` — Version number (required)

### `memories validate`

Check memory integrity (orphaned links, missing fields, duplicate content).

### `memories files <action>`

Manage synced config files.

**Subcommands:**
- `list` / `ls` — List synced files
- `ingest` — Import from config directories
  - `-g, --global` — Global configs (default)
  - `-p, --project` — Project configs
  - `--dry-run` — Preview
- `apply` — Restore files from cloud
  - `-g, --global` — Apply global files
  - `-p, --project` — Apply project files
  - `-f, --force` — Overwrite existing
  - `--dry-run` — Preview
- `show <path>` — Show synced file content
- `forget <path>` — Remove from sync

**Supported directories:** `.agents`, `.cursor`, `.claude`, `.codex`, `.windsurf`, `.cline`, `.github/copilot`, `.gemini`, `.roo`, `.amp`, `.opencode`, `.factory`

---

## Auth Commands

### `memories login`

Authenticate with memories.sh cloud.

**Options:**
- `--api-url <url>` — Custom API URL

**Behavior:** Device code flow — opens browser, polls for auth (5 min timeout).

### `memories logout`

Clear stored auth credentials.
