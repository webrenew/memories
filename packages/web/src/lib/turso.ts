import { nanoid } from "nanoid"
import { createClient } from "@libsql/client"
import { getTursoPlatformApiToken } from "@/lib/env"

const API_BASE = "https://api.turso.tech/v1"

interface CreateDbResponse {
  database: {
    Name: string
    DbId: string
    Hostname: string
  }
}

interface CreateTokenResponse {
  jwt: string
}

async function api<T>(
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${getTursoPlatformApiToken()}`,
      "Content-Type": "application/json",
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Turso API error (${res.status}): ${text}`)
  }

  if (res.status === 204) {
    return {} as T
  }

  const contentType = res.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return {} as T
  }

  return res.json() as Promise<T>
}

export async function createDatabase(org: string): Promise<{
  name: string
  hostname: string
  dbId: string
}> {
  const name = `memories-${nanoid(8).toLowerCase()}`

  const { database } = await api<CreateDbResponse>(
    `/organizations/${org}/databases`,
    {
      method: "POST",
      body: { name, group: "default" },
    }
  )

  return {
    name: database.Name,
    hostname: database.Hostname,
    dbId: database.DbId,
  }
}

export async function createDatabaseToken(
  org: string,
  dbName: string
): Promise<string> {
  const { jwt } = await api<CreateTokenResponse>(
    `/organizations/${org}/databases/${dbName}/auth/tokens`,
    { method: "POST" }
  )
  return jwt
}

export async function deleteDatabase(org: string, dbName: string): Promise<void> {
  await api(`/organizations/${org}/databases/${dbName}`, { method: "DELETE" })
}

/**
 * Initialize the schema on a freshly provisioned Turso database.
 * Runs the same DDL the CLI uses so the web dashboard can query it.
 */
export async function initSchema(url: string, token: string): Promise<void> {
  const db = createClient({ url, authToken: token })

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      user_id TEXT,
      memory_layer TEXT NOT NULL DEFAULT 'long_term',
      expires_at TEXT,
      type TEXT NOT NULL DEFAULT 'note',
      paths TEXT,
      category TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`
  )

  // Keep schema compatible with CLI migrations for older or partially-initialized DBs.
  const tableInfo = await db.execute("PRAGMA table_info(memories)")
  const existingCols = new Set(
    (tableInfo.rows as unknown as Array<{ name: string }>).map((c) => c.name)
  )
  const requiredCols: Array<{ name: string; ddl: string }> = [
    { name: "scope", ddl: "TEXT NOT NULL DEFAULT 'global'" },
    { name: "project_id", ddl: "TEXT" },
    { name: "user_id", ddl: "TEXT" },
    { name: "memory_layer", ddl: "TEXT NOT NULL DEFAULT 'long_term'" },
    { name: "expires_at", ddl: "TEXT" },
    { name: "type", ddl: "TEXT NOT NULL DEFAULT 'note'" },
    { name: "paths", ddl: "TEXT" },
    { name: "category", ddl: "TEXT" },
    { name: "metadata", ddl: "TEXT" },
  ]

  for (const col of requiredCols) {
    if (!existingCols.has(col.name)) {
      await db.execute(`ALTER TABLE memories ADD COLUMN ${col.name} ${col.ddl}`)
    }
  }

  await db.execute(
    `CREATE TABLE IF NOT EXISTS configs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  )

  await db.execute(
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )

  await db.execute(
    `CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY,
      last_synced_at TEXT,
      remote_url TEXT
    )`
  )

  await db.execute(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='rowid'
    )`
  )

  // FTS triggers
  await db.execute(`DROP TRIGGER IF EXISTS memories_ai`)
  await db.execute(`DROP TRIGGER IF EXISTS memories_ad`)
  await db.execute(`DROP TRIGGER IF EXISTS memories_au`)

  await db.execute(`
    CREATE TRIGGER memories_ai AFTER INSERT ON memories
    WHEN NEW.deleted_at IS NULL
    BEGIN
      INSERT INTO memories_fts(rowid, content, tags) VALUES (NEW.rowid, NEW.content, NEW.tags);
    END
  `)

  await db.execute(`
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', OLD.rowid, OLD.content, OLD.tags);
    END
  `)

  await db.execute(`
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', OLD.rowid, OLD.content, OLD.tags);
      INSERT INTO memories_fts(rowid, content, tags)
        SELECT NEW.rowid, NEW.content, NEW.tags WHERE NEW.deleted_at IS NULL;
    END
  `)

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_scope_project ON memories(scope, project_id)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_user_scope_project ON memories(user_id, scope, project_id)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_layer_scope_project ON memories(memory_layer, scope, project_id)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_layer_expires ON memories(memory_layer, expires_at)`)

  await db.execute(
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
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model_dimension
     ON memory_embeddings(model, dimension)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model_version
     ON memory_embeddings(model, model_version)`
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memory_embeddings_created_at ON memory_embeddings(created_at)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memory_embeddings_updated_at ON memory_embeddings(updated_at)`)

  await db.execute(
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
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_status_next_attempt
     ON memory_embedding_jobs(status, next_attempt_at)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_memory_status
     ON memory_embedding_jobs(memory_id, status)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_claimed_at
     ON memory_embedding_jobs(claimed_at)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_dead_letter_at
     ON memory_embedding_jobs(dead_letter_at)`
  )

  await db.execute(
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
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_job_metrics_job_created_at
     ON memory_embedding_job_metrics(job_id, created_at)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_job_metrics_outcome_created_at
     ON memory_embedding_job_metrics(outcome, created_at)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_job_metrics_created_at
     ON memory_embedding_job_metrics(created_at)`
  )

  await db.execute(
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
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_backfill_state_status_updated
     ON memory_embedding_backfill_state(status, updated_at)`
  )

  await db.execute(
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
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_backfill_metrics_scope_ran_at
     ON memory_embedding_backfill_metrics(scope_key, ran_at)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_memory_embedding_backfill_metrics_status_ran_at
     ON memory_embedding_backfill_metrics(status, ran_at)`
  )

  await db.execute(
    `CREATE TABLE IF NOT EXISTS skill_files (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_skill_files_scope_project_path
     ON skill_files(scope, project_id, path)`
  )
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_skill_files_user_scope_project
     ON skill_files(user_id, scope, project_id)`
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_skill_files_updated_at ON skill_files(updated_at)`)
  await ensureGraphSchema(db)
}

async function ensureGraphSchema(db: ReturnType<typeof createClient>): Promise<void> {
  await db.execute(
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

  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_type_key
     ON graph_nodes(node_type, node_key)`
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type)`)

  await db.execute(
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

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_from_node_id ON graph_edges(from_node_id)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_to_node_id ON graph_edges(to_node_id)`)
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_graph_edges_type_from_node_id ON graph_edges(edge_type, from_node_id)`
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_expires_at ON graph_edges(expires_at)`)

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memory_node_links (
      memory_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (memory_id, node_id, role)
    )`
  )

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memory_node_links_node_id ON memory_node_links(node_id)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memory_node_links_memory_id ON memory_node_links(memory_id)`)

  await db.execute(
    `CREATE TABLE IF NOT EXISTS graph_rollout_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'off',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    )`
  )

  await db.execute(
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
      fallback_reason TEXT
    )`
  )

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_created_at
     ON graph_rollout_metrics(created_at)`
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_mode ON graph_rollout_metrics(mode)`)
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_fallback
     ON graph_rollout_metrics(fallback_triggered, created_at)`
  )
}
