---
name: openclaw
description: "OpenClaw integration workflows for memories.sh. Use when: (1) Setting up OpenClaw with memories.sh (`openclaw onboard`, `memories init`), (2) Syncing OpenClaw workspace contracts (`~/.openclaw/workspace/AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, memory files, and skills), (3) Running repeatable refresh flows after memory updates, (4) Scheduling reminder prompts for OpenClaw refresh via `memories reminders`, (5) Troubleshooting OpenClaw workspace drift, missing skills, or path/config mismatches, (6) Updating OpenClaw runbooks or `llms.txt` guidance."
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
- If setup exists and memories changed, run the ongoing refresh sequence.
- If behavior appears stale, run verification checks and troubleshooting in order.
- If workspace path is custom, read `~/.openclaw/openclaw.json` and replace default `~/.openclaw/workspace` paths.

## Ongoing Refresh

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

## Guardrails

- Prefer deterministic generate + ingest/apply flows over manual workspace edits.
- Keep skills copy conditional so missing `.agents/skills` does not fail the flow.
- Do not delete user workspace files unless explicitly requested.
- Treat project docs and official OpenClaw docs as source of truth.

## Reference Files

- **Operational workflows**: See [references/workflows.md](references/workflows.md) for setup, verification, and troubleshooting.
