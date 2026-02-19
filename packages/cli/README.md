# @memories.sh/cli

The unified agent memory layer. Store rules once, generate configs for every AI tool.

[![npm version](https://img.shields.io/npm/v/@memories.sh/cli?color=000&labelColor=1a1a2e)](https://www.npmjs.com/package/@memories.sh/cli)
[![License: Apache-2.0](https://img.shields.io/npm/l/@memories.sh/cli?color=000&labelColor=1a1a2e)](https://github.com/webrenew/memories/blob/main/LICENSE)

## Install

```bash
npm install -g @memories.sh/cli
```

Requires Node.js >= 20.

Global installs automatically bootstrap `SKILLS.md` guidance in detected tool config homes (for example `~/.claude`, `~/.cursor`, `~/.codex`) so agents know when and how to call `memories`.

## Quick Start

```bash
# Initialize in your project (auto-detects tools, configures MCP, imports existing project skills)
memories setup

# Pick scope explicitly when needed
memories setup --scope project   # or --scope global

# Add memories
memories add --rule "Always use TypeScript strict mode"
memories add --decision "Chose Supabase for auth — built-in RLS"
memories add --rule "Use RESTful naming" --paths "src/api/**" --category api

# Generate configs for all detected tools
memories generate

# Start the MCP server
memories serve
```

## Features

- **One store, every tool** — generate native configs for Cursor, Claude Code, Copilot, Windsurf, Gemini, Cline, Roo, and more
- **Auto-setup** — `memories setup` detects tools, configures MCP, and imports existing project skills automatically
- **Path-scoped rules** — `--paths "src/api/**"` becomes `paths:` in Claude, `globs:` in Cursor
- **Skills** — define reusable agent workflows following the [Agent Skills](https://agentskills.io) standard
- **`.agents/` directory** — canonical, tool-agnostic config format
- **Semantic search** — AI-powered embeddings find related memories
- **MCP server** — fallback for agents that need real-time access beyond static configs
- **Local-first** — SQLite database, fully offline capable
- **Cloud sync** — optional Turso-powered cross-machine sync
- **Global SKILLS.md bootstrap** — installs cross-tool memory usage guidance into detected global agent config directories

## Memory Types

| Type | Flag | Description |
|------|------|-------------|
| `rule` | `--rule` | Always-active coding standards |
| `decision` | `--decision` | Architectural choices with reasoning |
| `fact` | `--fact` | Concrete project knowledge |
| `note` | *(default)* | General-purpose notes |
| `skill` | `--type skill` | Reusable agent workflows |

## Generation Targets

| Target | Output Path |
|--------|-------------|
| `agents` | `.agents/` (canonical directory) |
| `cursor` | `.cursor/rules/*.mdc` |
| `claude` | `CLAUDE.md` + `.claude/` |
| `factory` | `.factory/instructions.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `windsurf` | `.windsurf/rules/memories.md` |
| `cline` | `.clinerules/memories.md` |
| `roo` | `.roo/rules/memories.md` |
| `gemini` | `GEMINI.md` |

## MCP Server (Fallback)

```json
{
  "mcpServers": {
    "memories": {
      "command": "memories",
      "args": ["serve"]
    }
  }
}
```

**Tools**: `get_context`, `add_memory`, `search_memories`, `get_rules`, `list_memories`, `edit_memory`, `forget_memory`, `bulk_forget_memories`, `vacuum_memories`

If your MCP client runs outside the repo directory, force project scope with `project_id`:

```json
{
  "name": "add_memory",
  "arguments": {
    "content": "Use retries for transient API failures",
    "type": "rule",
    "project_id": "github.com/webrenew/agent-space"
  }
}
```

Use `global: true` for global scope (do not combine `global` with `project_id`).

## Documentation

Full documentation at [memories.sh/docs](https://memories.sh/docs)

## License

[Apache 2.0](https://github.com/webrenew/memories/blob/main/LICENSE)
