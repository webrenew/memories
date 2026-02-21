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

- Re-run Path B in order from the correct project directory.
