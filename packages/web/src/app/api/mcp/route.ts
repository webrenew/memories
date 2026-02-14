import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, mcpRateLimit } from "@/lib/rate-limit"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { hashMcpApiKey } from "@/lib/mcp-api-key"
import { MCP_MAX_CONNECTIONS_PER_KEY, MCP_MAX_CONNECTIONS_PER_IP } from "@/lib/env"
import {
  apiError,
  executeMemoryTool,
  ensureMemoryUserIdSchema,
  parseTenantId,
  resolveTenantTurso,
  ToolExecutionError,
  toToolExecutionError,
} from "@/lib/memory-service/tools"
import {
  connections,
  MCP_RESPONSE_SCHEMA_VERSION,
  encoder,
  cleanupConnection,
  touchConnection,
  pruneExpiredConnections,
  countConnectionsFor,
  authenticateAndGetTurso,
  getApiKey,
  formatSSE,
  endpointErrorResponse,
  jsonRpcErrorResponse,
  TOOLS,
} from "./mcp-route-helpers"

// SSE endpoint - GET opens the event stream
export async function GET(request: NextRequest): Promise<Response> {
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
export async function POST(request: NextRequest): Promise<Response> {
  pruneExpiredConnections()

  const url = new URL(request.url)
  const sessionId = url.searchParams.get("session")

  let turso: ReturnType<typeof createTurso>
  let apiKeyHash: string | null = null
  let ownerUserId: string | null = null
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let activeSessionId: string | null = null

  if (sessionId && connections.has(sessionId)) {
    const conn = connections.get(sessionId)!
    const rateLimited = await checkRateLimit(mcpRateLimit, conn.rateLimitKey)
    if (rateLimited) return rateLimited

    touchConnection(sessionId)
    turso = conn.turso
    apiKeyHash = conn.apiKeyHash
    ownerUserId = conn.userId
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
    ownerUserId = auth.user.id
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonRpcErrorResponse(
      null,
      -32700,
      apiError({
        type: "validation_error",
        code: "PARSE_ERROR",
        message: "Invalid JSON payload",
        status: 400,
        retryable: false,
      }),
      400
    )
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonRpcErrorResponse(
      null,
      -32600,
      apiError({
        type: "validation_error",
        code: "INVALID_REQUEST",
        message: "Invalid JSON-RPC request",
        status: 400,
        retryable: false,
      }),
      400
    )
  }

  const { method, params, id } = body as {
    method?: unknown
    params?: unknown
    id?: unknown
  }

  if (typeof method !== "string" || method.length === 0) {
    return jsonRpcErrorResponse(
      id ?? null,
      -32600,
      apiError({
        type: "validation_error",
        code: "INVALID_REQUEST",
        message: "JSON-RPC method must be a non-empty string",
        status: 400,
        retryable: false,
      }),
      400
    )
  }

  try {
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
        const parsedParams = (params && typeof params === "object" && !Array.isArray(params)) ? (params as Record<string, unknown>) : {}
        const toolName = typeof parsedParams.name === "string" ? parsedParams.name : ""
        if (!toolName) {
          return jsonRpcErrorResponse(
            id,
            -32602,
            apiError({
              type: "validation_error",
              code: "INVALID_TOOL_NAME",
              message: "tools/call requires a string name",
              status: 400,
              retryable: false,
            }),
            400
          )
        }
        const args = (parsedParams.arguments && typeof parsedParams.arguments === "object" && !Array.isArray(parsedParams.arguments))
          ? (parsedParams.arguments as Record<string, unknown>)
          : {}

        try {
          const tenantId = parseTenantId(args)
          const projectId =
            typeof args.project_id === "string" && args.project_id.trim().length > 0
              ? args.project_id
              : null

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
          if (!ownerUserId) {
            throw new ToolExecutionError(
              apiError({
                type: "internal_error",
                code: "USER_CONTEXT_MISSING",
                message: "User context is unavailable for this request",
                status: 500,
                retryable: true,
              })
            )
          }

          let toolTurso = turso
          if (tenantId) {
            toolTurso = await resolveTenantTurso(apiKeyHash as string, tenantId)
          } else if (projectId) {
            const admin = createAdminClient()
            const context = await resolveActiveMemoryContext(admin, ownerUserId, {
              projectId,
              fallbackToUserWithoutOrgCredentials: true,
            })

            if (!context?.turso_db_url || !context?.turso_db_token) {
              throw new ToolExecutionError(
                apiError({
                  type: "not_found_error",
                  code: "DATABASE_NOT_CONFIGURED",
                  message: "Database not configured. Visit memories.sh/app to set up.",
                  status: 400,
                  retryable: false,
                })
              )
            }

            toolTurso = createTurso({
              url: context.turso_db_url,
              authToken: context.turso_db_token,
            })
          }
          await ensureMemoryUserIdSchema(toolTurso)
          result = await executeMemoryTool(toolName, args, toolTurso, {
            responseSchemaVersion: MCP_RESPONSE_SCHEMA_VERSION,
          })
        } catch (err) {
          const toolError = toToolExecutionError(err, toolName)
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
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
