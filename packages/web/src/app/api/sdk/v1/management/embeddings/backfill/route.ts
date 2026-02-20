import { resolveManagementIdentity } from "@/app/api/sdk/v1/management/identity"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope"
import { apiError } from "@/lib/memory-service/tools"
import {
  getEmbeddingBackfillStatus,
  runEmbeddingBackfillBatch,
  setEmbeddingBackfillPaused,
} from "@/lib/sdk-embeddings/backfill"
import { errorResponse, invalidRequestResponse, resolveTursoForScope, successResponse } from "@/lib/sdk-api/runtime"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/management/embeddings/backfill"

const querySchema = z.object({
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(240).optional(),
  userId: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
})

const postSchema = z.object({
  action: z.enum(["run", "pause", "resume"]).default("run"),
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(240).optional(),
  userId: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
  batchLimit: z.number().int().min(1).max(10_000).optional(),
  throttleMs: z.number().int().min(0).max(5_000).optional(),
})

function parseQuery(request: NextRequest): z.input<typeof querySchema> {
  const url = new URL(request.url)
  return {
    tenantId: url.searchParams.get("tenantId") ?? undefined,
    projectId: url.searchParams.get("projectId") ?? undefined,
    userId: url.searchParams.get("userId") ?? undefined,
    modelId: url.searchParams.get("modelId") ?? undefined,
  }
}

async function resolveBackfillTurso(params: {
  endpoint: string
  requestId: string
  ownerUserId: string
  apiKeyHash: string
  tenantId: string | null
  projectId: string | null
}): Promise<ReturnType<typeof resolveTursoForScope> | NextResponse> {
  const turso = await resolveTursoForScope({
    ownerUserId: params.ownerUserId,
    apiKeyHash: params.apiKeyHash,
    tenantId: params.tenantId,
    projectId: params.projectId,
    endpoint: params.endpoint,
    requestId: params.requestId,
  })

  if (turso instanceof NextResponse) {
    return turso
  }

  await ensureMemoryUserIdSchema(turso)
  return turso
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()

  const identity = await resolveManagementIdentity({
    endpoint: ENDPOINT,
    request,
    requestId,
    method: "GET",
    missingApiKeyMessage: "Generate an API key before viewing embedding backfill status",
    expiredApiKeyMessage: "API key expired. Generate a new key before viewing embedding backfill status.",
    apiKeyMetadataLookupLogContext: "Failed to load API key metadata for embedding backfill status:",
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
    const turso = await resolveBackfillTurso({
      endpoint: ENDPOINT,
      requestId,
      ownerUserId: identity.userId,
      apiKeyHash: identity.apiKeyHash,
      tenantId,
      projectId,
    })
    if (turso instanceof NextResponse) {
      return turso
    }

    const status = await getEmbeddingBackfillStatus({
      turso,
      modelId: parsed.data.modelId,
      projectId,
      userId: parsed.data.userId ?? null,
    })

    return successResponse(ENDPOINT, requestId, status)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load embedding backfill status"
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "EMBEDDING_BACKFILL_STATUS_FAILED",
        message,
        status: 500,
        retryable: true,
      })
    )
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()

  const identity = await resolveManagementIdentity({
    endpoint: ENDPOINT,
    request,
    requestId,
    method: "POST",
    missingApiKeyMessage: "Generate an API key before running embedding backfill",
    expiredApiKeyMessage: "API key expired. Generate a new key before running embedding backfill.",
    apiKeyMetadataLookupLogContext: "Failed to load API key metadata for embedding backfill:",
  })
  if (identity instanceof NextResponse) return identity

  const parsed = postSchema.safeParse(await request.json().catch(() => null))
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
    const turso = await resolveBackfillTurso({
      endpoint: ENDPOINT,
      requestId,
      ownerUserId: identity.userId,
      apiKeyHash: identity.apiKeyHash,
      tenantId,
      projectId,
    })
    if (turso instanceof NextResponse) {
      return turso
    }

    if (parsed.data.action === "pause") {
      const status = await setEmbeddingBackfillPaused({
        turso,
        paused: true,
        modelId: parsed.data.modelId,
        projectId,
        userId: parsed.data.userId ?? null,
      })
      return successResponse(ENDPOINT, requestId, { action: "pause", status })
    }

    if (parsed.data.action === "resume") {
      const status = await setEmbeddingBackfillPaused({
        turso,
        paused: false,
        modelId: parsed.data.modelId,
        projectId,
        userId: parsed.data.userId ?? null,
      })
      return successResponse(ENDPOINT, requestId, { action: "resume", status })
    }

    const result = await runEmbeddingBackfillBatch({
      turso,
      modelId: parsed.data.modelId,
      projectId,
      userId: parsed.data.userId ?? null,
      batchLimit: parsed.data.batchLimit,
      throttleMs: parsed.data.throttleMs,
    })

    return successResponse(ENDPOINT, requestId, {
      action: "run",
      ...result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run embedding backfill"
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "EMBEDDING_BACKFILL_RUN_FAILED",
        message,
        status: 500,
        retryable: true,
      })
    )
  }
}

