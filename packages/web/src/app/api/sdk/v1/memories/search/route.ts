import { searchMemoriesPayload } from "@/lib/memory-service/queries"
import { apiError, ensureMemoryUserIdSchema, parseTenantId, parseUserId, ToolExecutionError } from "@/lib/memory-service/tools"
import {
  authenticateApiKey,
  errorResponse,
  getApiKey,
  invalidRequestResponse,
  resolveTursoForScope,
  successResponse,
} from "@/lib/sdk-api/runtime"
import {
  memoryLayerSchema,
  memoryTypeSchema,
  normalizeRetrievalStrategy,
  retrievalStrategySchema,
  scopeSchema,
} from "@/lib/sdk-api/schemas"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/memories/search"

const requestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  type: memoryTypeSchema.optional(),
  layer: memoryLayerSchema.optional(),
  strategy: retrievalStrategySchema.optional(),
  limit: z.number().int().positive().max(50).optional(),
  scope: scopeSchema,
})

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()

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

  let parsedRequest: z.infer<typeof requestSchema>
  try {
    parsedRequest = requestSchema.parse(await request.json())
  } catch {
    return invalidRequestResponse(ENDPOINT, requestId)
  }

  try {
    const tenantId = parseTenantId({ tenant_id: parsedRequest.scope?.tenantId })
    const userId = parseUserId({ user_id: parsedRequest.scope?.userId })
    const projectId = parsedRequest.scope?.projectId

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
    const requestedStrategy = normalizeRetrievalStrategy(parsedRequest.strategy)

    const payload = await searchMemoriesPayload({
      turso,
      args: {
        query: parsedRequest.query,
        type: parsedRequest.type,
        layer: parsedRequest.layer,
        strategy: requestedStrategy,
        limit: parsedRequest.limit,
      },
      projectId,
      userId,
      nowIso: new Date().toISOString(),
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
