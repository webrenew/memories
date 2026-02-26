import { resolveManagementIdentity } from "@/app/api/sdk/v1/management/identity"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope"
import { apiError } from "@/lib/memory-service/tools"
import { errorResponse, invalidRequestResponse, resolveTursoForScope, successResponse } from "@/lib/sdk-api/runtime"
import { getMemoryLifecycleObservabilitySnapshot } from "@/lib/memory-service/observability"
import { isMemoryCompactionEnabled } from "@/lib/env"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/management/memory/observability"

const querySchema = z.object({
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(240).optional(),
  userId: z.string().trim().min(1).max(120).optional(),
  windowHours: z.coerce.number().int().min(1).max(24 * 14).optional(),
})

function parseQuery(request: NextRequest): z.input<typeof querySchema> {
  const url = new URL(request.url)
  return {
    tenantId: url.searchParams.get("tenantId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    userId: url.searchParams.get("userId") ?? undefined,
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
    missingApiKeyMessage: "Generate an API key before viewing memory observability metrics",
    expiredApiKeyMessage: "API key expired. Generate a new key before viewing memory observability metrics.",
    apiKeyMetadataLookupLogContext: "Failed to load API key metadata for memory observability:",
  })
  if (identity instanceof NextResponse) return identity

  if (!isMemoryCompactionEnabled()) {
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "validation_error",
        code: "MEMORY_COMPACTION_DISABLED",
        message: "Memory lifecycle observability is disabled by MEMORY_COMPACTION_ENABLED=0.",
        status: 403,
        retryable: false,
        details: { flag: "MEMORY_COMPACTION_ENABLED" },
      })
    )
  }

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

    const snapshot = await getMemoryLifecycleObservabilitySnapshot({
      turso,
      tenantId,
      projectId,
      userId: parsed.data.userId ?? null,
      windowHours: parsed.data.windowHours,
    })

    return successResponse(ENDPOINT, requestId, snapshot)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load memory observability snapshot"
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "MEMORY_OBSERVABILITY_LOOKUP_FAILED",
        message,
        status: 500,
        retryable: true,
      })
    )
  }
}
