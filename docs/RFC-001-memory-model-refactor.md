# RFC-001: Memory Model Refactor for Agentic Harness Portability

> **Status**: Draft
> **Date**: 2026-02-06
> **Goal**: Make `.agents/` the canonical, tool-agnostic configuration directory. Memories generate into `.agents/`, then adapt to detected editors/CLIs via linking or format translation.

---

## Architecture

```
┌──────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│  Memory Store    │     │  .agents/ (canonical) │     │  Tool Adapters   │
│  (SQLite + sync) │ ──► │  rules/, skills/,     │ ──► │  .claude/, .cursor/,
│                  │     │  settings.json        │     │  AGENTS.md, etc. │
└──────────────────┘     └──────────────────────┘     └──────────────────┘
```

**Three layers:**

1. **Memory store** — SQLite database with embeddings, sync, search. The durable source of truth.
2. **`.agents/` directory** — Canonical on-disk format. Tool-agnostic. Checked into git or kept local.
3. **Tool adapters** — `memories generate` reads `.agents/` and writes tool-specific formats, using `detectTools()` to discover what's installed.

---

## `.agents/` Directory Structure

```
.agents/
├── config.yaml                 # Project config (already exists)
├── instructions.md             # Always-on instructions (replaces AGENTS.md role)
├── rules/                      # Path-scoped rules with frontmatter
│   ├── api.md
│   ├── testing.md
│   └── security.md
├── skills/                     # Agent Skills standard (SKILL.md)
│   ├── deploy/
│   │   └── SKILL.md
│   └── review/
│       ├── SKILL.md
│       └── references/
│           └── checklist.md
├── agents/                     # Subagent definitions (future)
│   └── researcher.md
└── settings.json               # Permissions, hooks, env vars
```

### `instructions.md`

Always-on context. Equivalent to CLAUDE.md / AGENTS.md / copilot-instructions.md / etc. Generated from memories of type `rule`, `decision`, `fact`.

### `rules/*.md`

Path-scoped rules. Each file has YAML frontmatter with `paths:` globs and markdown body:

```markdown
---
paths:
  - "src/api/**"
  - "lib/api/**"
---

# API Rules

- Use RESTful naming conventions
- Return consistent error response format
- Include OpenAPI documentation comments
```

Generated from memories that have a `paths` field set.

### `skills/**/SKILL.md`

Follows the [Agent Skills](https://agentskills.io) open standard exactly. Generated from memories of type `skill`.

### `settings.json`

Agnostic permission/hook/env configuration. Structure modeled on Claude Code's `settings.json` (the superset), since every other tool's permissions are a subset:

```json
{
  "permissions": {
    "allow": ["Bash(npm run lint)", "Bash(npm run test *)"],
    "deny": ["Read(.env)", "Read(.env.*)"]
  },
  "hooks": {},
  "env": {}
}
```

Tools that support permissions (Claude Code) get these translated directly. Tools that don't simply ignore them.

---

## Tool Adapter Mapping

`memories generate` uses `detectTools()` (already in `setup.ts`) to discover installed editors, then adapts `.agents/` content per tool.

### Claude Code

| `.agents/` source | Claude Code output | Strategy |
|---|---|---|
| `instructions.md` | `CLAUDE.md` | Copy with header |
| `rules/*.md` | `.claude/rules/*.md` | Copy (frontmatter `paths:` is native) |
| `skills/**/SKILL.md` | `.claude/skills/**/SKILL.md` | Symlink or copy (format is identical) |
| `settings.json` | `.claude/settings.json` | Copy (format is identical) |

### Cursor

| `.agents/` source | Cursor output | Strategy |
|---|---|---|
| `instructions.md` | `.cursor/rules/memories.mdc` | Wrap with MDC frontmatter (`alwaysApply: true`) |
| `rules/*.md` | `.cursor/rules/{name}.mdc` | Translate `paths:` → `globs:` in frontmatter |
| `skills/**/SKILL.md` | `.cursor/skills/**/SKILL.md` | Symlink or copy (format is identical) |
| `settings.json` | N/A | Cursor has no equivalent |

### Flat-File Targets (Copilot, Windsurf, Gemini, Cline, Roo)

| `.agents/` source | Output | Strategy |
|---|---|---|
| `instructions.md` + `rules/*.md` | Single flat file | Merge all into one file; annotate path-scoped rules inline |
| `skills/` | N/A | Most flat-file targets don't support skills yet |
| `settings.json` | N/A | No equivalent |

### AGENTS.md Targets (Amp, Codex, Goose, Kilo, OpenCode)

| `.agents/` source | Output | Strategy |
|---|---|---|
| `instructions.md` | `AGENTS.md` | Copy with header |
| `rules/*.md` | Merged into `AGENTS.md` | Inline path annotations |

---

## Schema Changes

### New columns on `memories` table

All nullable, backward compatible:

```sql
ALTER TABLE memories ADD COLUMN paths TEXT;      -- comma-separated glob patterns
ALTER TABLE memories ADD COLUMN category TEXT;    -- free-form grouping key (becomes filename)
ALTER TABLE memories ADD COLUMN metadata TEXT;    -- JSON blob for extended attributes
```

### Updated TypeScript interface

```typescript
export type MemoryType = "rule" | "decision" | "fact" | "note" | "skill";

export interface Memory {
  id: string;
  content: string;
  tags: string | null;
  scope: Scope;
  project_id: string | null;
  type: MemoryType;
  paths: string | null;       // glob patterns (e.g., "src/api/**,**/*.test.ts")
  category: string | null;    // free-form grouping key (becomes rule filename)
  metadata: string | null;    // JSON blob for extended attributes
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
```

### Skill metadata (stored in `metadata` JSON column)

```typescript
interface SkillMetadata {
  name: string;                      // required by Agent Skills spec
  description: string;               // for progressive disclosure
  disable_model_invocation?: boolean; // Claude Code only
  user_invocable?: boolean;          // Claude Code only
  allowed_tools?: string;            // space-delimited tool list
  context?: "fork";                  // run in subagent
}
```

---

## CLI Changes

### `memories add` — new flags

```bash
memories add "Use RESTful naming" --type rule --paths "src/api/**" --category api
memories add "Mock externals in tests" --type rule --paths "**/*.test.ts" --category testing
memories add --type skill --name deploy --description "Deploy to production"
```

### `memories generate` — two-step pipeline

```bash
# Step 1: Populate .agents/ from memory store
memories generate agents       # Writes .agents/ canonical directory

# Step 2: Adapt to detected tools (or specific tool)
memories generate cursor       # Reads .agents/ → writes .cursor/
memories generate claude        # Reads .agents/ → writes .claude/ + CLAUDE.md
memories generate all           # Detects tools, adapts for each

# Or do both in one shot
memories generate               # Interactive: pick targets, does both steps
```

### `memories link` — new command (optional)

```bash
# Symlink where formats are identical (skills)
memories link cursor            # .cursor/skills/ → .agents/skills/
memories link claude            # .claude/skills/ → .agents/skills/
```

### `memories ingest` — enhanced parsing

```bash
memories ingest .agents/                    # Import from canonical directory
memories ingest .claude/rules/              # Parse path-scoped rules → memories with paths
memories ingest .cursor/rules/              # Parse globs → memories with paths
memories ingest .claude/skills/deploy/      # Import skill with metadata
```

---

## MCP Tool Changes

### `add_memory` — new optional parameters

```typescript
{
  content: string;
  type?: MemoryType;                    // now includes "skill"
  tags?: string[];
  global?: boolean;
  paths?: string[];                     // NEW: glob patterns
  category?: string;                    // NEW: grouping key
  metadata?: Record<string, unknown>;   // NEW: extended attributes
}
```

### `get_context` — enriched response

Rules returned with their `paths` and `category`, so agents know which rules apply to the files they're working on.

---

## What Already Exists (leverage, don't rebuild)

| Component | File | Status |
|---|---|---|
| `.agents/` directory init | `lib/config.ts` | ✅ exists (`AGENTS_DIR = ".agents"`) |
| `.agents/config.yaml` | `lib/config.ts` | ✅ exists |
| Tool detection | `lib/setup.ts` | ✅ exists (`detectTools()`) |
| MCP setup per tool | `lib/setup.ts` | ✅ exists (`setupMcp()`) |
| File sync targets | `commands/files.ts` | ✅ exists (`.agents/skills/`, `.agents/commands/`, etc.) |
| File ingest/apply | `commands/files.ts` | ✅ exists |
| Generate command | `commands/generate.ts` | ✅ exists (needs refactor to two-step pipeline) |
| Memory types | `lib/memory.ts` | ✅ exists (needs `skill` type + new columns) |

---

## Implementation Order

- [ ] **1a**: Schema migration — add `paths`, `category`, `metadata` columns to `memories` table
- [ ] **1b**: Update `Memory` interface + `addMemory()` / `updateMemory()` to handle new fields
- [ ] **1c**: Add `skill` to `MemoryType` union
- [ ] **2a**: Add `--paths` and `--category` flags to `memories add` and `memories edit` CLI
- [ ] **2b**: Update MCP `add_memory` tool with new optional parameters
- [ ] **3a**: `.agents/` generator — write `instructions.md` from rules/decisions/facts
- [ ] **3b**: `.agents/` generator — write `rules/*.md` from path-scoped memories
- [ ] **3c**: `.agents/` generator — write `skills/**/SKILL.md` from skill-type memories
- [ ] **3d**: `.agents/` generator — write `settings.json` (future: from permission-type memories)
- [ ] **4a**: Claude Code adapter — translate `.agents/` → `.claude/` + `CLAUDE.md`
- [ ] **4b**: Cursor adapter — translate `.agents/` → `.cursor/` (paths→globs, md→mdc)
- [ ] **4c**: Flat-file adapters — merge `.agents/` into single file per target
- [ ] **5a**: Enhanced ingestion — parse `.claude/rules/*.md` with paths frontmatter
- [ ] **5b**: Enhanced ingestion — parse `.cursor/rules/*.mdc` with globs frontmatter
- [ ] **5c**: Enhanced ingestion — parse SKILL.md files into skill-type memories

---

## What This Unlocks

1. **True portability**: `memories generate all` gives every installed tool its richest possible config from one source
2. **Skills everywhere**: One skill definition in `.agents/skills/` works in Claude Code, Cursor, and every Agent Skills-compatible tool
3. **Path scoping**: Rules like "Use RESTful naming" only apply when working in `src/api/**`, not globally
4. **Progressive adoption**: All changes are additive. Existing memories, generation, and CLI work unchanged.
5. **MCP as the bridge**: The MCP server already works with every tool. Adding `paths` and `category` to `add_memory` lets agents store richer context that generates richer configs.
