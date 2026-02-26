import type { TursoClient } from "./types"
import { workingMemoryExpiresAt } from "./scope-parsers"

// ─── Schema State ─────────────────────────────────────────────────────────────

const memorySchemaEnsuredClients = new WeakSet<TursoClient>()
const memorySchemaEnsuredKeys = new Set<string>()
const MEMORY_SCHEMA_STATE_TABLE = "memory_schema_state"
const MEMORY_USER_ID_SCHEMA_STATE_KEY = "memory_user_id_v1"
const MEMORY_CONSOLIDATION_SCHEMA_STATE_KEY = "memory_consolidation_v1"
const MEMORY_EMBEDDINGS_SCHEMA_STATE_KEY = "memory_embeddings_v1"
const MEMORY_EMBEDDING_JOBS_SCHEMA_STATE_KEY = "memory_embedding_jobs_v1"
const MEMORY_EMBEDDING_BACKFILL_SCHEMA_STATE_KEY = "memory_embedding_backfill_v1"

// ─── Graph Schema ─────────────────────────────────────────────────────────────

async function ensureGraphSchema(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      node_key TEXT NOT NULL,
      label TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
  await turso.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_type_key ON graph_nodes(node_type, node_key)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type)")

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 1.0,
      evidence_memory_id TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_edges_from_node_id ON graph_edges(from_node_id)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_edges_to_node_id ON graph_edges(to_node_id)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_edges_type_from_node_id ON graph_edges(edge_type, from_node_id)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_edges_expires_at ON graph_edges(expires_at)")

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_node_links (
      memory_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (memory_id, node_id, role)
    )`
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memory_node_links_node_id ON memory_node_links(node_id)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memory_node_links_memory_id ON memory_node_links(memory_id)")

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_rollout_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'off',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    )`
  )

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_rollout_metrics (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      mode TEXT NOT NULL,
      requested_strategy TEXT NOT NULL,
      applied_strategy TEXT NOT NULL,
      shadow_executed INTEGER NOT NULL DEFAULT 0,
      baseline_candidates INTEGER NOT NULL DEFAULT 0,
      graph_candidates INTEGER NOT NULL DEFAULT 0,
      graph_expanded_count INTEGER NOT NULL DEFAULT 0,
      total_candidates INTEGER NOT NULL DEFAULT 0,
      fallback_triggered INTEGER NOT NULL DEFAULT 0,
      fallback_reason TEXT,
      project_id TEXT,
      user_id TEXT,
      semantic_model TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0
    )`
  )

  const rolloutMetricColumns = await turso.execute("PRAGMA table_info(graph_rollout_metrics)")
  const rolloutColumnRows = Array.isArray(rolloutMetricColumns.rows) ? rolloutMetricColumns.rows : []
  const hasProjectIdColumn = rolloutColumnRows.some((row) => String((row as { name?: unknown }).name ?? "") === "project_id")
  const hasUserIdColumn = rolloutColumnRows.some((row) => String((row as { name?: unknown }).name ?? "") === "user_id")
  const hasSemanticModelColumn = rolloutColumnRows.some(
    (row) => String((row as { name?: unknown }).name ?? "") === "semantic_model"
  )
  const hasDurationColumn = rolloutColumnRows.some((row) => String((row as { name?: unknown }).name ?? "") === "duration_ms")
  if (!hasProjectIdColumn) {
    try {
      await turso.execute("ALTER TABLE graph_rollout_metrics ADD COLUMN project_id TEXT")
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ""
      if (!message.includes("duplicate column name")) {
        throw error
      }
    }
  }
  if (!hasUserIdColumn) {
    try {
      await turso.execute("ALTER TABLE graph_rollout_metrics ADD COLUMN user_id TEXT")
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ""
      if (!message.includes("duplicate column name")) {
        throw error
      }
    }
  }
  if (!hasSemanticModelColumn) {
    try {
      await turso.execute("ALTER TABLE graph_rollout_metrics ADD COLUMN semantic_model TEXT")
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ""
      if (!message.includes("duplicate column name")) {
        throw error
      }
    }
  }
  if (!hasDurationColumn) {
    try {
      await turso.execute("ALTER TABLE graph_rollout_metrics ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0")
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ""
      if (!message.includes("duplicate column name")) {
        throw error
      }
    }
  }

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_created_at ON graph_rollout_metrics(created_at)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_mode ON graph_rollout_metrics(mode)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_fallback ON graph_rollout_metrics(fallback_triggered, created_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_project_created_at ON graph_rollout_metrics(project_id, created_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_user_created_at ON graph_rollout_metrics(user_id, created_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_model_created_at ON graph_rollout_metrics(semantic_model, created_at)"
  )
}

// ─── Session Schema ───────────────────────────────────────────────────────────

async function ensureSessionSchema(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_sessions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      user_id TEXT,
      client TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      title TEXT,
      started_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      ended_at TEXT,
      metadata TEXT
    )`
  )

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      turn_index INTEGER,
      is_meaningful INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`
  )

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_session_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      source_trigger TEXT NOT NULL,
      transcript_md TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`
  )

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_sessions_scope ON memory_sessions(scope, project_id, user_id, status)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_session_events_session ON memory_session_events(session_id, created_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_session_snapshots_session ON memory_session_snapshots(session_id, created_at)"
  )
}

async function ensureCompactionSchema(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_compaction_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      token_count_before INTEGER,
      turn_count_before INTEGER,
      summary_tokens INTEGER,
      checkpoint_memory_id TEXT,
      created_at TEXT NOT NULL
    )`
  )

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_compaction_session ON memory_compaction_events(session_id, created_at)"
  )
}

async function ensureConsolidationSchema(turso: TursoClient): Promise<void> {
  const columns = await memoryColumns(turso)

  if (!columns.has("upsert_key")) {
    await turso.execute("ALTER TABLE memories ADD COLUMN upsert_key TEXT")
  }
  if (!columns.has("source_session_id")) {
    await turso.execute("ALTER TABLE memories ADD COLUMN source_session_id TEXT")
  }
  if (!columns.has("superseded_by")) {
    await turso.execute("ALTER TABLE memories ADD COLUMN superseded_by TEXT")
  }
  if (!columns.has("superseded_at")) {
    await turso.execute("ALTER TABLE memories ADD COLUMN superseded_at TEXT")
  }
  if (!columns.has("confidence")) {
    await turso.execute("ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0")
  }
  if (!columns.has("last_confirmed_at")) {
    await turso.execute("ALTER TABLE memories ADD COLUMN last_confirmed_at TEXT")
  }

  await turso.execute("UPDATE memories SET confidence = 1.0 WHERE confidence IS NULL")

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memories_upsert_key ON memories(scope, project_id, type, upsert_key)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memories_source_session ON memories(source_session_id)"
  )
  await turso.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_upsert_live
     ON memories(scope, project_id, user_id, type, upsert_key)
     WHERE upsert_key IS NOT NULL AND deleted_at IS NULL AND superseded_at IS NULL`
  )

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_consolidation_runs (
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
    )`
  )
}

// ─── Skill File Schema ────────────────────────────────────────────────────────

async function ensureSkillFileSchema(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS skill_files (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      user_id TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      procedure_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`
  )

  const result = await turso.execute("PRAGMA table_info(skill_files)")
  const columns = new Set(
    (Array.isArray(result.rows) ? result.rows : [])
      .map((row) => String((row as { name?: unknown }).name ?? ""))
      .filter((name) => name.length > 0)
  )

  if (!columns.has("usage_count")) {
    await turso.execute("ALTER TABLE skill_files ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0")
  }
  if (!columns.has("last_used_at")) {
    await turso.execute("ALTER TABLE skill_files ADD COLUMN last_used_at TEXT")
  }
  if (!columns.has("procedure_key")) {
    await turso.execute("ALTER TABLE skill_files ADD COLUMN procedure_key TEXT")
  }

  await turso.execute("UPDATE skill_files SET usage_count = 0 WHERE usage_count IS NULL")

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_scope_project_path ON skill_files(scope, project_id, path)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_user_scope_project ON skill_files(user_id, scope, project_id)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_updated_at ON skill_files(updated_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_usage ON skill_files(scope, project_id, usage_count DESC, updated_at DESC)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_procedure_key ON skill_files(procedure_key)"
  )
}

// ─── Embedding Schema ──────────────────────────────────────────────────────────

async function ensureEmbeddingSchema(turso: TursoClient): Promise<void> {
  // Rollback path: DROP TABLE memory_embeddings;
  // then clear marker: DELETE FROM memory_schema_state WHERE key = 'memory_embeddings_v1';
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      model_version TEXT NOT NULL DEFAULT 'v1',
      dimension INTEGER NOT NULL CHECK (dimension > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model_dimension ON memory_embeddings(model, dimension)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model_version ON memory_embeddings(model, model_version)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memory_embeddings_created_at ON memory_embeddings(created_at)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memory_embeddings_updated_at ON memory_embeddings(updated_at)")
}

async function ensureEmbeddingJobSchema(turso: TursoClient): Promise<void> {
  // Rollback path: DROP TABLE memory_embedding_jobs;
  // DROP TABLE memory_embedding_job_metrics;
  // then clear marker: DELETE FROM memory_schema_state WHERE key = 'memory_embedding_jobs_v1';
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_embedding_jobs (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      model TEXT NOT NULL,
      content TEXT NOT NULL,
      model_version TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
      next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      claimed_by TEXT,
      claimed_at TEXT,
      last_error TEXT,
      dead_letter_reason TEXT,
      dead_letter_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(memory_id, model)
    )`
  )

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_status_next_attempt ON memory_embedding_jobs(status, next_attempt_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_memory_status ON memory_embedding_jobs(memory_id, status)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_claimed_at ON memory_embedding_jobs(claimed_at)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_dead_letter_at ON memory_embedding_jobs(dead_letter_at)"
  )

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_embedding_job_metrics (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      model TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      outcome TEXT NOT NULL,
      duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_job_metrics_job_created_at ON memory_embedding_job_metrics(job_id, created_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_job_metrics_outcome_created_at ON memory_embedding_job_metrics(outcome, created_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_job_metrics_created_at ON memory_embedding_job_metrics(created_at)"
  )
}

async function ensureEmbeddingBackfillSchema(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_embedding_backfill_state (
      scope_key TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      checkpoint_created_at TEXT,
      checkpoint_memory_id TEXT,
      scanned_count INTEGER NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
      enqueued_count INTEGER NOT NULL DEFAULT 0 CHECK (enqueued_count >= 0),
      estimated_total INTEGER NOT NULL DEFAULT 0 CHECK (estimated_total >= 0),
      estimated_remaining INTEGER NOT NULL DEFAULT 0 CHECK (estimated_remaining >= 0),
      estimated_completion_seconds INTEGER,
      batch_limit INTEGER NOT NULL DEFAULT 100 CHECK (batch_limit > 0),
      throttle_ms INTEGER NOT NULL DEFAULT 25 CHECK (throttle_ms >= 0),
      started_at TEXT,
      last_run_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_error TEXT
    )`
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_backfill_state_status_updated ON memory_embedding_backfill_state(status, updated_at)"
  )

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_embedding_backfill_metrics (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      model TEXT NOT NULL,
      batch_scanned INTEGER NOT NULL DEFAULT 0 CHECK (batch_scanned >= 0),
      batch_enqueued INTEGER NOT NULL DEFAULT 0 CHECK (batch_enqueued >= 0),
      total_scanned INTEGER NOT NULL DEFAULT 0 CHECK (total_scanned >= 0),
      total_enqueued INTEGER NOT NULL DEFAULT 0 CHECK (total_enqueued >= 0),
      estimated_total INTEGER NOT NULL DEFAULT 0 CHECK (estimated_total >= 0),
      estimated_remaining INTEGER NOT NULL DEFAULT 0 CHECK (estimated_remaining >= 0),
      estimated_completion_seconds INTEGER,
      duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
      status TEXT NOT NULL,
      error TEXT,
      ran_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_backfill_metrics_scope_ran_at ON memory_embedding_backfill_metrics(scope_key, ran_at)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memory_embedding_backfill_metrics_status_ran_at ON memory_embedding_backfill_metrics(status, ran_at)"
  )
}

// ─── Schema State Helpers ─────────────────────────────────────────────────────

async function ensureSchemaStateTable(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS ${MEMORY_SCHEMA_STATE_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
}

async function isMemorySchemaMarked(turso: TursoClient, key: string): Promise<boolean> {
  const result = await turso.execute({
    sql: `SELECT value
          FROM ${MEMORY_SCHEMA_STATE_TABLE}
          WHERE key = ?
          LIMIT 1`,
    args: [key],
  })
  const rows = Array.isArray(result.rows) ? result.rows : []
  return String(rows[0]?.value ?? "") === "1"
}

async function markMemorySchemaApplied(turso: TursoClient, key: string): Promise<void> {
  await turso.execute({
    sql: `INSERT OR REPLACE INTO ${MEMORY_SCHEMA_STATE_TABLE} (key, value, updated_at)
          VALUES (?, '1', datetime('now'))`,
    args: [key],
  })
}

async function memoryColumns(turso: TursoClient): Promise<Set<string>> {
  const result = await turso.execute("PRAGMA table_info(memories)")
  const columns = new Set<string>()
  const rows = Array.isArray(result.rows) ? result.rows : []
  for (const row of rows) {
    const name = row.name
    if (typeof name === "string" && name.length > 0) {
      columns.add(name)
    }
  }
  return columns
}

// ─── Main Schema Migration ────────────────────────────────────────────────────

export interface EnsureMemoryUserIdSchemaOptions {
  cacheKey?: string | null
}

export async function ensureMemoryUserIdSchema(
  turso: TursoClient,
  options: EnsureMemoryUserIdSchemaOptions = {}
): Promise<void> {
  const normalizedCacheKey =
    typeof options.cacheKey === "string" && options.cacheKey.trim().length > 0
      ? options.cacheKey.trim()
      : null

  if (memorySchemaEnsuredClients.has(turso)) {
    return
  }
  if (normalizedCacheKey && memorySchemaEnsuredKeys.has(normalizedCacheKey)) {
    memorySchemaEnsuredClients.add(turso)
    return
  }

  await ensureSchemaStateTable(turso)
  if (!(await isMemorySchemaMarked(turso, MEMORY_USER_ID_SCHEMA_STATE_KEY))) {
    const columns = await memoryColumns(turso)

    if (!columns.has("user_id")) {
      await turso.execute("ALTER TABLE memories ADD COLUMN user_id TEXT")
    }

    if (!columns.has("memory_layer")) {
      await turso.execute("ALTER TABLE memories ADD COLUMN memory_layer TEXT NOT NULL DEFAULT 'long_term'")
    }

    if (!columns.has("expires_at")) {
      await turso.execute("ALTER TABLE memories ADD COLUMN expires_at TEXT")
    }

    await turso.execute(
      "UPDATE memories SET memory_layer = 'rule' WHERE (memory_layer IS NULL OR memory_layer = 'long_term') AND type = 'rule'"
    )
    await turso.execute("UPDATE memories SET memory_layer = 'long_term' WHERE memory_layer IS NULL")
    const defaultExpiresAt = workingMemoryExpiresAt(new Date().toISOString())
    await turso.execute({
      sql: "UPDATE memories SET expires_at = ? WHERE memory_layer = 'working' AND expires_at IS NULL",
      args: [defaultExpiresAt],
    })

    await turso.execute(
      "CREATE INDEX IF NOT EXISTS idx_memories_user_scope_project ON memories(user_id, scope, project_id)"
    )
    await turso.execute(
      "CREATE INDEX IF NOT EXISTS idx_memories_layer_scope_project ON memories(memory_layer, scope, project_id)"
    )
    await turso.execute("CREATE INDEX IF NOT EXISTS idx_memories_layer_expires ON memories(memory_layer, expires_at)")
    await markMemorySchemaApplied(turso, MEMORY_USER_ID_SCHEMA_STATE_KEY)
  }

  await ensureSessionSchema(turso)
  await ensureCompactionSchema(turso)
  await ensureConsolidationSchema(turso)
  if (!(await isMemorySchemaMarked(turso, MEMORY_CONSOLIDATION_SCHEMA_STATE_KEY))) {
    await markMemorySchemaApplied(turso, MEMORY_CONSOLIDATION_SCHEMA_STATE_KEY)
  }
  await ensureGraphSchema(turso)
  await ensureSkillFileSchema(turso)
  await ensureEmbeddingSchema(turso)
  if (!(await isMemorySchemaMarked(turso, MEMORY_EMBEDDINGS_SCHEMA_STATE_KEY))) {
    await markMemorySchemaApplied(turso, MEMORY_EMBEDDINGS_SCHEMA_STATE_KEY)
  }
  await ensureEmbeddingJobSchema(turso)
  if (!(await isMemorySchemaMarked(turso, MEMORY_EMBEDDING_JOBS_SCHEMA_STATE_KEY))) {
    await markMemorySchemaApplied(turso, MEMORY_EMBEDDING_JOBS_SCHEMA_STATE_KEY)
  }
  await ensureEmbeddingBackfillSchema(turso)
  if (!(await isMemorySchemaMarked(turso, MEMORY_EMBEDDING_BACKFILL_SCHEMA_STATE_KEY))) {
    await markMemorySchemaApplied(turso, MEMORY_EMBEDDING_BACKFILL_SCHEMA_STATE_KEY)
  }

  memorySchemaEnsuredClients.add(turso)
  if (normalizedCacheKey) {
    memorySchemaEnsuredKeys.add(normalizedCacheKey)
  }
}
