import { resolveManagementIdentity } from "@/app/api/sdk/v1/management/identity"
import { apiError, ToolExecutionError } from "@/lib/memory-service/tools"
import {
  errorResponse,
  invalidRequestResponse,
  successResponse,
} from "@/lib/sdk-api/runtime"
import {
  resolveSdkEmbeddingModelSelection,
} from "@/lib/sdk-embeddings/models"
import { embeddingModelSchema } from "@/lib/sdk-api/schemas"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/embeddings/models"

const querySchema = z.object({
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(240).optional(),
  embeddingModel: embeddingModelSchema.optional(),
})

function queryFromRequest(request: NextRequest): z.infer<typeof querySchema> {
  const url = new URL(request.url)
  return {
    tenantId: url.searchParams.get("tenantId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    embeddingModel: url.searchParams.get("embeddingModel") ?? undefined,
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()
  const identity = await resolveManagementIdentity({
    endpoint: ENDPOINT,
    request,
    requestId,
    method: "GET",
    missingApiKeyMessage: "Generate an API key before listing embedding models",
    expiredApiKeyMessage: "API key expired. Generate a new key before listing embedding models.",
    apiKeyMetadataLookupLogContext: "Failed to load API key metadata for embedding model listing:",
  })
  if (identity instanceof NextResponse) return identity

  const parsedQuery = querySchema.safeParse(queryFromRequest(request))
  if (!parsedQuery.success) {
    return invalidRequestResponse(
      ENDPOINT,
      requestId,
      parsedQuery.error.issues[0]?.message ?? "Invalid request payload"
    )
  }

  try {
    const selection = await resolveSdkEmbeddingModelSelection({
      ownerUserId: identity.userId,
      apiKeyHash: identity.apiKeyHash,
      tenantId: parsedQuery.data.tenantId ?? null,
      projectId: parsedQuery.data.projectId,
      requestedModelId: parsedQuery.data.embeddingModel,
    })

    return successResponse(ENDPOINT, requestId, {
      models: selection.availableModels,
      config: {
        selectedModelId: selection.selectedModelId,
        source: selection.source,
        workspaceDefaultModelId: selection.workspaceDefaultModelId,
        projectOverrideModelId: selection.projectOverrideModelId,
        allowlistModelIds: selection.allowlistModelIds,
      },
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
