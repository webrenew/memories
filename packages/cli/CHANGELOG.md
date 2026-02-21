# @memories.sh/cli

## 0.7.9

### Minor Changes

- Add cron-based reminder support to the CLI with `memories reminders` subcommands (`add`, `list`, `run`, `enable`, `disable`, `delete`).
- Add local CLI MCP reminder tools: `add_reminder`, `list_reminders`, `run_due_reminders`, `enable_reminder`, `disable_reminder`, and `delete_reminder`.
- Add reminder schema migration (`reminders` table + due/scope indexes) and coverage tests for scheduling, scope filtering, and due-run execution.

## 0.7.7

### Patch Changes

- 504c3fe: Improve `generate` target selection to default to detected integrations, so `memories generate` and `memories generate all` no longer write unrelated outputs (for example Copilot or Gemini) unless those integrations are actually detected.

  Add a first-class `factory` generation target for Droid output (`.factory/instructions.md`) and improve detection for Factory/Droid and Codex CLI installs.

  Clarify command messaging and docs that `memories generate` exports stored memories to config files and does not create database memories.

## 0.7.2

### Patch Changes

- Fix FTS trigger logic to avoid `SQLITE_CORRUPT_VTAB` when hard-deleting soft-deleted memories, and auto-refresh outdated trigger definitions during migrations.

## 0.7.0

### Minor Changes

- Improve default skill ingestion coverage for agent setups.

  - `memories setup` now imports existing project skills into memories by default.
  - Added `--skip-skill-ingest` to opt out during setup.
  - `memories ingest skills` now scans the full set of project skill directories, including `.codex/skills` and other supported tool locations.
