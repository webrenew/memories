import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, initSchema } from "@/lib/turso"
import { createClient as createTurso } from "@libsql/client"
import { setTimeout as delay } from "node:timers/promises"
import {
  getTursoOrgSlug,
  hasTursoPlatformApiToken,
  shouldAutoProvisionTenants,
} from "@/lib/env"
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

function shouldAutoProvisionTenantDatabases(): boolean {
  return shouldAutoProvisionTenants()
}

async function readTenantMapping(
  apiKeyHash: string,
  tenantId: string
): Promise<{
  turso_db_url: string | null
  turso_db_token: string | null
  status: string
  metadata: Record<string, unknown> | null
} | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("sdk_tenant_databases")
    .select("turso_db_url, turso_db_token, status, metadata")
    .eq("api_key_hash", apiKeyHash)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (error) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "TENANT_MAPPING_LOOKUP_FAILED",
        message: "Failed to lookup tenant database mapping",
        status: 500,
        retryable: true,
        details: { tenant_id: tenantId, error: error.message },
      }),
      { rpcCode: -32000 }
    )
  }

  if (!data) {
    return null
  }

  return {
    turso_db_url: data.turso_db_url,
    turso_db_token: data.turso_db_token,
    status: data.status,
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? (data.metadata as Record<string, unknown>)
        : {},
  }
}

async function autoProvisionTenantDatabase(params: {
  apiKeyHash: string
  tenantId: string
  ownerUserId?: string | null
  existingMetadata?: Record<string, unknown> | null
}): Promise<void> {
  const { apiKeyHash, tenantId, ownerUserId, existingMetadata } = params

  if (!hasTursoPlatformApiToken()) {
    return
  }

  const tursoOrg = getTursoOrgSlug()
  const db = await createDatabase(tursoOrg)
  const token = await createDatabaseToken(tursoOrg, db.name)
  const url = `libsql://${db.hostname}`

  await delay(3000)
  await initSchema(url, token)

  const now = new Date().toISOString()
  const metadata = {
    ...(existingMetadata ?? {}),
    provisionedBy: "sdk_auto",
    provisionedAt: now,
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("sdk_tenant_databases")
    .upsert(
      {
        api_key_hash: apiKeyHash,
        tenant_id: tenantId,
        turso_db_url: url,
        turso_db_token: token,
        turso_db_name: db.name,
        status: "ready",
        metadata,
        created_by_user_id: ownerUserId ?? null,
        updated_at: now,
        last_verified_at: now,
      },
      { onConflict: "api_key_hash,tenant_id" }
    )

  if (error) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "TENANT_AUTO_PROVISION_FAILED",
        message: "Failed to save auto-provisioned tenant database mapping",
        status: 500,
        retryable: true,
        details: { tenant_id: tenantId, error: error.message },
      }),
      { rpcCode: -32000 }
    )
  }
}

export async function resolveTenantTurso(
  apiKeyHash: string,
  tenantId: string,
  options: { ownerUserId?: string | null; autoProvision?: boolean } = {}
): Promise<TursoClient> {
  let mapping = await readTenantMapping(apiKeyHash, tenantId)

  const canAutoProvision =
    (options.autoProvision ?? true) &&
    shouldAutoProvisionTenantDatabases() &&
    hasTursoPlatformApiToken()

  if (
    canAutoProvision &&
    (!mapping || mapping.status === "disabled" || mapping.status === "error" || !mapping.turso_db_url || !mapping.turso_db_token)
  ) {
    try {
      await autoProvisionTenantDatabase({
        apiKeyHash,
        tenantId,
        ownerUserId: options.ownerUserId,
        existingMetadata: mapping?.metadata ?? null,
      })
      mapping = await readTenantMapping(apiKeyHash, tenantId)
      console.info(`[SDK_AUTO_PROVISION] Tenant database ready for tenant_id=${tenantId}`)
    } catch (error) {
      console.error("[SDK_AUTO_PROVISION] Failed to auto-provision tenant database:", error)
    }
  }

  if (!mapping) {
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

  if (mapping.status !== "ready") {
    throw new ToolExecutionError(
      apiError({
        type: "tool_error",
        code: "TENANT_DATABASE_NOT_READY",
        message: `Tenant database is not ready (status: ${mapping.status})`,
        status: 409,
        retryable: true,
        details: { tenant_id: tenantId, status: mapping.status },
      }),
      { rpcCode: -32009 }
    )
  }

  if (!mapping.turso_db_url || !mapping.turso_db_token) {
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
    url: mapping.turso_db_url,
    authToken: mapping.turso_db_token,
  })
}

const userIdSchemaEnsuredClients = new WeakSet<TursoClient>()
const userIdSchemaEnsuredKeys = new Set<string>()
const MEMORY_SCHEMA_STATE_TABLE = "memory_schema_state"
const MEMORY_SCHEMA_STATE_KEY = "memory_user_id_v1"

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

async function ensureSkillFileSchema(turso: TursoClient): Promise<void> {
  await turso.execute(
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
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_scope_project_path ON skill_files(scope, project_id, path)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_user_scope_project ON skill_files(user_id, scope, project_id)"
  )
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_skill_files_updated_at ON skill_files(updated_at)"
  )
}

async function ensureSchemaStateTable(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS ${MEMORY_SCHEMA_STATE_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
}

async function isMemorySchemaMarked(turso: TursoClient): Promise<boolean> {
  const result = await turso.execute({
    sql: `SELECT value
          FROM ${MEMORY_SCHEMA_STATE_TABLE}
          WHERE key = ?
          LIMIT 1`,
    args: [MEMORY_SCHEMA_STATE_KEY],
  })
  const rows = Array.isArray(result.rows) ? result.rows : []
  return String(rows[0]?.value ?? "") === "1"
}

async function markMemorySchemaApplied(turso: TursoClient): Promise<void> {
  await turso.execute({
    sql: `INSERT OR REPLACE INTO ${MEMORY_SCHEMA_STATE_TABLE} (key, value, updated_at)
          VALUES (?, '1', datetime('now'))`,
    args: [MEMORY_SCHEMA_STATE_KEY],
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

interface EnsureMemoryUserIdSchemaOptions {
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

  if (userIdSchemaEnsuredClients.has(turso)) {
    return
  }
  if (normalizedCacheKey && userIdSchemaEnsuredKeys.has(normalizedCacheKey)) {
    userIdSchemaEnsuredClients.add(turso)
    return
  }

  await ensureSchemaStateTable(turso)
  if (await isMemorySchemaMarked(turso)) {
    await ensureSkillFileSchema(turso)
    userIdSchemaEnsuredClients.add(turso)
    if (normalizedCacheKey) {
      userIdSchemaEnsuredKeys.add(normalizedCacheKey)
    }
    return
  }

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

  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memories_user_scope_project ON memories(user_id, scope, project_id)")
  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memories_layer_scope_project ON memories(memory_layer, scope, project_id)"
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memories_layer_expires ON memories(memory_layer, expires_at)")
  await ensureGraphSchema(turso)
  await ensureSkillFileSchema(turso)
  await markMemorySchemaApplied(turso)
  userIdSchemaEnsuredClients.add(turso)
  if (normalizedCacheKey) {
    userIdSchemaEnsuredKeys.add(normalizedCacheKey)
  }
}
