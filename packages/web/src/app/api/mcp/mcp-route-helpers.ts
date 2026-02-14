import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { hashMcpApiKey, isValidMcpApiKey } from "@/lib/mcp-api-key"
import { MCP_SESSION_IDLE_MS } from "@/lib/env"
import { apiError, type ApiErrorDetail } from "@/lib/memory-service/tools"

export const MCP_RESPONSE_SCHEMA_VERSION = "2026-02-10"
export const encoder = new TextEncoder()

export interface ActiveConnection {
  controller: ReadableStreamDefaultController<Uint8Array>
  turso: ReturnType<typeof createTurso>
  userId: string
  apiKeyHash: string
  rateLimitKey: string
  clientIp: string
  lastActivityAt: number
  idleTimeout: ReturnType<typeof setTimeout> | null
}

export interface AuthenticatedUser {
  id: string
  email: string | null
  mcp_api_key_expires_at: string | null
}

export interface AuthSuccess {
  turso: ReturnType<typeof createTurso>
  user: AuthenticatedUser
  apiKeyHash: string
}

export interface AuthFailure {
  error: ApiErrorDetail
}

// Store active SSE connections
export const connections = new Map<string, ActiveConnection>()

export function cleanupConnection(sessionId: string, reason?: "idle_timeout") {
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

export function touchConnection(sessionId: string) {
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

export function countConnectionsFor(predicate: (conn: ActiveConnection) => boolean): number {
  let count = 0
  for (const conn of connections.values()) {
    if (predicate(conn)) count += 1
  }
  return count
}

export function pruneExpiredConnections() {
  const now = Date.now()
  for (const [sessionId, conn] of connections.entries()) {
    if (now - conn.lastActivityAt >= MCP_SESSION_IDLE_MS) {
      cleanupConnection(sessionId, "idle_timeout")
    }
  }
}

// Authenticate via API key and return user's Turso client
export async function authenticateAndGetTurso(apiKey: string): Promise<AuthSuccess | AuthFailure> {
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

  const context = await resolveActiveMemoryContext(admin, user.id, {
    fallbackToUserWithoutOrgCredentials: true,
  })
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
export function getApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  return null
}

// Format SSE message
export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function endpointErrorResponse(
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

export function jsonRpcErrorResponse(id: unknown, rpcCode: number, detail: ApiErrorDetail, status?: number): NextResponse {
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

// Tool definitions
export const TOOLS = [
  {
    name: "get_context",
    description: "Get memory context for the current task with deterministic layering: rules (always-on), then working memory, then long-term memory.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you're working on (for finding relevant memories)" },
        project_id: { type: "string", description: "Project identifier (e.g., github.com/user/repo) to include project-specific rules" },
        user_id: { type: "string", description: "User identifier for scoped recall (includes shared + user-specific memories)" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
        limit: { type: "number", description: "Max memories to return (default: 5)" },
        retrieval_strategy: {
          type: "string",
          enum: ["baseline", "hybrid_graph"],
          description: "Retrieval mode. baseline keeps tiered recall; hybrid_graph augments with graph expansion when enabled.",
        },
        graph_depth: {
          type: "number",
          enum: [0, 1, 2],
          description: "Graph traversal depth for hybrid retrieval (default: 1, max: 2).",
        },
        graph_limit: {
          type: "number",
          description: "Maximum graph-expanded memories to add (default: 8, max: 50).",
        },
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
    description: "Store a new memory. Use type='rule' for always-active guidelines. Layer controls injection priority: rule, working, or long_term. Working memories auto-expire based on server TTL policy.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content" },
        type: { type: "string", enum: ["rule", "decision", "fact", "note", "skill"], description: "Memory type (default: note)" },
        layer: { type: "string", enum: ["rule", "working", "long_term"], description: "Memory layer (default: rule for type=rule, otherwise long_term)" },
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
    description: "Update an existing memory's content, type, layer, tags, paths, category, or metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to edit" },
        content: { type: "string", description: "New content (optional)" },
        type: { type: "string", enum: ["rule", "decision", "fact", "note", "skill"], description: "New type (optional)" },
        layer: { type: "string", enum: ["rule", "working", "long_term"], description: "New memory layer (optional)" },
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
        layer: { type: "string", enum: ["rule", "working", "long_term"], description: "Filter by memory layer" },
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
        layer: { type: "string", enum: ["rule", "working", "long_term"], description: "Filter by memory layer" },
        tags: { type: "string", description: "Filter by tag (partial match)" },
        project_id: { type: "string", description: "Project identifier to include project-specific memories" },
        user_id: { type: "string", description: "User identifier for scoped recall (includes shared + user-specific memories)" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
        limit: { type: "number", description: "Max results (default: 20)" },
      },
    },
  },
  {
    name: "bulk_forget_memories",
    description: "Bulk soft-delete memories matching filters. Use dry_run:true to preview which memories would be deleted. Requires at least one filter, or all:true to delete everything.",
    inputSchema: {
      type: "object",
      properties: {
        types: { type: "array", items: { type: "string", enum: ["rule", "decision", "fact", "note", "skill"] }, description: "Filter by memory types" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags (partial match)" },
        older_than_days: { type: "integer", minimum: 1, description: "Delete memories older than N days (must be >= 1)" },
        pattern: { type: "string", description: "Content pattern (* as wildcard, ? as single-char wildcard, wraps in contains match)" },
        project_id: { type: "string", description: "Scope deletion to a specific project" },
        user_id: { type: "string", description: "User identifier; deletes are constrained to this user's memories" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
        all: { type: "boolean", description: "Delete all memories (cannot combine with other filters)" },
        dry_run: { type: "boolean", description: "Preview which memories would be deleted without deleting them (default: false)" },
      },
    },
  },
  {
    name: "vacuum_memories",
    description: "Permanently purge all soft-deleted memories to reclaim storage space. This action is irreversible.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "User identifier; vacuum is constrained to this user's memories" },
        tenant_id: { type: "string", description: "Tenant identifier to route requests to a tenant-specific memory database" },
      },
    },
  },
]
