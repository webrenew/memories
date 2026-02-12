import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import {
  apiError,
  MCP_WORKING_MEMORY_TTL_HOURS,
  type MemoryLayer,
  type TursoClient,
  ToolExecutionError,
  VALID_LAYERS,
} from "./types"

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString()
}

export function workingMemoryExpiresAt(nowIso: string): string {
  return addHours(nowIso, MCP_WORKING_MEMORY_TTL_HOURS)
}

export function parseTenantId(args: Record<string, unknown>): string | null {
  if (args.tenant_id === undefined || args.tenant_id === null) {
    return null
  }

  if (typeof args.tenant_id !== "string" || args.tenant_id.trim().length === 0) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "TENANT_ID_INVALID",
        message: "tenant_id must be a non-empty string",
        status: 400,
        retryable: false,
        details: { field: "tenant_id" },
      }),
      { rpcCode: -32602 }
    )
  }

  return args.tenant_id.trim()
}

export function parseUserId(args: Record<string, unknown>): string | null {
  if (args.user_id === undefined || args.user_id === null) {
    return null
  }

  if (typeof args.user_id !== "string" || args.user_id.trim().length === 0) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "USER_ID_INVALID",
        message: "user_id must be a non-empty string",
        status: 400,
        retryable: false,
        details: { field: "user_id" },
      }),
      { rpcCode: -32602 }
    )
  }

  return args.user_id.trim()
}

export function parseMemoryLayer(args: Record<string, unknown>, field = "layer"): MemoryLayer | null {
  const value = args[field]
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== "string") {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "MEMORY_LAYER_INVALID",
        message: `${field} must be one of: rule, working, long_term`,
        status: 400,
        retryable: false,
        details: { field },
      }),
      { rpcCode: -32602 }
    )
  }

  const normalized = value.trim() as MemoryLayer
  if (!VALID_LAYERS.has(normalized)) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "MEMORY_LAYER_INVALID",
        message: `${field} must be one of: rule, working, long_term`,
        status: 400,
        retryable: false,
        details: { field, value },
      }),
      { rpcCode: -32602 }
    )
  }

  return normalized
}

export function buildLayerFilterClause(
  layer: MemoryLayer | null,
  columnPrefix = ""
): { clause: string } {
  if (!layer) {
    return { clause: "1 = 1" }
  }

  const layerColumn = `${columnPrefix}memory_layer`
  const typeColumn = `${columnPrefix}type`
  if (layer === "rule") {
    return { clause: `(${layerColumn} = 'rule' OR ${typeColumn} = 'rule')` }
  }
  if (layer === "working") {
    return { clause: `${layerColumn} = 'working'` }
  }
  return { clause: `(${layerColumn} IS NULL OR ${layerColumn} = 'long_term')` }
}

export function buildNotExpiredFilter(nowIso: string, columnPrefix = ""): { clause: string; args: string[] } {
  const expiresAtColumn = `${columnPrefix}expires_at`
  return {
    clause: `(${expiresAtColumn} IS NULL OR ${expiresAtColumn} > ?)`,
    args: [nowIso],
  }
}

export function buildUserScopeFilter(
  userId: string | null,
  columnPrefix = ""
): { clause: string; args: string[] } {
  const userColumn = `${columnPrefix}user_id`
  if (userId) {
    return {
      clause: `(${userColumn} IS NULL OR ${userColumn} = ?)`,
      args: [userId],
    }
  }
  return {
    clause: `${userColumn} IS NULL`,
    args: [],
  }
}

export async function resolveTenantTurso(apiKeyHash: string, tenantId: string): Promise<TursoClient> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .select("turso_db_url, turso_db_token, status")
    .eq("api_key_hash", apiKeyHash)
    .eq("tenant_id", tenantId)
    .single()

  if (error || !data) {
    throw new ToolExecutionError(
      apiError({
        type: "not_found_error",
        code: "TENANT_DATABASE_NOT_CONFIGURED",
        message: `No tenant database configured for tenant_id: ${tenantId}`,
        status: 404,
        retryable: false,
        details: { tenant_id: tenantId },
      }),
      { rpcCode: -32004 }
    )
  }

  if (data.status !== "ready") {
    throw new ToolExecutionError(
      apiError({
        type: "tool_error",
        code: "TENANT_DATABASE_NOT_READY",
        message: `Tenant database is not ready (status: ${data.status})`,
        status: 409,
        retryable: true,
        details: { tenant_id: tenantId, status: data.status },
      }),
      { rpcCode: -32009 }
    )
  }

  if (!data.turso_db_url || !data.turso_db_token) {
    throw new ToolExecutionError(
      apiError({
        type: "not_found_error",
        code: "TENANT_DATABASE_CREDENTIALS_MISSING",
        message: `Tenant database credentials are missing for tenant_id: ${tenantId}`,
        status: 404,
        retryable: false,
        details: { tenant_id: tenantId },
      }),
      { rpcCode: -32004 }
    )
  }

  return createTurso({
    url: data.turso_db_url,
    authToken: data.turso_db_token,
  })
}

const userIdSchemaEnsuredClients = new WeakSet<TursoClient>()

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
      fallback_reason TEXT
    )`
  )

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_created_at ON graph_rollout_metrics(created_at)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_mode ON graph_rollout_metrics(mode)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_graph_rollout_metrics_fallback ON graph_rollout_metrics(fallback_triggered, created_at)"
  )
}

export async function ensureMemoryUserIdSchema(turso: TursoClient): Promise<void> {
  if (userIdSchemaEnsuredClients.has(turso)) {
    return
  }

  try {
    await turso.execute("ALTER TABLE memories ADD COLUMN user_id TEXT")
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : ""
    if (!message.includes("duplicate column name")) {
      throw err
    }
  }

  try {
    await turso.execute("ALTER TABLE memories ADD COLUMN memory_layer TEXT NOT NULL DEFAULT 'long_term'")
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : ""
    if (!message.includes("duplicate column name")) {
      throw err
    }
  }

  try {
    await turso.execute("ALTER TABLE memories ADD COLUMN expires_at TEXT")
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : ""
    if (!message.includes("duplicate column name")) {
      throw err
    }
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

  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memories_user_scope_project ON memories(user_id, scope, project_id)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memories_layer_scope_project ON memories(memory_layer, scope, project_id)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memories_layer_expires ON memories(memory_layer, expires_at)")
  await ensureGraphSchema(turso)
  userIdSchemaEnsuredClients.add(turso)
}
