import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, mcpRateLimit } from "@/lib/rate-limit"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { hashMcpApiKey, isValidMcpApiKey } from "@/lib/mcp-api-key"

// Store active SSE connections
const connections = new Map<string, {
  controller: ReadableStreamDefaultController<Uint8Array>
  turso: ReturnType<typeof createTurso>
  userId: string
}>()

// Authenticate via API key and return user's Turso client
async function authenticateAndGetTurso(apiKey: string) {
  if (!isValidMcpApiKey(apiKey)) {
    return { error: "Invalid API key format", status: 401 }
  }

  const apiKeyHash = hashMcpApiKey(apiKey)
  const admin = createAdminClient()
  const { data: user, error } = await admin
    .from("users")
    .select("id, email, mcp_api_key_expires_at")
    .eq("mcp_api_key_hash", apiKeyHash)
    .single()

  if (error || !user) {
    return { error: "Invalid API key", status: 401 }
  }

  if (!user.mcp_api_key_expires_at || new Date(user.mcp_api_key_expires_at).getTime() <= Date.now()) {
    return { error: "API key expired. Generate a new key from memories.sh/app.", status: 401 }
  }

  const context = await resolveActiveMemoryContext(admin, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return { error: "Database not configured. Visit memories.sh/app to set up.", status: 400 }
  }

  const turso = createTurso({
    url: context.turso_db_url,
    authToken: context.turso_db_token,
  })

  return { turso, user }
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
  tags: string | null
  paths: string | null
  category: string | null
  metadata: string | null
  created_at: string
  updated_at: string
}

// Format memory for display
function formatMemory(m: MemoryRow): string {
  const scope = m.scope === "project" && m.project_id ? `@${m.project_id.split("/").pop()}` : "global"
  const tags = m.tags ? ` [${m.tags}]` : ""
  return `[${m.type}] ${truncate(m.content)} (${scope})${tags}`
}

// Full SELECT columns for memory queries
const MEMORY_COLUMNS = "id, content, type, scope, project_id, tags, paths, category, metadata, created_at, updated_at"
const MEMORY_COLUMNS_ALIASED = "m.id, m.content, m.type, m.scope, m.project_id, m.tags, m.paths, m.category, m.metadata, m.created_at, m.updated_at"

// Valid memory types for server-side validation
const VALID_TYPES = new Set(["rule", "decision", "fact", "note", "skill"])

// FTS5 search with LIKE fallback
async function searchWithFts(
  turso: ReturnType<typeof createTurso>,
  query: string,
  projectId: string | undefined,
  limit: number,
  options?: { excludeType?: string; includeType?: string }
): Promise<MemoryRow[]> {
  const { excludeType, includeType } = options ?? {}

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
    ftsArgs.push(limit)

    const ftsResult = await turso.execute({
      sql: `SELECT ${MEMORY_COLUMNS_ALIASED}
            FROM memories_fts fts
            JOIN memories m ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ? AND m.deleted_at IS NULL
            ${typeFilter} ${projectFilter}
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
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectId = args.project_id as string | undefined

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
      rulesSql += `) ORDER BY scope DESC, created_at DESC`

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
      if (args.query) {
        const limit = (args.limit as number) || 5
        const results = await searchWithFts(turso, args.query as string, projectId, limit, { excludeType: "rule" })
        if (results.length > 0) {
          output += `\n\n## Relevant Memories\n${results.map(m => `- ${formatMemory(m)}`).join("\n")}`
        }
      }

      return {
        content: [{ type: "text", text: output || "No rules or memories found." }],
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
      sql += `) ORDER BY scope DESC, created_at DESC`

      const result = await turso.execute({ sql, args: sqlArgs })

      if (result.rows.length === 0) {
        return { content: [{ type: "text", text: "No rules found." }] }
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

      return { content: [{ type: "text", text: output }] }
    }

    case "add_memory": {
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
        sql: `INSERT INTO memories (id, content, type, scope, project_id, tags, paths, category, metadata, created_at, updated_at) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [memoryId, args.content as string, type, scope, projectId || null, tags, paths, category, metadata, now, now],
      })

      const scopeLabel = projectId ? `project:${projectId.split("/").pop()}` : "global"
      return {
        content: [{ type: "text", text: `Stored ${type} (${scopeLabel}): ${truncate(args.content as string)}` }],
      }
    }

    case "edit_memory": {
      const id = args.id as string
      if (!id) throw new Error("Memory id is required")

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

      updateArgs.push(id)
      await turso.execute({
        sql: `UPDATE memories SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
        args: updateArgs,
      })

      return {
        content: [{ type: "text", text: `Updated memory ${id}` }],
      }
    }

    case "forget_memory": {
      const id = args.id as string
      if (!id) throw new Error("Memory id is required")

      const now = new Date().toISOString()
      await turso.execute({
        sql: `UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
        args: [now, id],
      })

      return {
        content: [{ type: "text", text: `Deleted memory ${id}` }],
      }
    }

    case "search_memories": {
      const limit = (args.limit as number) || 10
      const query = args.query as string
      const includeType = args.type && VALID_TYPES.has(args.type as string) ? (args.type as string) : undefined

      const results = await searchWithFts(turso, query, projectId, limit, { includeType })

      if (results.length === 0) {
        return { content: [{ type: "text", text: "No memories found." }] }
      }

      const formatted = results.map(m => formatMemory(m)).join("\n")
      return {
        content: [{ type: "text", text: `Found ${results.length} memories:\n\n${formatted}` }],
      }
    }

    case "list_memories": {
      const limit = (args.limit as number) || 20
      let sql = `SELECT ${MEMORY_COLUMNS} FROM memories WHERE deleted_at IS NULL`
      const sqlArgs: (string | number)[] = []

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
        return { content: [{ type: "text", text: "No memories found." }] }
      }
      
      const formatted = (result.rows as unknown as MemoryRow[])
        .map(m => formatMemory(m))
        .join("\n")
      return {
        content: [{ type: "text", text: `${result.rows.length} memories:\n\n${formatted}` }],
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
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

  const rateLimitKey = hashMcpApiKey(apiKey)
  const rateLimited = await checkRateLimit(mcpRateLimit, rateLimitKey)
  if (rateLimited) return rateLimited

  const auth = await authenticateAndGetTurso(apiKey)
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { turso, user } = auth
  const sessionId = crypto.randomUUID()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      connections.set(sessionId, { controller, turso, userId: user.id })
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(formatSSE("endpoint", `/api/mcp?session=${sessionId}`)))
    },
    cancel() {
      connections.delete(sessionId)
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
  const url = new URL(request.url)
  const sessionId = url.searchParams.get("session")
  
  let turso: ReturnType<typeof createTurso>
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  if (sessionId && connections.has(sessionId)) {
    const conn = connections.get(sessionId)!
    turso = conn.turso
    controller = conn.controller
  } else {
    // Stateless mode
    const apiKey = getApiKey(request)
    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 401 })
    }

    const rateLimitKey = hashMcpApiKey(apiKey)
    const rateLimited = await checkRateLimit(mcpRateLimit, rateLimitKey)
    if (rateLimited) return rateLimited

    const auth = await authenticateAndGetTurso(apiKey)
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    turso = auth.turso
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
        const args = params?.arguments || {}

        try {
          result = await executeTool(toolName, args, turso)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Tool execution failed"
          return NextResponse.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: errorMessage },
          })
        }
        break
      }

      case "ping": {
        result = {}
        break
      }

      default:
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
    }

    const response = { jsonrpc: "2.0", id, result }

    if (controller) {
      try {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(formatSSE("message", response)))
      } catch {
        // Connection closed
      }
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error("MCP error:", err)
    return NextResponse.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "Internal error" },
    }, { status: 500 })
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
