import { addMemoryPayload } from "@/lib/memory-service/mutations"
import { apiError, ensureMemoryUserIdSchema, parseTenantId, parseUserId, ToolExecutionError } from "@/lib/memory-service/tools"
import { hasAiGatewayApiKey } from "@/lib/env"
import {
  deriveEmbeddingProviderFromModelId,
  estimateEmbeddingInputTokens,
  recordSdkEmbeddingMeterEvent,
} from "@/lib/sdk-embedding-billing"
import { resolveSdkEmbeddingModelSelection } from "@/lib/sdk-embeddings/models"
import {
  authenticateApiKey,
  errorResponse,
  getApiKey,
  invalidRequestResponse,
  resolveTursoForScope,
  successResponse,
} from "@/lib/sdk-api/runtime"
import { embeddingModelSchema, memoryLayerSchema, memoryTypeSchema, scopeSchema } from "@/lib/sdk-api/schemas"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/memories/add"

const requestSchema = z.object({
  content: z.string().trim().min(1).max(8000),
  type: memoryTypeSchema.optional(),
  layer: memoryLayerSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  paths: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  embeddingModel: embeddingModelSchema.optional(),
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

    const shouldResolveEmbeddingModel = hasAiGatewayApiKey() || Boolean(parsedRequest.embeddingModel)
    const embeddingSelection = shouldResolveEmbeddingModel
      ? await resolveSdkEmbeddingModelSelection({
          ownerUserId: authResult.userId,
          apiKeyHash: authResult.apiKeyHash,
          tenantId,
          projectId,
          requestedModelId: parsedRequest.embeddingModel,
        })
      : null

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

    const payload = await addMemoryPayload({
      turso,
      args: {
        content: parsedRequest.content,
        type: parsedRequest.type,
        layer: parsedRequest.layer,
        tags: parsedRequest.tags,
        paths: parsedRequest.paths,
        category: parsedRequest.category,
        metadata: parsedRequest.metadata,
        embeddingModel: embeddingSelection?.selectedModelId,
      },
      projectId,
      userId,
      nowIso: new Date().toISOString(),
    })

    if (embeddingSelection && parsedRequest.content.trim().length > 0) {
      const selectedModel =
        embeddingSelection.availableModels.find((model) => model.id === embeddingSelection.selectedModelId) ?? null

      try {
        await recordSdkEmbeddingMeterEvent({
          ownerUserId: authResult.userId,
          apiKeyHash: authResult.apiKeyHash,
          tenantId,
          projectId: projectId ?? null,
          userId,
          requestId,
          modelId: embeddingSelection.selectedModelId,
          provider: selectedModel?.provider ?? deriveEmbeddingProviderFromModelId(embeddingSelection.selectedModelId),
          inputTokens: estimateEmbeddingInputTokens(parsedRequest.content),
          modelInputCostUsdPerToken: selectedModel?.inputCostUsdPerToken ?? null,
          estimatedCost: true,
          metadata: {
            endpoint: ENDPOINT,
            source: embeddingSelection.source,
            operation: "add",
          },
        })
      } catch (meteringError) {
        console.error("SDK embedding metering: add request metering failed", meteringError)
      }
    }

    return successResponse(
      ENDPOINT,
      requestId,
      {
        ...payload.data,
        embeddingModel: embeddingSelection?.selectedModelId ?? null,
        embeddingModelSource: embeddingSelection?.source ?? null,
      },
      201
    )
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
