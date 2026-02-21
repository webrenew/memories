# MCP Tools Reference

Complete reference for all memories.sh MCP tools.

## Table of Contents

- [get_context](#get_context)
- [add_memory](#add_memory)
- [search_memories](#search_memories)
- [get_rules](#get_rules)
- [list_memories](#list_memories)
- [edit_memory](#edit_memory)
- [forget_memory](#forget_memory)
- [bulk_forget_memories](#bulk_forget_memories)
- [vacuum_memories](#vacuum_memories)
- [Local Reminder Tools](#local-reminder-tools)
- [Streaming Tools](#streaming-tools)

---

## get_context

**The primary tool for AI agents.** Returns active rules + relevant memories in one call.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | No | — | What you're working on — used to find relevant memories |
| `project_id` | string | No | — | Project identifier (e.g., `github.com/user/repo`) for project-specific rules |
| `limit` | number | No | 5 | Max memories to return (rules always included) |

**Returns:** Markdown with `## Project Rules` and `## Global Rules` sections + `## Relevant Memories` section. Uses FTS5 with BM25 ranking (LIKE fallback for older databases).

**When to use:** At the start of any task. Call with no query to get just rules.

```
get_context({ query: "database migration" })
→ ## Active Rules
→ - Always use TypeScript strict mode
→ - Run migrations in a transaction
→ ## Relevant to: "database migration"
→ 💡 DECISION (P) abc123: Chose Drizzle ORM for type-safe migrations
→ 📋 FACT (P) def456: Production DB is PostgreSQL 15 on Supabase
```

---

## add_memory

Store a new memory with optional metadata, path scoping, and categorization.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `content` | string | Yes | — | The memory content |
| `type` | `"rule" \| "decision" \| "fact" \| "note" \| "skill"` | No | `"note"` | Memory type |
| `global` | boolean | No | `false` | Store as global memory |
| `project_id` | string | No | — | Explicit project identifier (e.g., `github.com/org/repo`) to force project scope when outside that repo |
| `tags` | string[] | No | — | Tags for categorization |
| `paths` | string[] | No | — | Glob patterns for path-scoped rules (e.g., `["src/api/**"]`) |
| `category` | string | No | — | Grouping key (becomes rule filename or skill directory) |
| `metadata` | object | No | — | Extended attributes (JSON, primarily for skills) |

`global` and `project_id` are mutually exclusive in a single request.

**Returns:** Confirmation with memory ID, type label, and scope.

**Type selection guide:**
- `rule` — Standards that should always be followed: "Use pnpm, not npm"
- `decision` — Choices with rationale: "Chose PostgreSQL for JSONB support"
- `fact` — Knowledge to recall later: "API rate limit is 100 req/min"
- `note` — Everything else (default)
- `skill` — Reusable agent workflows (use with `category` and `metadata`)

```
add_memory({
  content: "API rate limit is 100 requests per minute",
  type: "fact",
  project_id: "github.com/webrenew/agent-space",
  tags: ["api", "limits"]
})
→ Stored fact (project: github.com/webrenew/agent-space): API rate limit is 100 requests per minute
```

---

## search_memories

Full-text search across memories with BM25 ranking. Uses FTS5 when available, falling back to LIKE matching.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query |
| `project_id` | string | No | — | Project identifier to include project-specific memories |
| `type` | string | No | — | Filter: `"rule"`, `"decision"`, `"fact"`, `"note"`, `"skill"` |
| `limit` | number | No | 10 | Max results |

**Returns:** Formatted list of matching memories ranked by relevance. Includes both global and project-scoped.

```
search_memories({ query: "auth", type: "decision" })
→ Found 2 memories:
→ [decision] Chose JWT for stateless authentication (global)
→ [decision] Always use bcrypt for password hashing (@my-app)
```

---

## get_rules

Get all active rules, split by global and project scope.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_id` | string | No | — | Project identifier to include project-specific rules |

**Returns:** Rules split into `## Project Rules` and `## Global Rules` sections.

```
get_rules({})
→ ## Global Rules
→ - Always use TypeScript strict mode
→ ## Project Rules
→ - Use pnpm as package manager
→ - Run tests before committing
```

---

## list_memories

List recent memories with optional filters.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string | No | — | Filter by type: `"rule"`, `"decision"`, `"fact"`, `"note"`, `"skill"` |
| `tags` | string | No | — | Filter by tag (substring match — `"test"` also matches `"testing"`) |
| `project_id` | string | No | — | Project identifier to include project-specific memories |
| `limit` | number | No | 20 | Max results |

**Returns:** Formatted list of memories. Includes both global and project-scoped.

---

## edit_memory

Update an existing memory. Find the ID first with `search_memories` or `list_memories`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | string | Yes | — | Memory ID to edit |
| `content` | string | No | — | New content |
| `type` | string | No | — | New type (`rule`, `decision`, `fact`, `note`, `skill`) |
| `tags` | string[] | No | — | New tags (replaces existing) |
| `paths` | string[] | No | — | New glob patterns for path scoping |
| `category` | string | No | — | New grouping key |
| `metadata` | object | No | — | New extended attributes |

At least one field besides `id` must be provided.

---

## forget_memory

Soft-delete a memory by ID (recoverable).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | string | Yes | — | Memory ID to forget |

---

## bulk_forget_memories

Bulk soft-delete memories matching filters. Use `dry_run: true` to preview matches before committing.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `types` | string[] | No | — | Filter by memory types (`rule`, `decision`, `fact`, `note`, `skill`) |
| `tags` | string[] | No | — | Filter by tags (substring match — `"test"` also matches `"testing"`) |
| `older_than_days` | integer | No | — | Delete memories older than N days (must be >= 1) |
| `pattern` | string | No | — | Content pattern match (`*` = any chars, `?` = single char; matches anywhere in content) |
| `project_id` | string | No | — | Filter by project identifier |
| `all` | boolean | No | false | Delete all memories (cannot combine with other filters) |
| `dry_run` | boolean | No | false | Preview matching memories without deleting |

Provide at least one filter, or use `all: true`. The `all` flag cannot be combined with other filters.

**Returns:**
- `dry_run: true` — `count` and `memories[]` (each with `id`, `type`, `contentPreview`)
- `dry_run: false` — `count` and `ids[]` of deleted memories

```
bulk_forget_memories({
  types: ["note", "fact"],
  older_than_days: 90,
  dry_run: true
})
→ Found 23 memories matching filters (dry run — nothing deleted)
```

---

## vacuum_memories

Permanently purge all soft-deleted memories to reclaim storage space.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| *(none required)* | — | — | — | — |

**Returns:** `purged` count and `message` string.

```
vacuum_memories({})
→ Vacuumed 15 soft-deleted memories
```

---

## Local Reminder Tools

> **CLI local MCP only.** These tools are available when running `memories serve` from the CLI.

### add_reminder

Create a cron reminder.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cron_expression` | string | Yes | 5-field cron expression |
| `message` | string | Yes | Reminder text |
| `global` | boolean | No | Store globally |
| `project_id` | string | No | Explicit project scope override |

### list_reminders

List reminders in current scope.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `include_disabled` | boolean | No | Include disabled reminders |
| `project_id` | string | No | Explicit project scope override |

### run_due_reminders

Evaluate reminders due at current time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dry_run` | boolean | No | Preview without advancing schedule |
| `project_id` | string | No | Explicit project scope override |

### enable_reminder / disable_reminder / delete_reminder

| Tool | Parameter | Type | Required | Description |
|------|-----------|------|----------|-------------|
| `enable_reminder` | `id` | string | Yes | Enable reminder and recompute next trigger |
| `disable_reminder` | `id` | string | Yes | Disable reminder |
| `delete_reminder` | `id` | string | Yes | Delete reminder |

---

## Streaming Tools

> **CLI only.** These tools are available in the local CLI MCP server but not in the cloud MCP endpoint. They require in-process state (active streams) that cannot be maintained over HTTP.

For collecting content from SSE/streaming sources (v0 artifacts, Claude artifacts, etc.).

### start_memory_stream

Start a new collection stream.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `type` | string | No | `"note"` | Memory type |
| `tags` | string[] | No | — | Tags |
| `global` | boolean | No | `false` | Global scope |
| `project_id` | string | No | — | Explicit project identifier to force project scope |

**Returns:** `stream_id` string.

`global` and `project_id` are mutually exclusive in a single request.

### append_memory_chunk

Append content to an active stream.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `stream_id` | string | Yes | — | Stream ID from start |
| `chunk` | string | Yes | — | Content chunk |

**Returns:** Chunk count and total character count.

### finalize_memory_stream

Complete the stream and create the memory. Triggers embedding generation.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `stream_id` | string | Yes | — | Stream ID |

**Returns:** Created memory with ID, type, chunk count, and char count.

### cancel_memory_stream

Cancel without creating a memory. Discards all chunks.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `stream_id` | string | Yes | — | Stream ID |

### Streaming Workflow

```
1. start_memory_stream({ type: "note", tags: ["v0"], project_id: "github.com/webrenew/agent-space" })
   → stream_abc123

2. append_memory_chunk({ stream_id: "stream_abc123", chunk: "First part..." })
   → 1 chunk, 14 chars

3. append_memory_chunk({ stream_id: "stream_abc123", chunk: "Second part..." })
   → 2 chunks, 29 chars

4. finalize_memory_stream({ stream_id: "stream_abc123" })
   → Created 📝 NOTE xyz789 from 2 chunks (29 chars)
```
