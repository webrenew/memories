# @memories.sh/cli

A local-first memory layer for AI coding agents — persistent context for Claude, Cursor, Copilot, and more.

## Installation

```bash
pnpm add -g @memories.sh/cli
```

## Quick Start

```bash
# Initialize in your project (auto-configures MCP for detected tools)
memories init

# Add your first rule
memories add --rule "Always use TypeScript strict mode"

# Add a decision
memories add --decision "Chose PostgreSQL over MySQL for JSONB support"

# Generate config files for all your tools
memories generate all
```

## Features

- **One store, every tool** — Add a memory once, generate files for Cursor, Claude Code, Copilot, Windsurf, and more
- **Local-first** — Your data stays on your machine in a SQLite database
- **Semantic search** — AI-powered search finds related memories, not just keyword matches
- **MCP server** — Built-in Model Context Protocol server for direct agent access
- **Auto-setup** — Detects your tools and configures MCP automatically

## Commands

| Command | Description |
|---------|-------------|
| `memories init` | Initialize memories in the current project |
| `memories add` | Add a new memory (rule, decision, fact, or note) |
| `memories list` | List all memories |
| `memories search <query>` | Search memories (add `--semantic` for AI search) |
| `memories recall <query>` | Recall memories matching a query |
| `memories generate <target>` | Generate config files for AI tools |
| `memories serve` | Start the MCP server |
| `memories sync` | Sync memories to the cloud (Pro) |
| `memories export` | Export memories to JSON/YAML |
| `memories import` | Import memories from JSON/YAML |

## Memory Types

```bash
# Rules - always-active coding standards
memories add --rule "Use early returns to reduce nesting"

# Decisions - architectural choices with reasoning
memories add --decision "Chose Tailwind for utility-first approach"

# Facts - project-specific knowledge
memories add --fact "API rate limit is 100 req/min"

# Notes - general-purpose (default)
memories add "Legacy API deprecated in Q3 2026"
```

## Generation Targets

| Target | Output Path |
|--------|-------------|
| `cursor` | `.cursor/rules/memories.mdc` |
| `claude` | `CLAUDE.md` |
| `agents` | `AGENTS.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `windsurf` | `.windsurf/rules/memories.md` |
| `cline` | `.clinerules/memories.md` |
| `roo` | `.roo/rules/memories.md` |
| `gemini` | `GEMINI.md` |

## MCP Server

The CLI includes a built-in MCP server that exposes your memories to AI tools:

```bash
# Start the server
memories serve

# Or configure in your tool's MCP settings
{
  "mcpServers": {
    "memories": {
      "command": "memories",
      "args": ["serve"]
    }
  }
}
```

## Documentation

Full documentation at [memories.sh/docs](https://memories.sh/docs)

## License

MIT
