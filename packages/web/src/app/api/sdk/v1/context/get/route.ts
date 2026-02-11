import { createAdminClient } from "@/lib/supabase/admin"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { hashMcpApiKey, isValidMcpApiKey } from "@/lib/mcp-api-key"
import { checkRateLimit, mcpRateLimit } from "@/lib/rate-limit"
import { getContextPayload } from "@/lib/memory-service/queries"
import {
  apiError,
  type ApiErrorDetail,
  ensureMemoryUserIdSchema,
  parseTenantId,
  parseUserId,
  resolveTenantTurso,
  ToolExecutionError,
  toToolExecutionError,
} from "@/lib/memory-service/tools"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const SDK_RESPONSE_SCHEMA_VERSION = "2026-02-11"
const ENDPOINT = "/api/sdk/v1/context/get"

const contextModeSchema = z.enum(["all", "working", "long_term", "rules_only"])
const scopeSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(120).optional(),
    userId: z.string().trim().min(1).max(120).optional(),
    projectId: z.string().trim().min(1).max(240).optional(),
  })
  .optional()

const requestSchema = z.object({
  query: z.string().trim().max(500).optional(),
  limit: z.number().int().positive().max(50).optional(),
  includeRules: z.boolean().optional(),
  mode: contextModeSchema.optional(),
  scope: scopeSchema,
})

function getApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  return null
}

function buildMeta(requestId: string) {
  return {
    version: SDK_RESPONSE_SCHEMA_VERSION,
    endpoint: ENDPOINT,
    requestId,
    timestamp: new Date().toISOString(),
  }
}

function errorResponse(detail: ApiErrorDetail, requestId: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      data: null,
      error: detail,
      meta: buildMeta(requestId),
    },
    { status: detail.status }
  )
}

function modeMemories(
  mode: z.infer<typeof contextModeSchema>,
  data: { memories: unknown[]; workingMemories: unknown[]; longTermMemories: unknown[] }
): unknown[] {
  if (mode === "rules_only") return []
  if (mode === "working") return data.workingMemories
  if (mode === "long_term") return data.longTermMemories
  return data.memories
}

async function authenticateApiKey(
  apiKey: string,
  requestId: string
): Promise<{ userId: string; apiKeyHash: string } | NextResponse> {
  if (!isValidMcpApiKey(apiKey)) {
    return errorResponse(
      apiError({
        type: "auth_error",
        code: "INVALID_API_KEY_FORMAT",
        message: "Invalid API key format",
        status: 401,
        retryable: false,
      }),
      requestId
    )
  }

  const apiKeyHash = hashMcpApiKey(apiKey)
  const rateLimited = await checkRateLimit(mcpRateLimit, apiKeyHash)
  if (rateLimited) {
    const retryAfter = Number(rateLimited.headers.get("Retry-After") ?? "60")
    return errorResponse(
      apiError({
        type: "rate_limit_error",
        code: "RATE_LIMITED",
        message: "Too many requests",
        status: 429,
        retryable: true,
        details: { retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60 },
      }),
      requestId
    )
  }

  const admin = createAdminClient()
  const { data: user, error } = await admin
    .from("users")
    .select("id, mcp_api_key_expires_at")
    .eq("mcp_api_key_hash", apiKeyHash)
    .single()

  if (error || !user) {
    return errorResponse(
      apiError({
        type: "auth_error",
        code: "INVALID_API_KEY",
        message: "Invalid API key",
        status: 401,
        retryable: false,
      }),
      requestId
    )
  }

  if (!user.mcp_api_key_expires_at || new Date(user.mcp_api_key_expires_at).getTime() <= Date.now()) {
    return errorResponse(
      apiError({
        type: "auth_error",
        code: "API_KEY_EXPIRED",
        message: "API key expired. Generate a new key from memories.sh/app.",
        status: 401,
        retryable: false,
      }),
      requestId
    )
  }

  return {
    userId: user.id as string,
    apiKeyHash,
  }
}

async function resolveTursoForScope(
  ownerUserId: string,
  apiKeyHash: string,
  tenantId: string | null,
  requestId: string
): Promise<ReturnType<typeof createTurso> | NextResponse> {
  if (tenantId) {
    try {
      return await resolveTenantTurso(apiKeyHash, tenantId)
    } catch (error) {
      const toolError = toToolExecutionError(error, "get_context")
      return errorResponse(toolError.detail, requestId)
    }
  }

  const admin = createAdminClient()
  const context = await resolveActiveMemoryContext(admin, ownerUserId)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return errorResponse(
      apiError({
        type: "not_found_error",
        code: "DATABASE_NOT_CONFIGURED",
        message: "Database not configured. Visit memories.sh/app to set up.",
        status: 400,
        retryable: false,
      }),
      requestId
    )
  }

  return createTurso({
    url: context.turso_db_url,
    authToken: context.turso_db_token,
  })
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()

  const apiKey = getApiKey(request)
  if (!apiKey) {
    return errorResponse(
      apiError({
        type: "auth_error",
        code: "MISSING_API_KEY",
        message: "Missing API key",
        status: 401,
        retryable: false,
      }),
      requestId
    )
  }

  const authResult = await authenticateApiKey(apiKey, requestId)
  if (authResult instanceof NextResponse) {
    return authResult
  }

  let parsedRequest: z.infer<typeof requestSchema>
  try {
    const body = await request.json()
    parsedRequest = requestSchema.parse(body)
  } catch {
    return errorResponse(
      apiError({
        type: "validation_error",
        code: "INVALID_REQUEST",
        message: "Invalid request payload",
        status: 400,
        retryable: false,
      }),
      requestId
    )
  }

  try {
    const tenantId = parseTenantId({ tenant_id: parsedRequest.scope?.tenantId })
    const userId = parseUserId({ user_id: parsedRequest.scope?.userId })
    const projectId = parsedRequest.scope?.projectId
    const turso = await resolveTursoForScope(authResult.userId, authResult.apiKeyHash, tenantId, requestId)

    if (turso instanceof NextResponse) {
      return turso
    }

    await ensureMemoryUserIdSchema(turso)

    const mode = parsedRequest.mode ?? "all"
    const includeRules = parsedRequest.includeRules ?? true
    const payload = await getContextPayload({
      turso,
      projectId,
      userId,
      nowIso: new Date().toISOString(),
      query: parsedRequest.query ?? "",
      limit: parsedRequest.limit ?? 5,
    })

    const rules = includeRules ? payload.data.rules : []
    const memories = modeMemories(mode, payload.data)

    return NextResponse.json({
      ok: true,
      data: {
        mode,
        query: parsedRequest.query ?? "",
        rules,
        memories,
        workingMemories: payload.data.workingMemories,
        longTermMemories: payload.data.longTermMemories,
      },
      error: null,
      meta: buildMeta(requestId),
    })
  } catch (error) {
    const detail =
      error instanceof ToolExecutionError
        ? error.detail
        : apiError({
            type: "internal_error",
            code: "INTERNAL_ERROR",
            message: "Internal error",
            status: 500,
            retryable: true,
          })
    return errorResponse(detail, requestId)
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
