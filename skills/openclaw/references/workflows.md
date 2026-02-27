# OpenClaw + memories.sh Workflows

Use these sequences exactly as written unless the user provides a custom workspace path.

## Path A: First-time setup (recommended)

```bash
# 1) Install memories CLI
pnpm add -g @memories.sh/cli

# 2) Initialize OpenClaw workspace
openclaw onboard

# 3) Move to your project
cd your-project

# 4) Initialize memories in project
memories init

# 5) Generate OpenClaw AGENTS workspace file
memories generate claude -o ~/.openclaw/workspace/AGENTS.md --force

# 6) Generate skills from memories
memories generate agents

# 7) Ensure OpenClaw skills directory exists
mkdir -p ~/.openclaw/workspace/skills

# 8) Copy generated skills into OpenClaw workspace
if [ -d .agents/skills ]; then cp -R .agents/skills/. ~/.openclaw/workspace/skills/; fi

# 9) Ingest workspace files (include runtime config)
memories files ingest --global --include-config

# 10) Apply workspace files
memories files apply --global --include-config --force

# 11) Optional: add weekday reminder for OpenClaw refresh
memories reminders add "0 9 * * 1-5" "OpenClaw refresh: run generate + skills copy + files apply"
```

## Path B: Ongoing refresh

```bash
cd your-project
memories generate claude -o ~/.openclaw/workspace/AGENTS.md --force
memories generate agents
if [ -d .agents/skills ]; then cp -R .agents/skills/. ~/.openclaw/workspace/skills/; fi
memories files ingest --global --include-config
memories files apply --global --include-config --force
```

Optional reminder run:

```bash
memories reminders run
```

## Path C: Lifecycle memory workflow (`openclaw memory`)

Use this when managing session memory continuity across compaction, `/new`, or `/reset`.

```bash
# 0) Optional: create or inspect active lifecycle session
memories session start --title "OpenClaw task" --client codex
memories session status

# 1) Bootstrap semantic memory + today/yesterday daily logs
memories openclaw memory bootstrap

# 2) Pre-compaction checkpoint flush into daily log
memories openclaw memory flush <session-id> --messages 15

# 3) Raw snapshot at boundary events (/new or /reset)
memories openclaw memory snapshot <session-id> --trigger reset

# 4) Reconcile DB and OpenClaw files
memories openclaw memory sync --direction both
```

Trigger mapping:
- Session start/new conversation: `bootstrap`
- Near token/turn budget or inactivity compaction: `flush`
- `/new`, `/reset`, explicit archive handoff: `snapshot --trigger new_session|reset|manual|auto_compaction`
- Cross-device edits or drift reconciliation: `sync --direction import|export|both`

Automation-friendly JSON output:

```bash
memories openclaw memory bootstrap --json
memories openclaw memory flush <session-id> --json
memories openclaw memory snapshot <session-id> --trigger reset --json
memories openclaw memory sync --direction both --json
```

## Expected workspace artifacts

- `~/.openclaw/workspace/AGENTS.md`
- `~/.openclaw/workspace/SOUL.md`
- `~/.openclaw/workspace/TOOLS.md`
- `~/.openclaw/workspace/IDENTITY.md`
- `~/.openclaw/workspace/USER.md`
- `~/.openclaw/workspace/HEARTBEAT.md`
- `~/.openclaw/workspace/BOOTSTRAP.md`
- `~/.openclaw/workspace/BOOT.md` (if present)
- `~/.openclaw/workspace/MEMORY.md` or `~/.openclaw/workspace/memory.md`
- `~/.openclaw/workspace/memory/*.md`
- `~/.openclaw/workspace/skills/**/*`

Optional config sync:
- `~/.openclaw/openclaw.json` via `--include-config`

## Verification checklist

```bash
# Workspace exists
ls -la ~/.openclaw/workspace

# AGENTS file exists and was refreshed
ls -la ~/.openclaw/workspace/AGENTS.md

# Skills folder exists
ls -la ~/.openclaw/workspace/skills

# Generated skills exist locally (if expected)
ls -la .agents/skills

# OpenClaw file-mode memory artifacts
ls -la ~/.openclaw/workspace/memory/daily
ls -la ~/.openclaw/workspace/memory/snapshots
```

## Troubleshooting

### `openclaw: command not found`

- Install OpenClaw first: `https://docs.openclaw.ai/install/index`

### Skills did not copy

- Confirm `memories generate agents` ran.
- Keep copy conditional:
  - `if [ -d .agents/skills ]; then cp -R .agents/skills/. ~/.openclaw/workspace/skills/; fi`

### Wrong workspace path

- Inspect `~/.openclaw/openclaw.json`.
- Replace `~/.openclaw/workspace` with configured path in all commands.

### Stale runtime behavior

- Re-run Path C in order for lifecycle memory continuity issues.
- Re-run Path B for workspace contract drift (AGENTS/skills/config) issues.
