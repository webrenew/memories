import { getContextPayload } from "@/lib/memory-service/queries"
import { evaluateGraphRetrievalPolicy } from "@/lib/memory-service/graph/rollout"
import { listSkillFilesPayload } from "@/lib/memory-service/skill-files"
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
  normalizeRetrievalStrategy,
  retrievalStrategySchema,
  scopeSchema,
  toLegacyContextRetrievalStrategy,
} from "@/lib/sdk-api/schemas"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const ENDPOINT = "/api/sdk/v1/context/get"

const contextModeSchema = z.enum(["all", "working", "long_term", "rules_only"])

const requestSchema = z.object({
  query: z.string().trim().max(500).optional(),
  limit: z.number().int().positive().max(50).optional(),
  includeRules: z.boolean().optional(),
  includeSkillFiles: z.boolean().optional(),
  mode: contextModeSchema.optional(),
  strategy: retrievalStrategySchema.optional(),
  graphDepth: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  graphLimit: z.number().int().positive().max(50).optional(),
  scope: scopeSchema,
})

function modeMemories(
  mode: z.infer<typeof contextModeSchema>,
  data: { memories: unknown[]; workingMemories: unknown[]; longTermMemories: unknown[] }
): unknown[] {
  if (mode === "rules_only") return []
  if (mode === "working") return data.workingMemories
  if (mode === "long_term") return data.longTermMemories
  return data.memories
}

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

    const mode = parsedRequest.mode ?? "all"
    const includeRules = parsedRequest.includeRules ?? true
    const includeSkillFiles = parsedRequest.includeSkillFiles ?? true
    const nowIso = new Date().toISOString()
    const policySnapshot = await evaluateGraphRetrievalPolicy(turso, {
      nowIso,
      updatedBy: authResult.userId,
    })
    const requestedStrategy = parsedRequest.strategy
      ? normalizeRetrievalStrategy(parsedRequest.strategy)
      : policySnapshot.policy.defaultStrategy === "hybrid"
        ? "hybrid"
        : "lexical"
    const payload = await getContextPayload({
      turso,
      projectId,
      userId,
      nowIso,
      query: parsedRequest.query ?? "",
      limit: parsedRequest.limit ?? 5,
      semanticStrategy: requestedStrategy,
      retrievalStrategy: toLegacyContextRetrievalStrategy(requestedStrategy),
      graphDepth: parsedRequest.graphDepth ?? 1,
      graphLimit: parsedRequest.graphLimit ?? 8,
    })

    const rules = includeRules ? payload.data.rules : []
    const memories = modeMemories(mode, payload.data)
    const skillFilesPayload = includeSkillFiles
      ? await listSkillFilesPayload({
          turso,
          projectId,
          userId,
          limit: 100,
        })
      : { data: { skillFiles: [], count: 0 } }

    return successResponse(ENDPOINT, requestId, {
      mode,
      query: parsedRequest.query ?? "",
      rules,
      memories,
      conflicts: payload.data.conflicts,
      skillFiles: skillFilesPayload.data.skillFiles,
      workingMemories: payload.data.workingMemories,
      longTermMemories: payload.data.longTermMemories,
      trace: {
        ...payload.data.trace,
        retrievalPolicyDefaultStrategy: policySnapshot.policy.defaultStrategy,
        retrievalPolicyAppliedStrategy: payload.data.trace.strategy === "hybrid_graph" ? "hybrid" : "lexical",
        retrievalPolicySelection: parsedRequest.strategy ? "request" : "policy_default",
        retrievalPolicyReadyForDefaultOn: policySnapshot.plan.readyForDefaultOn,
        retrievalPolicyBlockerCodes: policySnapshot.plan.blockerCodes,
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
