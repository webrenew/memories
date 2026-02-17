---
"@memories.sh/cli": patch
---

Improve `generate` target selection to default to detected integrations, so `memories generate` and `memories generate all` no longer write unrelated outputs (for example Copilot or Gemini) unless those integrations are actually detected.

Add a first-class `factory` generation target for Droid output (`.factory/instructions.md`) and improve detection for Factory/Droid and Codex CLI installs.

Clarify command messaging and docs that `memories generate` exports stored memories to config files and does not create database memories.
