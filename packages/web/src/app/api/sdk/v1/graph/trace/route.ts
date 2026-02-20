import { getContextPayload } from "@/lib/memory-service/queries"
import { evaluateGraphRetrievalPolicy } from "@/lib/memory-service/graph/rollout"
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

const ENDPOINT = "/api/sdk/v1/graph/trace"

const contextModeSchema = z.enum(["all", "working", "long_term", "rules_only"])
const contextStrategySchema = z.enum(["baseline", "hybrid_graph"])

const requestSchema = z.object({
  query: z.string().trim().max(500).optional(),
  limit: z.number().int().positive().max(50).optional(),
  includeRules: z.boolean().optional(),
  mode: contextModeSchema.optional(),
  strategy: contextStrategySchema.optional(),
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
    const nowIso = new Date().toISOString()
    const policySnapshot = await evaluateGraphRetrievalPolicy(turso, {
      nowIso,
      updatedBy: authResult.userId,
    })
    const requestedStrategy =
      parsedRequest.strategy ??
      (policySnapshot.policy.defaultStrategy === "hybrid" ? "hybrid_graph" : "baseline")
    const payload = await getContextPayload({
      turso,
      projectId,
      userId,
      nowIso,
      query: parsedRequest.query ?? "",
      limit: parsedRequest.limit ?? 10,
      retrievalStrategy: requestedStrategy,
      graphDepth: parsedRequest.graphDepth ?? 1,
      graphLimit: parsedRequest.graphLimit ?? 8,
    })

    const rules = includeRules ? payload.data.rules : []
    const memories = modeMemories(mode, payload.data) as Array<{
      id: string | null
      layer: string
      type: string
      scope: string
      projectId: string | null
      graph?: {
        whyIncluded: "graph_expansion"
        linkedViaNode: string
        edgeType: string
        hopCount: number
        seedMemoryId: string
      }
    }>

    const recall = memories.map((memory, index) => ({
      rank: index + 1,
      memoryId: memory.id,
      layer: memory.layer,
      type: memory.type,
      scope: memory.scope,
      projectId: memory.projectId,
      source: memory.graph ? "graph_expansion" : "baseline",
      graph: memory.graph ?? null,
    }))

    return successResponse(ENDPOINT, requestId, {
      mode,
      includeRules,
      query: parsedRequest.query ?? "",
      strategy: {
        requested: requestedStrategy,
        applied: payload.data.trace.strategy,
      },
      trace: {
        ...payload.data.trace,
        retrievalPolicyDefaultStrategy: policySnapshot.policy.defaultStrategy,
        retrievalPolicyAppliedStrategy: payload.data.trace.strategy === "hybrid_graph" ? "hybrid" : "lexical",
        retrievalPolicySelection: parsedRequest.strategy ? "request" : "policy_default",
        retrievalPolicyReadyForDefaultOn: policySnapshot.plan.readyForDefaultOn,
        retrievalPolicyBlockerCodes: policySnapshot.plan.blockerCodes,
      },
      tiers: {
        ruleIds: rules.map((rule) => rule.id).filter((id): id is string => Boolean(id)),
        workingIds: payload.data.workingMemories.map((memory) => memory.id).filter((id): id is string => Boolean(id)),
        longTermIds: payload.data.longTermMemories
          .map((memory) => memory.id)
          .filter((id): id is string => Boolean(id)),
      },
      recall,
      rules,
      memories,
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
