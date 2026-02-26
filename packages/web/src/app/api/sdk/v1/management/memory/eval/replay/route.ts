import { resolveManagementIdentity } from "@/app/api/sdk/v1/management/identity"
import { apiError } from "@/lib/memory-service/tools"
import { runReplayEval } from "@/lib/memory-service/eval"
import { errorResponse, invalidRequestResponse, resolveTursoForScope, successResponse } from "@/lib/sdk-api/runtime"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/management/memory/eval/replay"

const triggerTypeSchema = z.union([z.enum(["count", "time", "semantic"]), z.null()])

const scenarioSchema = z
  .object({
    id: z.string().trim().min(1).max(160).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    extraction: z
      .object({
        expected: z.array(z.string().trim().min(1)).max(200),
        observed: z.array(z.string().trim().min(1)).max(200),
      })
      .optional(),
    compaction: z
      .object({
        checkpoint: z.string().trim().min(1).max(50_000),
        requiredFacts: z.array(z.string().trim().min(1)).max(200),
      })
      .optional(),
    trigger: z
      .object({
        expected: triggerTypeSchema,
        observed: triggerTypeSchema.optional(),
        signals: z
          .object({
            estimatedTokens: z.number().int().nonnegative().optional(),
            budgetTokens: z.number().int().positive().optional(),
            turnCount: z.number().int().nonnegative().optional(),
            turnBudget: z.number().int().positive().optional(),
            lastActivityAt: z.string().trim().min(1).optional(),
            inactivityThresholdMinutes: z.number().int().positive().optional(),
            taskCompleted: z.boolean().optional(),
            nowIso: z.string().trim().min(1).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.extraction || value.compaction || value.trigger), {
    message: "Each scenario must include extraction, compaction, or trigger inputs",
  })

const postSchema = z.object({
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(240).optional(),
  userId: z.string().trim().min(1).max(120).optional(),
  nowIso: z.string().trim().min(1).optional(),
  passCriteria: z
    .object({
      extractionF1: z.number().min(0).max(1).optional(),
      compactionRetention: z.number().min(0).max(1).optional(),
      triggerAccuracy: z.number().min(0).max(1).optional(),
      casePassRatio: z.number().min(0).max(1).optional(),
    })
    .optional(),
  scenarios: z.array(scenarioSchema).min(1).max(200),
})

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID()

  const identity = await resolveManagementIdentity({
    endpoint: ENDPOINT,
    request,
    requestId,
    method: "POST",
    missingApiKeyMessage: "Generate an API key before running memory replay evals",
    expiredApiKeyMessage: "API key expired. Generate a new key before running memory replay evals.",
    apiKeyMetadataLookupLogContext: "Failed to load API key metadata for memory replay eval:",
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
    const turso = await resolveTursoForScope({
      ownerUserId: identity.userId,
      apiKeyHash: identity.apiKeyHash,
      tenantId,
      projectId,
      endpoint: ENDPOINT,
      requestId,
    })
    if (turso instanceof NextResponse) return turso

    void turso

    const result = runReplayEval({
      nowIso: parsed.data.nowIso,
      passCriteria: parsed.data.passCriteria,
      scenarios: parsed.data.scenarios.map((scenario, index) => ({
        id: scenario.id ?? `scenario-${index + 1}`,
        title: scenario.title,
        extraction: scenario.extraction,
        compaction: scenario.compaction,
        trigger: scenario.trigger,
      })),
    })

    return successResponse(ENDPOINT, requestId, {
      scope: {
        tenantId,
        projectId,
        userId: parsed.data.userId ?? null,
      },
      ...result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run memory replay eval"
    return errorResponse(
      ENDPOINT,
      requestId,
      apiError({
        type: "internal_error",
        code: "MEMORY_EVAL_REPLAY_FAILED",
        message,
        status: 500,
        retryable: true,
      })
    )
  }
}
