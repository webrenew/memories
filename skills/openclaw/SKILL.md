---
name: openclaw
description: "OpenClaw integration workflows for memories.sh. Use when: (1) Setting up OpenClaw with memories.sh (`openclaw onboard`, `memories init`), (2) Syncing OpenClaw workspace contracts (`~/.openclaw/workspace/AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, memory files, and skills), (3) Running lifecycle memory file workflows via `memories openclaw memory bootstrap|flush|snapshot|sync`, (4) Scheduling reminder prompts for OpenClaw refresh via `memories reminders`, (5) Troubleshooting OpenClaw workspace drift, missing skills, or path/config mismatches, (6) Updating OpenClaw runbooks or `llms.txt` guidance."
---

# openclaw

Canonical setup and operational guidance for OpenClaw + memories.sh.

## Quick Start

```bash
# First-time setup
openclaw onboard
cd your-project
memories init
memories generate claude -o ~/.openclaw/workspace/AGENTS.md --force
memories generate agents
mkdir -p ~/.openclaw/workspace/skills
if [ -d .agents/skills ]; then cp -R .agents/skills/. ~/.openclaw/workspace/skills/; fi
memories files ingest --global --include-config
memories files apply --global --include-config --force

# Optional: schedule a weekday reminder to run the refresh flow
memories reminders add "0 9 * * 1-5" "OpenClaw refresh: run generate + skills copy + files apply"
```

## Workflow Decision Tree

- If `openclaw` is missing, stop and direct the user to official OpenClaw install docs.
- If OpenClaw was not onboarded on this machine, run first-time setup.
- If setup exists and contract/rules changed, run workspace contract refresh.
- If the task is session lifecycle memory flow, run OpenClaw memory lifecycle commands (`bootstrap`, `flush`, `snapshot`, `sync`) in that order as needed.
- If behavior appears stale, run verification checks and troubleshooting in order.
- If workspace path is custom, read `~/.openclaw/openclaw.json` and replace default `~/.openclaw/workspace` paths.

## Workspace Contract Refresh

```bash
cd your-project
memories generate claude -o ~/.openclaw/workspace/AGENTS.md --force
memories generate agents
if [ -d .agents/skills ]; then cp -R .agents/skills/. ~/.openclaw/workspace/skills/; fi
memories files ingest --global --include-config
memories files apply --global --include-config --force
```

Optional reminder check:

```bash
memories reminders list
memories reminders run
```

## Memory Lifecycle Workflow (OpenClaw File Mode)

Use these when session context must persist across resets/compaction:

```bash
# 1) Bootstrap semantic + recent episodic context from OpenClaw files
memories openclaw memory bootstrap

# 2) Flush meaningful session events to today's daily log before compaction/reset
memories openclaw memory flush <session-id> --messages 15

# 3) Persist raw session snapshot in DB + OpenClaw snapshot file
memories openclaw memory snapshot <session-id> --trigger reset

# 4) Reconcile DB and OpenClaw files (import/export/both)
memories openclaw memory sync --direction both
```

Trigger guidance:
- Session start/new workspace: `bootstrap`
- Near context budget or inactivity compaction: `flush`
- `/new`, `/reset`, manual handoff, or auto compaction boundaries: `snapshot --trigger new_session|reset|manual|auto_compaction`
- Cross-device/manual file edits: `sync --direction import|export|both`

## Guardrails

- Prefer deterministic generate + ingest/apply flows over manual workspace edits.
- For lifecycle persistence, use `openclaw memory bootstrap|flush|snapshot|sync` instead of ad-hoc file writes.
- Keep skills copy conditional so missing `.agents/skills` does not fail the flow.
- Do not delete user workspace files unless explicitly requested.
- Treat project docs and official OpenClaw docs as source of truth.

## Reference Files

- **Operational workflows**: See [references/workflows.md](references/workflows.md) for setup, verification, and troubleshooting.
