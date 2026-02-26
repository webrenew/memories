import { getLatestSessionSnapshotPayload } from "@/lib/memory-service/sessions"
import { apiError, ensureMemoryUserIdSchema, parseTenantId, parseUserId, ToolExecutionError } from "@/lib/memory-service/tools"
import {
  authenticateApiKey,
  errorResponse,
  getApiKey,
  invalidRequestResponse,
  resolveTursoForScope,
  successResponse,
} from "@/lib/sdk-api/runtime"
import { scopeSchema } from "@/lib/sdk-api/schemas"
import { isMemorySessionEnabled } from "@/lib/env"
import { NextRequest, NextResponse } from "next/server"

const ENDPOINT = "/api/sdk/v1/sessions/{id}/snapshot"

function parseScopeFromQuery(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId") ?? undefined
  const userId = request.nextUrl.searchParams.get("userId") ?? undefined
  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined
  const hasScope = Boolean(tenantId || userId || projectId)

  return scopeSchema.parse(
    hasScope
      ? {
          tenantId,
          userId,
          projectId,
        }
      : undefined
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const requestId = crypto.randomUUID()
  const { sessionId: sessionIdRaw } = await params
  const sessionId = sessionIdRaw?.trim()
  if (!sessionId) {
    return invalidRequestResponse(ENDPOINT, requestId, "Session id is required", { field: "sessionId" })
  }

  const apiKey = getApiKey(request)
  if (!apiKey) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "auth_error",
        code: "MISSING_API_KEY",
        message: "Missing API key",
        status: 401,
        retryable: false,
      })
    )
  }

  const authResult = await authenticateApiKey(apiKey, ENDPOINT, requestId)
  if (authResult instanceof NextResponse) {
    return authResult
  }

  if (!isMemorySessionEnabled()) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "validation_error",
        code: "MEMORY_SESSION_DISABLED",
        message: "Memory session lifecycle endpoints are disabled by MEMORY_SESSION_ENABLED=0.",
        status: 403,
        retryable: false,
        details: { flag: "MEMORY_SESSION_ENABLED" },
      })
    )
  }

  let scope: ReturnType<typeof scopeSchema.parse>
  try {
    scope = parseScopeFromQuery(request)
  } catch {
    return invalidRequestResponse(ENDPOINT, requestId)
  }

  try {
    const tenantId = parseTenantId({ tenant_id: scope?.tenantId })
    const userId = parseUserId({ user_id: scope?.userId })
    const projectId = scope?.projectId

    const turso = await resolveTursoForScope({
      ownerUserId: authResult.userId,
      apiKeyHash: authResult.apiKeyHash,
      tenantId,
      projectId,
      endpoint: ENDPOINT,
      requestId,
    })

    if (turso instanceof NextResponse) {
      return turso
    }

    await ensureMemoryUserIdSchema(turso)

    const payload = await getLatestSessionSnapshotPayload({
      turso,
      sessionId,
      projectId,
      userId,
    })

    return successResponse(ENDPOINT, requestId, payload.data)
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

    return errorResponse(ENDPOINT, requestId, detail)
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
