import {
  getGraphRolloutConfig,
  getGraphRolloutMetricsSummary,
  setGraphRolloutConfig,
  type GraphRolloutMode,
} from "@/lib/memory-service/graph/rollout"
import { apiError, parseTenantId, parseUserId, ToolExecutionError } from "@/lib/memory-service/tools"
import {
  authenticateApiKey,
  errorResponse,
  getApiKey,
  invalidRequestResponse,
  resolveTursoForScope,
  successResponse,
} from "@/lib/sdk-api/runtime"
import { scopeSchema } from "@/lib/sdk-api/schemas"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/graph/rollout"

const rolloutModeSchema = z.enum(["off", "shadow", "canary"])

const readRequestSchema = z.object({
  scope: scopeSchema,
})

const updateRequestSchema = z.object({
  mode: rolloutModeSchema,
  scope: scopeSchema,
})

function parseGetQuery(request: NextRequest): z.infer<typeof readRequestSchema> {
  const url = new URL(request.url)
  return readRequestSchema.parse({
    scope: {
      tenantId: url.searchParams.get("tenantId") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    },
  })
}

async function withAuthenticatedTurso(
  request: NextRequest,
  requestId: string,
  parsed: { scope?: { tenantId?: string; userId?: string; projectId?: string } }
): Promise<
  | {
      requestId: string
      authUserId: string
      scope: { tenantId: string | null; userId: string | null; projectId: string | null }
      turso: Exclude<Awaited<ReturnType<typeof resolveTursoForScope>>, NextResponse>
    }
  | NextResponse
> {
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
  const tenantId = parseTenantId({ tenant_id: parsed.scope?.tenantId })
  const userId = parseUserId({ user_id: parsed.scope?.userId })
  const projectId = parsed.scope?.projectId ?? null

  const turso = await resolveTursoForScope({
    ownerUserId: authResult.userId,
    apiKeyHash: authResult.apiKeyHash,
    tenantId,
    endpoint: ENDPOINT,
    requestId,
  })

  if (turso instanceof NextResponse) {
    return turso
  }

  return {
    requestId,
    authUserId: authResult.userId,
    scope: { tenantId, userId, projectId },
    turso,
  }
}

async function buildRolloutResponse(params: {
  requestId: string
  scope: { tenantId: string | null; userId: string | null; projectId: string | null }
  turso: Exclude<Awaited<ReturnType<typeof resolveTursoForScope>>, NextResponse>
  modeOverride?: GraphRolloutMode
  updatedBy?: string | null
}): Promise<NextResponse> {
  const { requestId, turso, scope, modeOverride, updatedBy } = params
  const nowIso = new Date().toISOString()

  const rollout =
    modeOverride === undefined
      ? await getGraphRolloutConfig(turso, nowIso)
      : await setGraphRolloutConfig(turso, {
          mode: modeOverride,
          nowIso,
          updatedBy: updatedBy ?? null,
        })

  const shadowMetrics = await getGraphRolloutMetricsSummary(turso, {
    nowIso,
    windowHours: 24,
  })

  return successResponse(ENDPOINT, requestId, {
    rollout,
    shadowMetrics,
    scope,
  })
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID()
  let parsedRequest: z.infer<typeof readRequestSchema>
  try {
    parsedRequest = parseGetQuery(request)
  } catch {
    return invalidRequestResponse(ENDPOINT, requestId)
  }

  try {
    const resolved = await withAuthenticatedTurso(request, requestId, parsedRequest)
    if (resolved instanceof NextResponse) {
      return resolved
    }

    return buildRolloutResponse({
      requestId: resolved.requestId,
      turso: resolved.turso,
      scope: resolved.scope,
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
    return errorResponse(ENDPOINT, crypto.randomUUID(), detail)
  }
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  let parsedRequest: z.infer<typeof updateRequestSchema>
  try {
    parsedRequest = updateRequestSchema.parse(await request.json())
  } catch {
    return invalidRequestResponse(ENDPOINT, requestId)
  }

  try {
    const resolved = await withAuthenticatedTurso(request, requestId, parsedRequest)
    if (resolved instanceof NextResponse) {
      return resolved
    }

    return buildRolloutResponse({
      requestId: resolved.requestId,
      turso: resolved.turso,
      scope: resolved.scope,
      modeOverride: parsedRequest.mode,
      updatedBy: resolved.authUserId,
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
    return errorResponse(ENDPOINT, crypto.randomUUID(), detail)
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request)
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
