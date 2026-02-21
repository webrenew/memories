# Architecture Deep-Dive

Detailed module descriptions, data flow, and patterns for the memories.sh codebase.

## Table of Contents

- [Data Flow](#data-flow)
- [Database Layer (db.ts)](#database-layer)
- [Memory Layer (memory.ts)](#memory-layer)
- [Embeddings (embeddings.ts)](#embeddings)
- [Project Detection (git.ts)](#project-detection)
- [Cloud Sync (turso.ts)](#cloud-sync)
- [Auth (auth.ts)](#auth)
- [Tool Detection (setup.ts)](#tool-detection)
- [MCP Server](#mcp-server)
- [Web App](#web-app)
- [Testing Patterns](#testing-patterns)

---

## Data Flow

### Write Path
```
User input → CLI command or MCP tool
  → memory.ts (addMemory)
    → db.ts (INSERT into memories)
    → FTS5 trigger auto-updates memories_fts
    → embeddings.ts (async, generates embedding)
    → memory_embeddings table
```

### Read Path
```
Query → memory.ts (searchMemories or getContext)
  → FTS5 MATCH query (full-text search)
  OR → embeddings.ts cosine similarity (semantic search)
  → Merge global + project-scoped results
  → Format and return
```

### Sync Path
```
memories sync → turso.ts
  → auth.ts (get token)
  → Provision Turso DB if needed (via web API)
  → Configure embedded replica (local SQLite ↔ Turso)
  → Push/pull changes
```

---

## Database Layer

**File:** `packages/cli/src/lib/db.ts`

- Uses `@libsql/client` (SQLite-compatible, Turso-ready)
- `getDb()` — singleton, lazy-initializes with schema migrations
- Data directory: `MEMORIES_DATA_DIR` env var or `~/.config/memories/`
- Schema versioning via `schema_version` table

**Key tables:**
- `memories` — Core storage with soft-delete (deleted_at)
- `memories_fts` — FTS5 virtual table with INSERT/UPDATE/DELETE triggers
- `memory_embeddings` — Float array stored as JSON text
- `memory_links` — Self-referencing many-to-many
- `memory_history` — Append-only version log

**Migrations** run automatically on `getDb()`. Each migration checks `schema_version` before applying.

---

## Memory Layer

**File:** `packages/cli/src/lib/memory.ts`

Core CRUD + search operations. All functions accept optional `projectId` for scoping.

**Key exports:**
- `addMemory(content, opts)` — Insert + optional auto-embed
- `searchMemories(query, opts)` — FTS5 MATCH with ranking
- `listMemories(opts)` — Paginated listing with filters
- `forgetMemory(id)` — Soft-delete (sets deleted_at)
- `bulkForgetMemories(filters)` — Filtered mass soft-delete by type, tags, age, pattern
- `vacuumMemories()` — Hard-delete all soft-deleted records
- `updateMemory(id, opts)` — Update content/type/tags + history
- `getContext(query, opts)` — Rules + relevant memories (primary API)
- `getRules(opts)` — All type=rule memories

**Streaming API** (for SSE content collection):
- `startMemoryStream(opts)` → stream_id
- `appendMemoryChunk(id, chunk)` — In-memory buffer
- `finalizeMemoryStream(id)` → Memory (joins chunks, persists)
- `cancelMemoryStream(id)` — Discard buffer

Streams are stored in a module-level `Map<string, StreamState>`, not in the database.

---

## Embeddings

**File:** `packages/cli/src/lib/embeddings.ts`

- Uses `@xenova/transformers` for local inference (no API calls)
- Model downloads on first use to `~/.config/memories/models/`
- Configurable model via `memories config model`
- `generateEmbedding(text)` → float array
- `cosineSimilarity(a, b)` → number
- `semanticSearch(query, opts)` — Generates query embedding, compares against stored embeddings

---

## Project Detection

**File:** `packages/cli/src/lib/git.ts`

- `getProjectId()` — Extracts project identifier from git remote URL
- Returns `null` if not in a git repo
- Used everywhere to scope memories to the current project
- Normalizes different remote formats (HTTPS, SSH) to a consistent ID

---

## Cloud Sync

**File:** `packages/cli/src/lib/turso.ts`

- Turso embedded replicas: local SQLite file syncs bidirectionally with Turso cloud
- `syncDatabase()` — Push local changes, pull remote
- Provisions database via web API (`/api/db/provision`)
- Gets credentials via web API (`/api/db/credentials`)

---

## Auth

**File:** `packages/cli/src/lib/auth.ts`

- Device code flow (browser-based)
- Token stored locally at `~/.config/memories/auth.json`
- `getToken()`, `saveToken()`, `clearToken()`
- `isAuthenticated()` — Check if valid token exists

---

## Tool Detection

**File:** `packages/cli/src/lib/setup.ts`

Detects installed AI coding tools and configures MCP:

| Tool | MCP Config Path | Key Name |
|------|----------------|----------|
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| Claude Code | `.mcp.json` | `mcpServers` |
| Windsurf | `.windsurf/mcp.json` | `mcpServers` |
| VS Code | `.vscode/mcp.json` | `servers` |

`detectTools()` checks both project-level and global (`~/`) paths.

---

## MCP Server

**File:** `packages/cli/src/mcp/index.ts`

- Uses `@modelcontextprotocol/sdk`
- `createMcpServer()` — Factory that registers all tools + resources
- Two transport modes:
  - **stdio** (`StdioServerTransport`) — For CLI tools (Claude Code, Cursor)
  - **HTTP** (`StreamableHTTPServerTransport`) — For web clients (v0)
- HTTP server uses stateless mode (no session IDs)
- Tools call into `memory.ts` functions directly

---

## Web App

**Location:** `packages/web/`

- Next.js 16 with App Router
- Supabase Auth (SSR via `@supabase/ssr`)
- Fumadocs for documentation (`content/docs/`)
- Stripe for payments
- Shared types at `src/types/memory.ts` (canonical `Memory`, `MemoryType`, `Scope`)
- Zod validation at `src/lib/validations.ts`
- API routes under `src/app/api/`

**Key API routes:**
- `/api/memories` — CRUD (GET, POST, PATCH, DELETE) with full field set (paths, category, metadata)
- `/api/auth/cli` — Device code flow endpoint
- `/api/db/provision` — Turso DB provisioning
- `/api/mcp` — Cloud MCP endpoint (core memory tools with FTS5 search + LIKE fallback). Local CLI MCP additionally exposes reminder and streaming-only tools.

---

## Testing Patterns

- **Framework:** Vitest
- **Isolation:** Tests use temp directories via `MEMORIES_DATA_DIR` env var
- **Mocking:** Minimal — tests hit real SQLite (in-memory or temp file)
- **Test files:** Co-located with source (`*.test.ts`)

```bash
# Run all tests
pnpm test

# Run specific test
cd packages/cli && pnpm vitest run src/commands/edit.test.ts

# Watch mode
cd packages/cli && pnpm vitest
```
