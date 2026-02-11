import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, mcpRateLimit } from "@/lib/rate-limit"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { hashMcpApiKey, isValidMcpApiKey } from "@/lib/mcp-api-key"

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const MCP_MAX_CONNECTIONS_PER_KEY = parsePositiveInt(process.env.MCP_MAX_CONNECTIONS_PER_KEY, 5)
const MCP_MAX_CONNECTIONS_PER_IP = parsePositiveInt(process.env.MCP_MAX_CONNECTIONS_PER_IP, 20)
const MCP_SESSION_IDLE_MS = parsePositiveInt(process.env.MCP_SESSION_IDLE_MS, 15 * 60 * 1000)
const MCP_RESPONSE_SCHEMA_VERSION = "2026-02-10"
const encoder = new TextEncoder()

interface ActiveConnection {
  controller: ReadableStreamDefaultController<Uint8Array>
  turso: ReturnType<typeof createTurso>
  userId: string
  apiKeyHash: string
  rateLimitKey: string
  clientIp: string
  lastActivityAt: number
  idleTimeout: ReturnType<typeof setTimeout> | null
}

interface AuthenticatedUser {
  id: string
  email: string | null
  mcp_api_key_expires_at: string | null
}

interface AuthSuccess {
  turso: ReturnType<typeof createTurso>
  user: AuthenticatedUser
  apiKeyHash: string
}

interface AuthFailure {
  error: ApiErrorDetail
}

// Store active SSE connections
const connections = new Map<string, ActiveConnection>()

function cleanupConnection(sessionId: string, reason?: "idle_timeout") {
  const conn = connections.get(sessionId)
  if (!conn) return

  if (conn.idleTimeout) {
    clearTimeout(conn.idleTimeout)
  }
  connections.delete(sessionId)

  try {
    if (reason) {
      conn.controller.enqueue(encoder.encode(formatSSE("session_closed", { reason })))
    }
    conn.controller.close()
  } catch {
    // Stream already closed.
  }
}

function touchConnection(sessionId: string) {
  const conn = connections.get(sessionId)
  if (!conn) return

  conn.lastActivityAt = Date.now()
  if (conn.idleTimeout) {
    clearTimeout(conn.idleTimeout)
  }

  conn.idleTimeout = setTimeout(() => {
    cleanupConnection(sessionId, "idle_timeout")
  }, MCP_SESSION_IDLE_MS)
}

function countConnectionsFor(predicate: (conn: ActiveConnection) => boolean): number {
  let count = 0
  for (const conn of connections.values()) {
    if (predicate(conn)) count += 1
  }
  return count
}

function pruneExpiredConnections() {
  const now = Date.now()
  for (const [sessionId, conn] of connections.entries()) {
    if (now - conn.lastActivityAt >= MCP_SESSION_IDLE_MS) {
      cleanupConnection(sessionId, "idle_timeout")
    }
  }
}

// Authenticate via API key and return user's Turso client
async function authenticateAndGetTurso(apiKey: string): Promise<AuthSuccess | AuthFailure> {
  if (!isValidMcpApiKey(apiKey)) {
    return {
      error: apiError({
        type: "auth_error",
        code: "INVALID_API_KEY_FORMAT",
        message: "Invalid API key format",
        status: 401,
        retryable: false,
      }),
    }
  }

  const apiKeyHash = hashMcpApiKey(apiKey)
  const admin = createAdminClient()
  const { data: user, error } = await admin
    .from("users")
    .select("id, email, mcp_api_key_expires_at")
    .eq("mcp_api_key_hash", apiKeyHash)
    .single()

  if (error || !user) {
    return {
      error: apiError({
        type: "auth_error",
        code: "INVALID_API_KEY",
        message: "Invalid API key",
        status: 401,
        retryable: false,
      }),
    }
  }

  if (!user.mcp_api_key_expires_at || new Date(user.mcp_api_key_expires_at).getTime() <= Date.now()) {
    return {
      error: apiError({
        type: "auth_error",
        code: "API_KEY_EXPIRED",
        message: "API key expired. Generate a new key from memories.sh/app.",
        status: 401,
        retryable: false,
      }),
    }
  }

  const context = await resolveActiveMemoryContext(admin, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return {
      error: apiError({
        type: "not_found_error",
        code: "DATABASE_NOT_CONFIGURED",
        message: "Database not configured. Visit memories.sh/app to set up.",
        status: 400,
        retryable: false,
      }),
    }
  }

  const turso = createTurso({
    url: context.turso_db_url,
    authToken: context.turso_db_token,
  })

  return { turso, user: user as AuthenticatedUser, apiKeyHash }
}

// Extract API key from request
function getApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  return null
}

// Format SSE message
function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// Truncate content for display
function truncate(str: string, len = 80): string {
  if (str.length <= len) return str
  return str.slice(0, len).trim() + "..."
}

// Memory row type
interface MemoryRow {
  id: string
  content: string
  type: string
  scope: string
  project_id: string | null
  user_id: string | null
  tags: string | null
  paths: string | null
  category: string | null
  metadata: string | null
  created_at: string
  updated_at: string
}

interface StructuredMemory {
  id: string | null
  content: string
  type: string
  scope: string
  projectId: string | null
  tags: string[]
  paths: string[]
  category: string | null
  metadata: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

type ToolName =
  | "get_context"
  | "get_rules"
  | "add_memory"
  | "edit_memory"
  | "forget_memory"
  | "search_memories"
  | "list_memories"

type ApiErrorType =
  | "auth_error"
  | "validation_error"
  | "rate_limit_error"
  | "not_found_error"
  | "tool_error"
  | "method_error"
  | "internal_error"
  | "unknown_error"

interface ApiErrorDetail {
  type: ApiErrorType
  code: string
  message: string
  status: number
  retryable: boolean
  details?: Record<string, unknown>
}

interface ToolResponseEnvelope<T extends Record<string, unknown>> {
  ok: boolean
  data: T | null
  error: ApiErrorDetail | null
  meta: {
    version: string
    tool: ToolName
    timestamp: string
  }
}

type ToolStructuredContent<T extends Record<string, unknown>> = ToolResponseEnvelope<T> & T

class ToolExecutionError extends Error {
  readonly rpcCode: number
  readonly detail: ApiErrorDetail

  constructor(detail: ApiErrorDetail, options?: { rpcCode?: number }) {
    super(detail.message)
    this.name = "ToolExecutionError"
    this.detail = detail
    this.rpcCode = options?.rpcCode ?? -32603
  }
}

function apiError(detail: ApiErrorDetail): ApiErrorDetail {
  return detail
}

function endpointErrorResponse(
  detail: ApiErrorDetail,
  init?: { headers?: HeadersInit }
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      data: null,
      error: detail.message,
      errorDetail: detail,
      meta: {
        version: MCP_RESPONSE_SCHEMA_VERSION,
        endpoint: "/api/mcp",
        timestamp: new Date().toISOString(),
      },
    },
    { status: detail.status, headers: init?.headers }
  )
}

function jsonRpcErrorResponse(id: unknown, rpcCode: number, detail: ApiErrorDetail, status?: number): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: {
        code: rpcCode,
        message: detail.message,
        data: detail,
      },
    },
    status ? { status } : undefined
  )
}

function buildToolEnvelope<T extends Record<string, unknown>>(
  tool: ToolName,
  data: T
): ToolStructuredContent<T> {
  const envelope: ToolResponseEnvelope<T> = {
    ok: true,
    data,
    error: null,
    meta: {
      version: MCP_RESPONSE_SCHEMA_VERSION,
      tool,
      timestamp: new Date().toISOString(),
    },
  }

  return {
    ...envelope,
    ...data,
  }
}

function toToolExecutionError(err: unknown, fallbackTool?: string): ToolExecutionError {
  if (err instanceof ToolExecutionError) {
    return err
  }

  if (err instanceof Error) {
    return new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "TOOL_EXECUTION_FAILED",
        message: err.message,
        status: 500,
        retryable: true,
        details: fallbackTool ? { tool: fallbackTool } : undefined,
      })
    )
  }

  return new ToolExecutionError(
    apiError({
      type: "unknown_error",
      code: "UNKNOWN_TOOL_ERROR",
      message: "Tool execution failed",
      status: 500,
      retryable: true,
      details: fallbackTool ? { tool: fallbackTool } : undefined,
    })
  )
}

function parseTenantId(args: Record<string, unknown>): string | null {
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

function parseUserId(args: Record<string, unknown>): string | null {
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

async function resolveTenantTurso(
  apiKeyHash: string,
  tenantId: string
): Promise<ReturnType<typeof createTurso>> {
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

// Format memory for display
function formatMemory(m: MemoryRow): string {
  const scope = m.scope === "project" && m.project_id ? `@${m.project_id.split("/").pop()}` : "global"
  const tags = m.tags ? ` [${m.tags}]` : ""
  return `[${m.type}] ${truncate(m.content)} (${scope})${tags}`
}

function buildUserScopeFilter(
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

function parseList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseMetadata(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function toStructuredMemory(row: Partial<MemoryRow>): StructuredMemory {
  return {
    id: row.id ?? null,
    content: row.content ?? "",
    type: row.type ?? "note",
    scope: row.scope ?? "global",
    projectId: row.project_id ?? null,
    tags: parseList(row.tags),
    paths: parseList(row.paths),
    category: row.category ?? null,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

interface ToolExecutionResult {
  content: Array<{ type: string; text: string }>
  structuredContent?: ToolResponseEnvelope<Record<string, unknown>> | Record<string, unknown>
}

// Full SELECT columns for memory queries
const MEMORY_COLUMNS =
  "id, content, type, scope, project_id, user_id, tags, paths, category, metadata, created_at, updated_at"
const MEMORY_COLUMNS_ALIASED =
  "m.id, m.content, m.type, m.scope, m.project_id, m.user_id, m.tags, m.paths, m.category, m.metadata, m.created_at, m.updated_at"

// Valid memory types for server-side validation
const VALID_TYPES = new Set(["rule", "decision", "fact", "note", "skill"])

const userIdSchemaEnsuredClients = new WeakSet<ReturnType<typeof createTurso>>()

async function ensureMemoryUserIdSchema(turso: ReturnType<typeof createTurso>): Promise<void> {
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

  await turso.execute(
    "CREATE INDEX IF NOT EXISTS idx_memories_user_scope_project ON memories(user_id, scope, project_id)"
  )
  userIdSchemaEnsuredClients.add(turso)
}

// FTS5 search with LIKE fallback
async function searchWithFts(
  turso: ReturnType<typeof createTurso>,
  query: string,
  projectId: string | undefined,
  userId: string | null,
  limit: number,
  options?: { excludeType?: string; includeType?: string }
): Promise<MemoryRow[]> {
  const { excludeType, includeType } = options ?? {}
  const userFilter = buildUserScopeFilter(userId, "m.")

  // Try FTS5 first
  try {
    let typeFilter = ""
    const ftsArgs: (string | number)[] = [query]

    if (excludeType && VALID_TYPES.has(excludeType)) {
      typeFilter = "AND m.type != ?"
      ftsArgs.push(excludeType)
    } else if (includeType && VALID_TYPES.has(includeType)) {
      typeFilter = "AND m.type = ?"
      ftsArgs.push(includeType)
    }

    const projectFilter = projectId
      ? `AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))`
      : `AND m.scope = 'global'`
    if (projectId) ftsArgs.push(projectId)
    ftsArgs.push(...userFilter.args)
    ftsArgs.push(limit)

    const ftsResult = await turso.execute({
      sql: `SELECT ${MEMORY_COLUMNS_ALIASED}
            FROM memories_fts fts
            JOIN memories m ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ? AND m.deleted_at IS NULL
            ${typeFilter} ${projectFilter} AND ${userFilter.clause}
            ORDER BY bm25(memories_fts) LIMIT ?`,
      args: ftsArgs,
    })
    if (ftsResult.rows.length > 0) {
      return ftsResult.rows as unknown as MemoryRow[]
    }
  } catch {
    // FTS table may not exist for older DBs — fall through to LIKE
  }

  // Fallback to LIKE
  let sql = `SELECT ${MEMORY_COLUMNS} FROM memories
             WHERE deleted_at IS NULL AND content LIKE ?`
  const sqlArgs: (string | number)[] = [`%${query}%`]

  if (excludeType && VALID_TYPES.has(excludeType)) {
    sql += ` AND type != ?`
    sqlArgs.push(excludeType)
  } else if (includeType && VALID_TYPES.has(includeType)) {
    sql += ` AND type = ?`
    sqlArgs.push(includeType)
  }

  const fallbackUserFilter = buildUserScopeFilter(userId)
  sql += ` AND ${fallbackUserFilter.clause}`
  sqlArgs.push(...fallbackUserFilter.args)

  sql += ` AND (scope = 'global'`
  if (projectId) {
    sql += ` OR (scope = 'project' AND project_id = ?)`
    sqlArgs.push(projectId)
  }
  sql += `) ORDER BY created_at DESC LIMIT ?`
  sqlArgs.push(limit)

  const result = await turso.execute({ sql, args: sqlArgs })
  return result.rows as unknown as MemoryRow[]
}

// Handle tool execution
async function executeTool(
  toolName: string, 
  args: Record<string, unknown>, 
  turso: ReturnType<typeof createTurso>
): Promise<ToolExecutionResult> {
  const projectId = args.project_id as string | undefined
  const userId = parseUserId(args)

  switch (toolName) {
    case "get_context": {
      // Get rules: global + project-specific only
      let rulesSql = `SELECT ${MEMORY_COLUMNS} FROM memories 
                      WHERE type = 'rule' AND deleted_at IS NULL 
                      AND (scope = 'global'`
      const rulesArgs: (string | number)[] = []
      
      if (projectId) {
        rulesSql += ` OR (scope = 'project' AND project_id = ?)`
        rulesArgs.push(projectId)
      }
      const userFilter = buildUserScopeFilter(userId)
      rulesSql += `) AND ${userFilter.clause} ORDER BY scope DESC, created_at DESC`
      rulesArgs.push(...userFilter.args)

      const rulesResult = await turso.execute({ sql: rulesSql, args: rulesArgs })
      
      const globalRules = rulesResult.rows.filter(r => r.scope === "global")
      const projectRules = rulesResult.rows.filter(r => r.scope === "project")

      let output = ""
      
      if (projectRules.length > 0) {
        output += `## Project Rules\n${projectRules.map(r => `- ${r.content}`).join("\n")}\n\n`
      }
      
      if (globalRules.length > 0) {
        output += `## Global Rules\n${globalRules.map(r => `- ${r.content}`).join("\n")}`
      }

      // Get relevant memories if query provided
      let relevantMemories: MemoryRow[] = []
      if (args.query) {
        const limit = (args.limit as number) || 5
        relevantMemories = await searchWithFts(turso, args.query as string, projectId, userId, limit, {
          excludeType: "rule",
        })
        if (relevantMemories.length > 0) {
          output += `\n\n## Relevant Memories\n${relevantMemories.map(m => `- ${formatMemory(m)}`).join("\n")}`
        }
      }

      return {
        content: [{ type: "text", text: output || "No rules or memories found." }],
        structuredContent: buildToolEnvelope("get_context", {
          rules: (rulesResult.rows as unknown as MemoryRow[]).map(toStructuredMemory),
          memories: relevantMemories.map(toStructuredMemory),
        }),
      }
    }

    case "get_rules": {
      let sql = `SELECT ${MEMORY_COLUMNS} FROM memories 
                 WHERE type = 'rule' AND deleted_at IS NULL AND (scope = 'global'`
      const sqlArgs: (string | number)[] = []

      if (projectId) {
        sql += ` OR (scope = 'project' AND project_id = ?)`
        sqlArgs.push(projectId)
      }
      const userFilter = buildUserScopeFilter(userId)
      sql += `) AND ${userFilter.clause} ORDER BY scope DESC, created_at DESC`
      sqlArgs.push(...userFilter.args)

      const result = await turso.execute({ sql, args: sqlArgs })

      if (result.rows.length === 0) {
        return {
          content: [{ type: "text", text: "No rules found." }],
          structuredContent: buildToolEnvelope("get_rules", {
            rules: [],
          }),
        }
      }

      const globalRules = result.rows.filter(r => r.scope === "global")
      const projectRules = result.rows.filter(r => r.scope === "project")

      let output = ""
      if (projectRules.length > 0) {
        output += `## Project Rules\n${projectRules.map(r => `- ${r.content}`).join("\n")}\n\n`
      }
      if (globalRules.length > 0) {
        output += `## Global Rules\n${globalRules.map(r => `- ${r.content}`).join("\n")}`
      }

      return {
        content: [{ type: "text", text: output }],
        structuredContent: buildToolEnvelope("get_rules", {
          rules: (result.rows as unknown as MemoryRow[]).map(toStructuredMemory),
        }),
      }
    }

    case "add_memory": {
      const content = typeof args.content === "string" ? args.content.trim() : ""
      if (!content) {
        throw new ToolExecutionError(
          apiError({
            type: "validation_error",
            code: "MEMORY_CONTENT_REQUIRED",
            message: "Memory content is required",
            status: 400,
            retryable: false,
            details: { field: "content" },
          }),
          { rpcCode: -32602 }
        )
      }

      const memoryId = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      const now = new Date().toISOString()
      const rawType = (args.type as string) || "note"
      const type = VALID_TYPES.has(rawType) ? rawType : "note"
      const tags = Array.isArray(args.tags) ? args.tags.join(",") : null
      const scope = projectId ? "project" : "global"
      const paths = Array.isArray(args.paths) ? args.paths.join(",") : null
      const category = (args.category as string) || null
      const metadata = args.metadata ? JSON.stringify(args.metadata) : null

      await turso.execute({
        sql: `INSERT INTO memories (id, content, type, scope, project_id, user_id, tags, paths, category, metadata, created_at, updated_at) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [memoryId, content, type, scope, projectId || null, userId, tags, paths, category, metadata, now, now],
      })

      const scopeLabel = projectId ? `project:${projectId.split("/").pop()}` : "global"
      const message = `Stored ${type} (${scopeLabel}): ${truncate(content)}`
      const created = toStructuredMemory({
        id: memoryId,
        content,
        type,
        scope,
        project_id: projectId || null,
        user_id: userId,
        tags,
        paths,
        category,
        metadata,
        created_at: now,
        updated_at: now,
      })
      return {
        content: [{ type: "text", text: message }],
        structuredContent: buildToolEnvelope("add_memory", {
          memory: created,
          id: memoryId,
          message,
        }),
      }
    }

    case "edit_memory": {
      const id = args.id as string
      if (!id) {
        throw new ToolExecutionError(
          apiError({
            type: "validation_error",
            code: "MEMORY_ID_REQUIRED",
            message: "Memory id is required",
            status: 400,
            retryable: false,
            details: { field: "id" },
          }),
          { rpcCode: -32602 }
        )
      }

      const now = new Date().toISOString()
      const updates: string[] = ["updated_at = ?"]
      const updateArgs: (string | null)[] = [now]

      if (args.content !== undefined) {
        updates.push("content = ?")
        updateArgs.push(args.content as string)
      }
      if (args.type !== undefined && VALID_TYPES.has(args.type as string)) {
        updates.push("type = ?")
        updateArgs.push(args.type as string)
      }
      if (args.tags !== undefined) {
        updates.push("tags = ?")
        updateArgs.push(Array.isArray(args.tags) ? args.tags.join(",") : null)
      }
      if (args.paths !== undefined) {
        updates.push("paths = ?")
        updateArgs.push(Array.isArray(args.paths) ? args.paths.join(",") : null)
      }
      if (args.category !== undefined) {
        updates.push("category = ?")
        updateArgs.push((args.category as string) || null)
      }
      if (args.metadata !== undefined) {
        updates.push("metadata = ?")
        updateArgs.push(args.metadata ? JSON.stringify(args.metadata) : null)
      }

      const whereArgs: (string | null)[] = [id]
      if (userId) {
        whereArgs.push(userId)
      }
      await turso.execute({
        sql: `UPDATE memories SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL${
          userId ? " AND user_id = ?" : " AND user_id IS NULL"
        }`,
        args: [...updateArgs, ...whereArgs],
      })

      const message = `Updated memory ${id}`
      return {
        content: [{ type: "text", text: message }],
        structuredContent: buildToolEnvelope("edit_memory", {
          id,
          updated: true,
          message,
        }),
      }
    }

    case "forget_memory": {
      const id = args.id as string
      if (!id) {
        throw new ToolExecutionError(
          apiError({
            type: "validation_error",
            code: "MEMORY_ID_REQUIRED",
            message: "Memory id is required",
            status: 400,
            retryable: false,
            details: { field: "id" },
          }),
          { rpcCode: -32602 }
        )
      }

      const now = new Date().toISOString()
      await turso.execute({
        sql: `UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL${
          userId ? " AND user_id = ?" : " AND user_id IS NULL"
        }`,
        args: userId ? [now, id, userId] : [now, id],
      })

      const message = `Deleted memory ${id}`
      return {
        content: [{ type: "text", text: message }],
        structuredContent: buildToolEnvelope("forget_memory", {
          id,
          deleted: true,
          message,
        }),
      }
    }

    case "search_memories": {
      const limit = (args.limit as number) || 10
      const query = typeof args.query === "string" ? args.query.trim() : ""
      if (!query) {
        throw new ToolExecutionError(
          apiError({
            type: "validation_error",
            code: "QUERY_REQUIRED",
            message: "Search query is required",
            status: 400,
            retryable: false,
            details: { field: "query" },
          }),
          { rpcCode: -32602 }
        )
      }
      const includeType = args.type && VALID_TYPES.has(args.type as string) ? (args.type as string) : undefined

      const results = await searchWithFts(turso, query, projectId, userId, limit, { includeType })

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: "No memories found." }],
          structuredContent: buildToolEnvelope("search_memories", {
            memories: [],
            count: 0,
          }),
        }
      }

      const formatted = results.map(m => formatMemory(m)).join("\n")
      return {
        content: [{ type: "text", text: `Found ${results.length} memories:\n\n${formatted}` }],
        structuredContent: buildToolEnvelope("search_memories", {
          memories: results.map(toStructuredMemory),
          count: results.length,
        }),
      }
    }

    case "list_memories": {
      const limit = (args.limit as number) || 20
      let sql = `SELECT ${MEMORY_COLUMNS} FROM memories WHERE deleted_at IS NULL`
      const sqlArgs: (string | number)[] = []

      const userFilter = buildUserScopeFilter(userId)
      sql += ` AND ${userFilter.clause}`
      sqlArgs.push(...userFilter.args)

      // Scope filter: global + project
      sql += ` AND (scope = 'global'`
      if (projectId) {
        sql += ` OR (scope = 'project' AND project_id = ?)`
        sqlArgs.push(projectId)
      }
      sql += `)`

      if (args.type) {
        sql += " AND type = ?"
        sqlArgs.push(args.type as string)
      }

      if (args.tags) {
        sql += " AND tags LIKE ? ESCAPE '\\'"
        const escaped = (args.tags as string).replace(/[%_\\]/g, "\\$&")
        sqlArgs.push(`%${escaped}%`)
      }

      sql += " ORDER BY created_at DESC LIMIT ?"
      sqlArgs.push(limit)

      const result = await turso.execute({ sql, args: sqlArgs })

      if (result.rows.length === 0) {
        return {
          content: [{ type: "text", text: "No memories found." }],
          structuredContent: buildToolEnvelope("list_memories", {
            memories: [],
            count: 0,
          }),
        }
      }
      
      const structuredMemories = (result.rows as unknown as MemoryRow[])
        .map(toStructuredMemory)
      const formatted = (result.rows as unknown as MemoryRow[])
        .map(m => formatMemory(m))
        .join("\n")
      return {
        content: [{ type: "text", text: `${result.rows.length} memories:\n\n${formatted}` }],
        structuredContent: buildToolEnvelope("list_memories", {
          memories: structuredMemories,
          count: result.rows.length,
        }),
      }
    }

    default:
      throw new ToolExecutionError(
        apiError({
          type: "tool_error",
          code: "TOOL_NOT_FOUND",
          message: `Unknown tool: ${toolName}`,
          status: 404,
          retryable: false,
          details: { tool: toolName },
        }),
        { rpcCode: -32601 }
      )
  }
}

// Tool definitions
const TOOLS = [
  {
    name: "get_context",
    description: "Get rules and relevant memories for the current task. Returns global rules plus project-specific rules if project_id is provided.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you're working on (for finding relevant memories)" },
        project_id: { type: "string", description: "Project identifier (e.g., github.com/user/repo) to include project-specific rules" },
        user_id: { type: "string", description: "User identifier for scoped recall (includes shared + user-specific memories)" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
        limit: { type: "number", description: "Max memories to return (default: 5)" },
      },
    },
  },
  {
    name: "get_rules",
    description: "Get all active rules. Returns global rules plus project-specific rules if project_id is provided.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Project identifier to include project-specific rules" },
        user_id: { type: "string", description: "User identifier for scoped recall (includes shared + user-specific memories)" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
      },
    },
  },
  {
    name: "add_memory",
    description: "Store a new memory. Use type='rule' for always-active guidelines, 'decision' for architectural choices, 'fact' for knowledge, 'note' for general info, 'skill' for reusable capabilities.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content" },
        type: { type: "string", enum: ["rule", "decision", "fact", "note", "skill"], description: "Memory type (default: note)" },
        project_id: { type: "string", description: "Project identifier to scope this memory to a specific project" },
        user_id: { type: "string", description: "User identifier to store this memory as user-scoped data" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags for organization and filtering" },
        paths: { type: "array", items: { type: "string" }, description: "File glob patterns this memory applies to (e.g., ['src/**/*.ts'])" },
        category: { type: "string", description: "Category for grouping related memories" },
        metadata: { type: "object", description: "Additional structured metadata (stored as JSON)" },
      },
      required: ["content"],
    },
  },
  {
    name: "edit_memory",
    description: "Update an existing memory's content, type, tags, paths, category, or metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to edit" },
        content: { type: "string", description: "New content (optional)" },
        type: { type: "string", enum: ["rule", "decision", "fact", "note", "skill"], description: "New type (optional)" },
        tags: { type: "array", items: { type: "string" }, description: "New tags (optional)" },
        paths: { type: "array", items: { type: "string" }, description: "New file glob patterns (optional)" },
        category: { type: "string", description: "New category (optional)" },
        metadata: { type: "object", description: "New metadata (optional)" },
        user_id: { type: "string", description: "User identifier; edits are constrained to this user's memories" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
      },
      required: ["id"],
    },
  },
  {
    name: "forget_memory",
    description: "Delete a memory by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to delete" },
        user_id: { type: "string", description: "User identifier; deletes are constrained to this user's memories" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
      },
      required: ["id"],
    },
  },
  {
    name: "search_memories",
    description: "Search memories by content using full-text search. Returns global + project-specific memories.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        project_id: { type: "string", description: "Project identifier to include project-specific memories" },
        user_id: { type: "string", description: "User identifier for scoped recall (includes shared + user-specific memories)" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
        type: { type: "string", enum: ["rule", "decision", "fact", "note", "skill"], description: "Filter by memory type" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description: "List recent memories. Returns global + project-specific memories.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["rule", "decision", "fact", "note", "skill"], description: "Filter by type" },
        tags: { type: "string", description: "Filter by tag (partial match)" },
        project_id: { type: "string", description: "Project identifier to include project-specific memories" },
        user_id: { type: "string", description: "User identifier for scoped recall (includes shared + user-specific memories)" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
        limit: { type: "number", description: "Max results (default: 20)" },
      },
    },
  },
]

// SSE endpoint - GET opens the event stream
export async function GET(request: NextRequest) {
  const apiKey = getApiKey(request)
  
  if (!apiKey) {
    return NextResponse.json({ 
      status: "ok",
      name: "memories.sh MCP Server",
      version: "0.6.0",
      transport: "sse",
    })
  }

  pruneExpiredConnections()

  const rateLimitKey = hashMcpApiKey(apiKey)
  const clientIp = getClientIp(request)

  const keyConnectionCount = countConnectionsFor((conn) => conn.rateLimitKey === rateLimitKey)
  if (keyConnectionCount >= MCP_MAX_CONNECTIONS_PER_KEY) {
    return endpointErrorResponse(
      apiError({
        type: "rate_limit_error",
        code: "TOO_MANY_KEY_SESSIONS",
        message: "Too many active MCP sessions for this API key",
        status: 429,
        retryable: true,
      }),
      { headers: { "Retry-After": "60" } }
    )
  }

  const ipConnectionCount = countConnectionsFor((conn) => conn.clientIp === clientIp)
  if (ipConnectionCount >= MCP_MAX_CONNECTIONS_PER_IP) {
    return endpointErrorResponse(
      apiError({
        type: "rate_limit_error",
        code: "TOO_MANY_IP_SESSIONS",
        message: "Too many active MCP sessions from this IP",
        status: 429,
        retryable: true,
      }),
      { headers: { "Retry-After": "60" } }
    )
  }

  const rateLimited = await checkRateLimit(mcpRateLimit, rateLimitKey)
  if (rateLimited) return rateLimited

  const auth = await authenticateAndGetTurso(apiKey)
  if ("error" in auth) {
    return endpointErrorResponse(auth.error)
  }

  const { turso, user, apiKeyHash } = auth
  const sessionId = crypto.randomUUID()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      connections.set(sessionId, {
        controller,
        turso,
        userId: user.id,
        apiKeyHash,
        rateLimitKey,
        clientIp,
        lastActivityAt: Date.now(),
        idleTimeout: null,
      })
      touchConnection(sessionId)
      controller.enqueue(encoder.encode(formatSSE("endpoint", `/api/mcp?session=${sessionId}`)))
    },
    cancel() {
      cleanupConnection(sessionId)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

// Handle MCP JSON-RPC messages via POST
export async function POST(request: NextRequest) {
  pruneExpiredConnections()

  const url = new URL(request.url)
  const sessionId = url.searchParams.get("session")
  
  let turso: ReturnType<typeof createTurso>
  let apiKeyHash: string | null = null
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let activeSessionId: string | null = null

  if (sessionId && connections.has(sessionId)) {
    const conn = connections.get(sessionId)!
    const rateLimited = await checkRateLimit(mcpRateLimit, conn.rateLimitKey)
    if (rateLimited) return rateLimited

    touchConnection(sessionId)
    turso = conn.turso
    apiKeyHash = conn.apiKeyHash
    controller = conn.controller
    activeSessionId = sessionId
  } else {
    // Stateless mode
    const apiKey = getApiKey(request)
    if (!apiKey) {
      return endpointErrorResponse(
        apiError({
          type: "auth_error",
          code: "MISSING_API_KEY",
          message: "Missing API key",
          status: 401,
          retryable: false,
        })
      )
    }

    const rateLimitKey = hashMcpApiKey(apiKey)
    const rateLimited = await checkRateLimit(mcpRateLimit, rateLimitKey)
    if (rateLimited) return rateLimited

    const auth = await authenticateAndGetTurso(apiKey)
    if ("error" in auth) {
      return endpointErrorResponse(auth.error)
    }
    turso = auth.turso
    apiKeyHash = auth.apiKeyHash
  }

  try {
    const body = await request.json()
    const { method, params, id } = body

    let result: unknown

    switch (method) {
      case "initialize": {
        result = {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "memories.sh", version: "0.6.0" },
          capabilities: { tools: {} },
        }
        break
      }

      case "notifications/initialized": {
        return new Response(null, { status: 204 })
      }

      case "tools/list": {
        result = { tools: TOOLS }
        break
      }

      case "tools/call": {
        const toolName = params?.name
        const args = (params?.arguments && typeof params.arguments === "object")
          ? (params.arguments as Record<string, unknown>)
          : {}

        try {
          const tenantId = parseTenantId(args)
          if (tenantId && !apiKeyHash) {
            throw new ToolExecutionError(
              apiError({
                type: "internal_error",
                code: "TENANT_ROUTING_CONTEXT_MISSING",
                message: "Tenant routing context is unavailable for this request",
                status: 500,
                retryable: true,
              })
            )
          }
          const toolTurso = tenantId
            ? await resolveTenantTurso(apiKeyHash, tenantId)
            : turso
          await ensureMemoryUserIdSchema(toolTurso)
          result = await executeTool(toolName, args, toolTurso)
        } catch (err) {
          const toolError = toToolExecutionError(err, typeof toolName === "string" ? toolName : undefined)
          return jsonRpcErrorResponse(id, toolError.rpcCode, toolError.detail)
        }
        break
      }

      case "ping": {
        result = {}
        break
      }

      default:
        return jsonRpcErrorResponse(
          id,
          -32601,
          apiError({
            type: "method_error",
            code: "METHOD_NOT_FOUND",
            message: `Method not found: ${method}`,
            status: 404,
            retryable: false,
            details: { method: String(method) },
          })
        )
    }

    const response = { jsonrpc: "2.0", id, result }

    if (controller) {
      try {
        controller.enqueue(encoder.encode(formatSSE("message", response)))
      } catch {
        if (activeSessionId) {
          cleanupConnection(activeSessionId)
        }
      }
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error("MCP error:", err)
    return jsonRpcErrorResponse(
      null,
      -32603,
      apiError({
        type: "internal_error",
        code: "INTERNAL_ERROR",
        message: "Internal error",
        status: 500,
        retryable: true,
      }),
      500
    )
  }
}

// CORS
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
