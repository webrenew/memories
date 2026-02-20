import { resolveManagementIdentity } from "@/app/api/sdk/v1/management/identity"
import { apiError } from "@/lib/memory-service/tools"
import { errorResponse, invalidRequestResponse, successResponse } from "@/lib/sdk-api/runtime"
import { listSdkEmbeddingUsage } from "@/lib/sdk-embedding-billing"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/management/embeddings/usage"

const querySchema = z.object({
  usageMonth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(240).optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
})

function parseQuery(request: NextRequest): z.input<typeof querySchema> {
  const url = new URL(request.url)
  return {
    usageMonth: url.searchParams.get("usageMonth") ?? undefined,
    tenantId: url.searchParams.get("tenantId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()

  const identity = await resolveManagementIdentity({
    endpoint: ENDPOINT,
    request,
    requestId,
    method: "GET",
    missingApiKeyMessage: "Generate an API key before viewing embedding usage",
    expiredApiKeyMessage: "API key expired. Generate a new key before viewing embedding usage.",
    apiKeyMetadataLookupLogContext: "Failed to load API key metadata for embedding usage:",
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

  try {
    const usage = await listSdkEmbeddingUsage({
      ownerUserId: identity.userId,
      usageMonth: parsed.data.usageMonth,
      tenantId: parsed.data.tenantId,
      projectId: parsed.data.projectId,
      limit: parsed.data.limit,
    })

    return successResponse(ENDPOINT, requestId, usage)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load embedding usage"
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "EMBEDDING_USAGE_LOOKUP_FAILED",
        message,
        status: 500,
        retryable: true,
      })
    )
  }
}
