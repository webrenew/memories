import { checkpointSessionPayload } from "@/lib/memory-service/sessions"
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
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/sessions/checkpoint"

const requestSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(16_000),
  role: z.enum(["user", "assistant", "tool"]).optional(),
  kind: z.enum(["message", "checkpoint", "summary", "event"]).optional(),
  tokenCount: z.number().int().nonnegative().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  isMeaningful: z.boolean().optional(),
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
    const nowIso = new Date().toISOString()

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

    const payload = await checkpointSessionPayload({
      turso,
      args: {
        sessionId: parsedRequest.sessionId,
        content: parsedRequest.content,
        role: parsedRequest.role,
        kind: parsedRequest.kind,
        tokenCount: parsedRequest.tokenCount,
        turnIndex: parsedRequest.turnIndex,
        isMeaningful: parsedRequest.isMeaningful,
      },
      projectId,
      userId,
      nowIso,
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
