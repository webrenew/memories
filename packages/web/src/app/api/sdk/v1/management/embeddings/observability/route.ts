import { resolveManagementIdentity } from "@/app/api/sdk/v1/management/identity"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope"
import { apiError } from "@/lib/memory-service/tools"
import { errorResponse, invalidRequestResponse, resolveTursoForScope, successResponse } from "@/lib/sdk-api/runtime"
import { getEmbeddingObservabilitySnapshot } from "@/lib/sdk-embeddings/observability"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/management/embeddings/observability"

const querySchema = z.object({
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(240).optional(),
  userId: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
  usageMonth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  windowHours: z.coerce.number().int().min(1).max(24 * 7).optional(),
})

function parseQuery(request: NextRequest): z.input<typeof querySchema> {
  const url = new URL(request.url)
  return {
    tenantId: url.searchParams.get("tenantId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    userId: url.searchParams.get("userId") ?? undefined,
    modelId: url.searchParams.get("modelId") ?? undefined,
    usageMonth: url.searchParams.get("usageMonth") ?? undefined,
    windowHours: url.searchParams.get("windowHours") ?? undefined,
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()

  const identity = await resolveManagementIdentity({
    endpoint: ENDPOINT,
    request,
    requestId,
    method: "GET",
    missingApiKeyMessage: "Generate an API key before viewing embedding observability metrics",
    expiredApiKeyMessage: "API key expired. Generate a new key before viewing embedding observability metrics.",
    apiKeyMetadataLookupLogContext: "Failed to load API key metadata for embedding observability:",
  })
  if (identity instanceof NextResponse) return identity

  const parsed = querySchema.safeParse(parseQuery(request))
  if (!parsed.success) {
    return invalidRequestResponse(
      ENDPOINT,
      requestId,
      parsed.error.issues[0]?.message ?? "Invalid request payload"
    )
  }

  const tenantId = parsed.data.tenantId ?? null
  const projectId = parsed.data.projectId ?? null

  try {
    const turso = await resolveTursoForScope({
      ownerUserId: identity.userId,
      apiKeyHash: identity.apiKeyHash,
      tenantId,
      projectId,
      endpoint: ENDPOINT,
      requestId,
    })
    if (turso instanceof NextResponse) return turso

    await ensureMemoryUserIdSchema(turso)

    const snapshot = await getEmbeddingObservabilitySnapshot({
      turso,
      ownerUserId: identity.userId,
      tenantId,
      projectId,
      userId: parsed.data.userId ?? null,
      modelId: parsed.data.modelId ?? null,
      usageMonth: parsed.data.usageMonth,
      windowHours: parsed.data.windowHours,
    })

    return successResponse(ENDPOINT, requestId, snapshot)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load embedding observability snapshot"
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "EMBEDDING_OBSERVABILITY_LOOKUP_FAILED",
        message,
        status: 500,
        retryable: true,
      })
    )
  }
}
