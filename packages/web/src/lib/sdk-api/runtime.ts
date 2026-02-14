import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { hashMcpApiKey, isValidMcpApiKey } from "@/lib/mcp-api-key"
import { checkRateLimit, mcpRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiError, type ApiErrorDetail, resolveTenantTurso } from "@/lib/memory-service/tools"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"

export const SDK_RESPONSE_SCHEMA_VERSION = "2026-02-11"

export function buildMeta(endpoint: string, requestId: string): { version: string; endpoint: string; requestId: string; timestamp: string } {
  return {
    version: SDK_RESPONSE_SCHEMA_VERSION,
    endpoint,
    requestId,
    timestamp: new Date().toISOString(),
  }
}

export function successResponse<T>(endpoint: string, requestId: string, data: T, status = 200): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      data,
      error: null,
      meta: buildMeta(endpoint, requestId),
    },
    { status }
  )
}

export function errorResponse(endpoint: string, requestId: string, detail: ApiErrorDetail): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      data: null,
      error: detail,
      meta: buildMeta(endpoint, requestId),
    },
    { status: detail.status }
  )
}

export function invalidRequestResponse(
  endpoint: string,
  requestId: string,
  message = "Invalid request payload",
  details?: Record<string, unknown>
): NextResponse {
  return errorResponse(
    endpoint,
    requestId,
    apiError({
      type: "validation_error",
      code: "INVALID_REQUEST",
      message,
      status: 400,
      retryable: false,
      details,
    })
  )
}

export function errorTypeForStatus(status: number): ApiErrorDetail["type"] {
  if (status === 400) return "validation_error"
  if (status === 401 || status === 403) return "auth_error"
  if (status === 404) return "not_found_error"
  if (status === 429) return "rate_limit_error"
  if (status >= 500) return "internal_error"
  return "unknown_error"
}

export function legacyErrorResponse(
  endpoint: string,
  requestId: string,
  status: number,
  message: string,
  code = "LEGACY_ENDPOINT_ERROR",
  details?: Record<string, unknown>
): NextResponse {
  return errorResponse(
    endpoint,
    requestId,
    apiError({
      type: errorTypeForStatus(status),
      code,
      message,
      status,
      retryable: status === 429 || status >= 500,
      details,
    })
  )
}

export function getApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return null
  }
  return authHeader.slice(7)
}

export async function authenticateApiKey(
  apiKey: string,
  endpoint: string,
  requestId: string
): Promise<{ userId: string; apiKeyHash: string } | NextResponse> {
  if (!isValidMcpApiKey(apiKey)) {
    return errorResponse(
      endpoint,
      requestId,
      apiError({
        type: "auth_error",
        code: "INVALID_API_KEY_FORMAT",
        message: "Invalid API key format",
        status: 401,
        retryable: false,
      })
    )
  }

  const apiKeyHash = hashMcpApiKey(apiKey)
  const rateLimited = await checkRateLimit(mcpRateLimit, apiKeyHash)
  if (rateLimited) {
    const retryAfter = Number(rateLimited.headers.get("Retry-After") ?? "60")
    return errorResponse(
      endpoint,
      requestId,
      apiError({
        type: "rate_limit_error",
        code: "RATE_LIMITED",
        message: "Too many requests",
        status: 429,
        retryable: true,
        details: {
          retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 60,
        },
      })
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
      endpoint,
      requestId,
      apiError({
        type: "auth_error",
        code: "INVALID_API_KEY",
        message: "Invalid API key",
        status: 401,
        retryable: false,
      })
    )
  }

  if (!user.mcp_api_key_expires_at || new Date(user.mcp_api_key_expires_at).getTime() <= Date.now()) {
    return errorResponse(
      endpoint,
      requestId,
      apiError({
        type: "auth_error",
        code: "API_KEY_EXPIRED",
        message: "API key expired. Generate a new key from memories.sh/app.",
        status: 401,
        retryable: false,
      })
    )
  }

  return {
    userId: user.id as string,
    apiKeyHash,
  }
}

export async function resolveTursoForScope(params: {
  ownerUserId: string
  apiKeyHash: string
  tenantId: string | null
  projectId?: string | null
  endpoint: string
  requestId: string
}): Promise<ReturnType<typeof createTurso> | NextResponse> {
  const { ownerUserId, apiKeyHash, tenantId, projectId, endpoint, requestId } = params

  if (tenantId) {
    try {
      return await resolveTenantTurso(apiKeyHash, tenantId, {
        ownerUserId,
        autoProvision: true,
      })
    } catch (error) {
      const detail =
        (error as { detail?: ApiErrorDetail } | null)?.detail ??
        apiError({
          type: "internal_error",
          code: "INTERNAL_ERROR",
          message: "Internal error",
          status: 500,
          retryable: true,
        })
      return errorResponse(endpoint, requestId, detail)
    }
  }

  const admin = createAdminClient()
  const context = await resolveActiveMemoryContext(admin, ownerUserId, {
    projectId: projectId ?? null,
    fallbackToUserWithoutOrgCredentials: true,
  })
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return errorResponse(
      endpoint,
      requestId,
      apiError({
        type: "not_found_error",
        code: "DATABASE_NOT_CONFIGURED",
        message: "Database not configured. Visit memories.sh/app to set up.",
        status: 400,
        retryable: false,
      })
    )
  }

  return createTurso({
    url: context.turso_db_url,
    authToken: context.turso_db_token,
  })
}
