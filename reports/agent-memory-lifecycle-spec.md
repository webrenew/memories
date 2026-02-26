# RFC: Agent Memory Lifecycle (Session + Long-Term + OpenClaw File Mode)

- Status: Proposed
- Authors: memories team
- Created: 2026-02-26
- Target release: phased rollout over 7 phases

## Summary

This RFC defines a full memory lifecycle for memories.sh:

1. Durable long-term memory with consolidation and overwrite semantics.
2. Explicit session memory with compaction-safe checkpointing.
3. OpenClaw-compatible file memory mode (`memory.md`, daily logs, raw snapshots) with deterministic read/write triggers.

The implementation keeps current retrieval strengths (`get_context`, graph expansion, scope isolation) while adding first-class session orchestration and memory hygiene.

## Goals

1. Make session memory explicit and reliable across tool transports.
2. Prevent context loss during compaction via write-ahead checkpoints.
3. Keep semantic memory small, stable, and always injectable.
4. Support append-only episodic memory and high-fidelity raw snapshots.
5. Resolve duplicates and outdated truths with deterministic overwrite rules.
6. Preserve existing local-first behavior and compatibility.

## Non-goals

1. Replacing FTS/graph retrieval with vector-only retrieval.
2. Shipping a mandatory external vector database.
3. Forcing OpenClaw file mode for users who prefer DB-only memory.

## Canonical Model

1. Session memory: active conversation context and transient working memory.
2. Long-term semantic memory: stable facts/preferences/identity/rules.
3. Long-term episodic memory: daily logs and snapshots.
4. Procedural memory: reusable workflows (skill-like artifacts with usage signals).

Routing rules:

1. `remember this` or explicit pinning stores with `remember_intent=explicit`.
2. Session checkpoints store episodic entries and optional semantic candidates.
3. Consolidation promotes or overwrites long-term semantic entries.

## Concrete Schema Diffs

### Phase 1: CLI/Web Memory Parity

Applies in:

- `/Users/tradecraft/dev/memories/packages/cli/src/lib/db.ts`
- `/Users/tradecraft/dev/memories/packages/cli/src/lib/memory.ts`
- `/Users/tradecraft/dev/memories/packages/web/src/lib/memory-service/scope-schema.ts`

SQL (local CLI migration):

```sql
ALTER TABLE memories ADD COLUMN memory_layer TEXT NOT NULL DEFAULT 'long_term';
ALTER TABLE memories ADD COLUMN expires_at TEXT;
ALTER TABLE memories ADD COLUMN upsert_key TEXT;
ALTER TABLE memories ADD COLUMN source_session_id TEXT;
ALTER TABLE memories ADD COLUMN superseded_by TEXT;
ALTER TABLE memories ADD COLUMN superseded_at TEXT;
ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN last_confirmed_at TEXT;

UPDATE memories SET memory_layer = 'rule'
WHERE (memory_layer IS NULL OR memory_layer = 'long_term') AND type = 'rule';
UPDATE memories SET memory_layer = 'long_term' WHERE memory_layer IS NULL;

CREATE INDEX IF NOT EXISTS idx_memories_layer_scope_project
  ON memories(memory_layer, scope, project_id);
CREATE INDEX IF NOT EXISTS idx_memories_layer_expires
  ON memories(memory_layer, expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_upsert_key
  ON memories(scope, project_id, type, upsert_key);
CREATE INDEX IF NOT EXISTS idx_memories_source_session
  ON memories(source_session_id);
```

### Phase 2: Session Tables

Applies in:

- `/Users/tradecraft/dev/memories/packages/cli/src/lib/db.ts`
- `/Users/tradecraft/dev/memories/packages/web/src/lib/memory-service/scope-schema.ts`

SQL:

```sql
CREATE TABLE IF NOT EXISTS memory_sessions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT,
  user_id TEXT,
  client TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active|compacted|closed
  title TEXT,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  ended_at TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS memory_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- user|assistant|tool
  kind TEXT NOT NULL, -- message|checkpoint|summary|event
  content TEXT NOT NULL,
  token_count INTEGER,
  turn_index INTEGER,
  is_meaningful INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_session_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  source_trigger TEXT NOT NULL, -- new_session|reset|manual|auto_compaction
  transcript_md TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_sessions_scope ON memory_sessions(scope, project_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_session_events_session ON memory_session_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_session_snapshots_session ON memory_session_snapshots(session_id, created_at);
```

### Phase 3: Compaction Tracking

SQL:

```sql
CREATE TABLE IF NOT EXISTS memory_compaction_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- count|time|semantic
  reason TEXT NOT NULL,
  token_count_before INTEGER,
  turn_count_before INTEGER,
  summary_tokens INTEGER,
  checkpoint_memory_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_compaction_session ON memory_compaction_events(session_id, created_at);
```

### Phase 5: Consolidation Audit

SQL:

```sql
CREATE TABLE IF NOT EXISTS memory_consolidation_runs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT,
  user_id TEXT,
  input_count INTEGER NOT NULL,
  merged_count INTEGER NOT NULL,
  superseded_count INTEGER NOT NULL,
  conflicted_count INTEGER NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  metadata TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_upsert_live
  ON memories(scope, project_id, user_id, type, upsert_key)
  WHERE upsert_key IS NOT NULL AND deleted_at IS NULL AND superseded_at IS NULL;
```

### Phase 6: Procedural Usage Signals

SQL:

```sql
ALTER TABLE skill_files ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_files ADD COLUMN last_used_at TEXT;
ALTER TABLE skill_files ADD COLUMN procedure_key TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_files_usage ON skill_files(scope, project_id, usage_count DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_files_procedure_key ON skill_files(procedure_key);
```

## Concrete API Diffs

### Core Types (`packages/core`)

Add fields:

1. `MemoryRecord`: `upsertKey`, `sourceSessionId`, `supersededBy`, `supersededAt`, `confidence`, `lastConfirmedAt`.
2. `ContextGetInput`: `sessionId`, `budgetTokens`, `includeSessionSummary`.
3. `MemoryAddInput`: `upsertKey`, `sessionId`, `rememberIntent`.
4. `ContextResult`: `session` block with compaction hints.

### SDK HTTP (`packages/web/src/app/api/sdk/v1`)

Update:

1. `POST /context/get`: accepts `sessionId`, `budgetTokens`; returns `session.compactionRequired`, `session.triggerHint`, `session.latestCheckpointId`.
2. `POST /memories/add`: accepts `upsertKey`, `sessionId`, `rememberIntent`.
3. `POST /memories/edit`: accepts `upsertKey`, `rememberIntent`.

Add:

1. `POST /sessions/start`
2. `POST /sessions/checkpoint`
3. `POST /sessions/end`
4. `GET /sessions/{id}/snapshot`
5. `POST /memories/consolidate`

### MCP Tool Surface (`packages/cli/src/mcp`)

Update:

1. `get_context`: add `session_id`, `budget_tokens`, `mode`.
2. `add_memory`: add `upsert_key`, `session_id`, `remember_intent`.

Add:

1. `start_session`
2. `checkpoint_session`
3. `end_session`
4. `snapshot_session`
5. `consolidate_memories`

### CLI Surface (`packages/cli/src/commands`)

Update:

1. `add`, `list`, `search`, `recall`: add `--layer` and optional `--session-id`.
2. `stale` and `review`: include superseded/conflict/consolidation-aware filters.

Add:

1. `memories session start|checkpoint|end|status|snapshot`
2. `memories compact run`
3. `memories consolidate run`
4. `memories openclaw memory bootstrap|flush|snapshot|sync`

## OpenClaw File Mode Contract

Paths:

1. `~/.openclaw/workspace/memory.md` (semantic, capped at 200 lines by default).
2. `~/.openclaw/workspace/memory/daily/YYYY-MM-DD.md` (append-only episodic).
3. `~/.openclaw/workspace/memory/snapshots/YYYY-MM-DD/<slug>.md` (raw meaningful transcript slices).

Read triggers:

1. Session bootstrap reads `memory.md` and today/yesterday daily logs.
2. `get_context` may include latest snapshot headers when `includeSessionSummary=true`.

Write triggers:

1. Pre-compaction flush writes checkpoint to daily log.
2. `/new` or `/reset` writes raw snapshot before clearing session state.
3. Explicit `remember` routes semantic to `memory.md`, episodic to daily log.

## PR Sequence (All Phases)

### Phase 1: Parity

1. PR-1.1 `feat(cli): add memory_layer + expiry schema parity`
2. PR-1.2 `feat(cli/mcp): layer-aware add/list/search/recall and context modes`
3. PR-1.3 `test/docs: parity matrix tests and migration notes`

### Phase 2: Sessions

1. PR-2.1 `feat(schema): memory_sessions + events + snapshots`
2. PR-2.2 `feat(cli/mcp): session commands and session tools`
3. PR-2.3 `feat(sdk): /sessions/start|checkpoint|end|snapshot endpoints`

### Phase 3: Compaction

1. PR-3.1 `feat(compaction): token/turn budget estimator and trigger engine`
2. PR-3.2 `feat(compaction): write-ahead checkpoint + compaction event logging`
3. PR-3.3 `feat(compaction): inactivity worker and semantic completion hint support`

### Phase 4: OpenClaw File Mode

1. PR-4.1 `feat(openclaw): file memory router and deterministic path contract`
2. PR-4.2 `feat(openclaw): bootstrap reader + pre-compaction flush + reset snapshot hooks`
3. PR-4.3 `feat(openclaw): DB↔file import/export sync and docs`

### Phase 5: Consolidation + Overwrite

1. PR-5.1 `feat(schema): upsert_key + supersession fields + consolidation run table`
2. PR-5.2 `feat(consolidation): candidate extraction, dedupe, overwrite policy, conflict links`
3. PR-5.3 `feat(api/mcp/cli): consolidate endpoint/tool/command and review workflows`

### Phase 6: Procedural Memory

1. PR-6.1 `feat(skill-files): procedural usage metadata and ranking hooks`
2. PR-6.2 `feat(retrieval): procedural-first ranking when intent matches workflows`
3. PR-6.3 `feat(tooling): promote successful episodes to procedural memory`

### Phase 7: Observability + Rollout

1. PR-7.1 `feat(obs): lifecycle metrics, compaction loss metrics, contradiction trend metrics`
2. PR-7.2 `feat(eval): replay/eval harness for memory extraction and compaction quality`
3. PR-7.3 `chore(rollout): default-on flags, deprecate legacy paths, finalize docs`

## Delivery Tracker

- [x] Spec merged: `reports/agent-memory-lifecycle-spec.md` (PR #287, 2026-02-26)
- [x] PR-1.1 `feat(cli): add memory_layer + expiry schema parity` (merged: #288, 2026-02-26)
- [ ] PR-1.2 `feat(cli/mcp): layer-aware add/list/search/recall and context modes` (open: #290, auto-merge enabled)
- [ ] PR-1.3 `test/docs: parity matrix tests and migration notes` (in progress)
- [ ] Phase 2 PRs (2.1-2.3)
- [ ] Phase 3 PRs (3.1-3.3)
- [ ] Phase 4 PRs (4.1-4.3)
- [ ] Phase 5 PRs (5.1-5.3)
- [ ] Phase 6 PRs (6.1-6.3)
- [ ] Phase 7 PRs (7.1-7.3)

## Phase Gates and Acceptance

1. Phase 1 gate: CLI and hosted return equivalent `layer` behavior for add/list/search/context.
2. Phase 2 gate: session start/checkpoint/end works for CLI MCP and SDK API with parity tests.
3. Phase 3 gate: forced compaction never drops critical facts in golden replay set.
4. Phase 4 gate: OpenClaw workspace files remain consistent after 3 simulated session resets.
5. Phase 5 gate: duplicate preference updates collapse to one current truth with audit trail.
6. Phase 6 gate: procedural retrieval improves first-action success in workflow benchmark tasks.
7. Phase 7 gate: dashboard SLOs green for 14 days before default-on.

## Phase 1 Parity Matrix and Migration Notes

### Parity Matrix (CLI + MCP transport contracts)

| Surface | Input | Expected behavior |
| --- | --- | --- |
| `memories add` / `add_memory` | `layer=working` | Stores `memory_layer='working'` and assigns `expires_at` based on configured TTL |
| `memories list` / `list_memories` | `layer=long_term` | Returns only active long-term memories (rules/working excluded) |
| `memories search` / `search_memories` | `layer=working` | Returns only active working memories (FTS + fallback parity) |
| `memories recall` / `get_context` | `mode=rules_only` | Returns rules and zero memories |
| `memories recall` / `get_context` | `mode=working` | Returns rules + working memories only |
| `memories recall` / `get_context` | `mode=long_term` | Returns rules + long-term memories only |

### Migration Notes

1. Local DB migration introduces `memory_layer` + `expires_at` and backfills legacy rows for deterministic layer behavior.
2. Working-memory TTL defaults to 24h with env override precedence:
   `MEMORIES_WORKING_MEMORY_TTL_HOURS` then `MCP_WORKING_MEMORY_TTL_HOURS`.
3. CLI and MCP interfaces are backward compatible for type filters (`type` and `types`) and tags input (`list_memories.tags` accepts array or comma-separated string).
4. Validation command set for Phase 1 gate:
   - `pnpm -C packages/cli test src/lib/memory.test.ts src/commands/list.test.ts src/commands/search.test.ts src/commands/recall.test.ts src/mcp/tools.test.ts`
   - `pnpm -C packages/core test src/__tests__/mcp-parity-matrix.test.ts`

## Feature Flags

1. `MEMORY_SESSION_ENABLED`
2. `MEMORY_COMPACTION_ENABLED`
3. `MEMORY_OPENCLAW_FILE_MODE_ENABLED`
4. `MEMORY_CONSOLIDATION_ENABLED`
5. `MEMORY_PROCEDURAL_ENABLED`

## Risks and Mitigations

1. Risk: duplicated state between DB and file mode. Mitigation: deterministic source-of-truth precedence and bidirectional sync checksums.
2. Risk: over-aggressive consolidation. Mitigation: run in shadow mode first and store run audit rows.
3. Risk: session overhead/latency. Mitigation: async checkpointing and bounded event payload size.
4. Risk: migration drift between CLI local and hosted schema. Mitigation: parity test suite and schema-version assertions.
