import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  mockUserSelect,
  mockTenantSelect,
  mockResolveActiveMemoryContext,
  mockGetGraphStatusPayload,
  mockGetContextPayload,
  mockEvaluateGraphRetrievalPolicy,
  mockGetGraphRolloutConfig,
  mockSetGraphRolloutConfig,
  mockGetGraphRolloutMetricsSummary,
  mockEvaluateGraphRolloutQuality,
  mockExecute,
} = vi.hoisted(() => ({
  mockUserSelect: vi.fn(),
  mockTenantSelect: vi.fn(),
  mockResolveActiveMemoryContext: vi.fn(),
  mockGetGraphStatusPayload: vi.fn(),
  mockGetContextPayload: vi.fn(),
  mockEvaluateGraphRetrievalPolicy: vi.fn(),
  mockGetGraphRolloutConfig: vi.fn(),
  mockSetGraphRolloutConfig: vi.fn(),
  mockGetGraphRolloutMetricsSummary: vi.fn(),
  mockEvaluateGraphRolloutQuality: vi.fn(),
  mockExecute: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const filters: Record<string, unknown> = {}
        const query = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value
            return query
          }),
          single: vi.fn(() => {
            if (table === "users") {
              return mockUserSelect({ table, filters })
            }
            if (table === "sdk_tenant_databases") {
              return mockTenantSelect({ table, filters })
            }
            return { data: null, error: { message: `Unexpected table: ${table}` } }
          }),
        }
        return query
      }),
    })),
  })),
}))

vi.mock("@/lib/active-memory-context", () => ({
  resolveActiveMemoryContext: mockResolveActiveMemoryContext,
}))

vi.mock("@/lib/rate-limit", () => ({
  mcpRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
  })),
}))

vi.mock("@/lib/memory-service/graph/status", () => ({
  getGraphStatusPayload: mockGetGraphStatusPayload,
}))

vi.mock("@/lib/memory-service/queries", () => ({
  getContextPayload: mockGetContextPayload,
}))

vi.mock("@/lib/memory-service/graph/rollout", () => ({
  evaluateGraphRetrievalPolicy: mockEvaluateGraphRetrievalPolicy,
  getGraphRolloutConfig: mockGetGraphRolloutConfig,
  setGraphRolloutConfig: mockSetGraphRolloutConfig,
  getGraphRolloutMetricsSummary: mockGetGraphRolloutMetricsSummary,
  evaluateGraphRolloutQuality: mockEvaluateGraphRolloutQuality,
}))

import { GET as statusGET, OPTIONS as statusOPTIONS, POST as statusPOST } from "../status/route"
import { OPTIONS as traceOPTIONS, POST as tracePOST } from "../trace/route"
import {
  GET as rolloutGET,
  OPTIONS as rolloutOPTIONS,
  PATCH as rolloutPATCH,
  POST as rolloutPOST,
} from "../rollout/route"

const VALID_API_KEY = `mem_${"a".repeat(64)}`

function makeRequest(path: string, method: "GET" | "POST" | "PATCH", body?: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (method === "POST" || method === "PATCH") {
    headers["content-type"] = "application/json"
  }
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  return new NextRequest(`https://example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("/api/sdk/v1/graph/*", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUserSelect.mockReturnValue({
      data: {
        id: "user-1",
        mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
      },
      error: null,
    })
    mockTenantSelect.mockReturnValue({ data: null, error: null })
    mockResolveActiveMemoryContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      turso_db_url: "libsql://default-db.turso.io",
      turso_db_token: "default-token",
      turso_db_name: "default-db",
    })
    mockExecute.mockResolvedValue({ rows: [] })

    mockGetGraphStatusPayload.mockResolvedValue({
      enabled: true,
      flags: {
        mappingEnabled: true,
        retrievalEnabled: true,
        llmExtractionEnabled: false,
      },
      health: "ok",
      tables: {
        graphNodes: true,
        graphEdges: true,
        memoryNodeLinks: true,
      },
      counts: {
        nodes: 12,
        edges: 22,
        memoryLinks: 35,
        activeEdges: 20,
        expiredEdges: 2,
        orphanNodes: 1,
      },
      rollout: {
        mode: "canary",
        updatedAt: "2026-02-12T00:00:00.000Z",
        updatedBy: "user-1",
      },
      shadowMetrics: {
        windowHours: 24,
        totalRequests: 120,
        hybridRequested: 96,
        canaryApplied: 90,
        shadowExecutions: 6,
        fallbackCount: 6,
        fallbackRate: 0.05,
        graphErrorFallbacks: 1,
        avgGraphCandidates: 2.5,
        avgGraphExpandedCount: 1.2,
        lastFallbackAt: "2026-02-12T00:00:00.000Z",
        lastFallbackReason: "shadow_mode",
      },
      qualityGate: {
        evaluatedAt: "2026-02-12T00:00:00.000Z",
        windowHours: 24,
        minHybridSamples: 20,
        minCanarySamplesForRelevance: 12,
        status: "pass",
        canaryBlocked: false,
        reasons: [],
        current: {
          startAt: "2026-02-11T00:00:00.000Z",
          endAt: "2026-02-12T00:00:00.000Z",
          totalRequests: 120,
          hybridRequested: 96,
          canaryApplied: 90,
          hybridFallbacks: 6,
          graphErrorFallbacks: 1,
          fallbackRate: 0.05,
          graphErrorFallbackRate: 0.01,
          canaryWithExpansion: 80,
          expansionCoverageRate: 0.89,
          avgExpandedCount: 1.2,
          avgCandidateLift: 1.4,
        },
        previous: {
          startAt: "2026-02-10T00:00:00.000Z",
          endAt: "2026-02-11T00:00:00.000Z",
          totalRequests: 100,
          hybridRequested: 80,
          canaryApplied: 70,
          hybridFallbacks: 5,
          graphErrorFallbacks: 1,
          fallbackRate: 0.0625,
          graphErrorFallbackRate: 0.0125,
          canaryWithExpansion: 64,
          expansionCoverageRate: 0.9143,
          avgExpandedCount: 1.1,
          avgCandidateLift: 1.3,
        },
      },
      alarms: [],
      topConnectedNodes: [
        {
          nodeType: "topic",
          nodeKey: "auth",
          label: "Auth",
          memoryLinks: 8,
          outboundEdges: 5,
          inboundEdges: 4,
          degree: 17,
        },
      ],
      recentErrors: [],
      sampledAt: "2026-02-12T00:00:00.000Z",
    })

    mockGetGraphRolloutConfig.mockResolvedValue({
      mode: "shadow",
      updatedAt: "2026-02-12T00:00:00.000Z",
      updatedBy: "user-1",
    })

    mockSetGraphRolloutConfig.mockResolvedValue({
      mode: "canary",
      updatedAt: "2026-02-12T01:00:00.000Z",
      updatedBy: "user-1",
    })

    mockGetGraphRolloutMetricsSummary.mockResolvedValue({
      windowHours: 24,
      totalRequests: 48,
      hybridRequested: 32,
      canaryApplied: 20,
      shadowExecutions: 12,
      fallbackCount: 12,
      fallbackRate: 0.25,
      graphErrorFallbacks: 2,
      avgGraphCandidates: 3,
      avgGraphExpandedCount: 1.4,
      lastFallbackAt: "2026-02-12T00:55:00.000Z",
      lastFallbackReason: "shadow_mode",
    })

    mockEvaluateGraphRolloutQuality.mockResolvedValue({
      evaluatedAt: "2026-02-12T01:00:00.000Z",
      windowHours: 24,
      minHybridSamples: 20,
      minCanarySamplesForRelevance: 12,
      status: "pass",
      canaryBlocked: false,
      reasons: [],
      current: {
        startAt: "2026-02-11T01:00:00.000Z",
        endAt: "2026-02-12T01:00:00.000Z",
        totalRequests: 48,
        hybridRequested: 32,
        canaryApplied: 20,
        hybridFallbacks: 12,
        graphErrorFallbacks: 2,
        fallbackRate: 0.25,
        graphErrorFallbackRate: 0.0417,
        canaryWithExpansion: 18,
        expansionCoverageRate: 0.9,
        avgExpandedCount: 1.4,
        avgCandidateLift: 1.8,
      },
      previous: {
        startAt: "2026-02-10T01:00:00.000Z",
        endAt: "2026-02-11T01:00:00.000Z",
        totalRequests: 48,
        hybridRequested: 32,
        canaryApplied: 24,
        hybridFallbacks: 6,
        graphErrorFallbacks: 1,
        fallbackRate: 0.1875,
        graphErrorFallbackRate: 0.0313,
        canaryWithExpansion: 21,
        expansionCoverageRate: 0.875,
        avgExpandedCount: 1.3,
        avgCandidateLift: 1.6,
      },
    })

    mockEvaluateGraphRetrievalPolicy.mockResolvedValue({
      rollout: {
        mode: "shadow",
        updatedAt: "2026-02-12T00:00:00.000Z",
        updatedBy: "user-1",
      },
      shadowMetrics: {
        windowHours: 24,
        totalRequests: 48,
        hybridRequested: 32,
        canaryApplied: 20,
        shadowExecutions: 12,
        fallbackCount: 12,
        fallbackRate: 0.25,
        graphErrorFallbacks: 2,
        avgGraphCandidates: 3,
        avgGraphExpandedCount: 1.4,
        lastFallbackAt: "2026-02-12T00:55:00.000Z",
        lastFallbackReason: "shadow_mode",
      },
      qualityGate: {
        evaluatedAt: "2026-02-12T01:00:00.000Z",
        windowHours: 24,
        minHybridSamples: 20,
        minCanarySamplesForRelevance: 12,
        status: "pass",
        canaryBlocked: false,
        reasons: [],
        current: {
          startAt: "2026-02-11T01:00:00.000Z",
          endAt: "2026-02-12T01:00:00.000Z",
          totalRequests: 48,
          hybridRequested: 32,
          canaryApplied: 20,
          hybridFallbacks: 12,
          graphErrorFallbacks: 2,
          fallbackRate: 0.25,
          graphErrorFallbackRate: 0.0417,
          canaryWithExpansion: 18,
          expansionCoverageRate: 0.9,
          avgExpandedCount: 1.4,
          avgCandidateLift: 1.8,
        },
        previous: {
          startAt: "2026-02-10T01:00:00.000Z",
          endAt: "2026-02-11T01:00:00.000Z",
          totalRequests: 48,
          hybridRequested: 32,
          canaryApplied: 24,
          hybridFallbacks: 6,
          graphErrorFallbacks: 1,
          fallbackRate: 0.1875,
          graphErrorFallbackRate: 0.0313,
          canaryWithExpansion: 21,
          expansionCoverageRate: 0.875,
          avgExpandedCount: 1.3,
          avgCandidateLift: 1.6,
        },
      },
      plan: {
        evaluatedAt: "2026-02-12T01:00:00.000Z",
        currentMode: "shadow",
        recommendedMode: "shadow",
        defaultBehaviorDecision: "hold_lexical_default",
        rationale: "Hold lexical default.",
        readyForDefaultOn: false,
        blockerCodes: ["MIN_CANARY_SAMPLES_NOT_MET"],
        stages: [],
        baseline: [],
        slo: {
          minShadowExecutionsForCanary: 40,
          minShadowAverageGraphCandidates: 1,
          maxShadowGraphErrorRateForCanary: 0.05,
          minHybridSamplesForDefaultOn: 20,
          minCanarySamplesForDefaultOn: 12,
          maxFallbackRateForDefaultOn: 0.15,
          maxGraphErrorRateForDefaultOn: 0.05,
          minExpansionCoverageForDefaultOn: 0.1,
        },
        autopilot: {
          enabled: false,
          applied: false,
        },
      },
      policy: {
        defaultStrategy: "lexical",
        readyWindowStreak: 0,
        lastDecision: "hold_lexical_default",
        lastEvaluatedAt: "2026-02-12T01:00:00.000Z",
        updatedAt: "2026-02-12T01:00:00.000Z",
        updatedBy: "user-1",
      },
      autopilot: {
        enabled: true,
        applied: false,
        promoteAfterReadyWindows: 2,
      },
    })

    mockGetContextPayload.mockResolvedValue({
      text: "## Relevant Memories",
      data: {
        rules: [{ id: "r1", content: "Always test", type: "rule", layer: "rule" }],
        workingMemories: [{ id: "w1", content: "Working memory", type: "note", layer: "working" }],
        longTermMemories: [
          {
            id: "l1",
            content: "Graph expanded memory",
            type: "fact",
            layer: "long_term",
            graph: {
              whyIncluded: "graph_expansion",
              linkedViaNode: "topic:billing",
              edgeType: "mentions",
              hopCount: 1,
              seedMemoryId: "w1",
            },
          },
        ],
        memories: [
          { id: "w1", content: "Working memory", type: "note", layer: "working" },
          {
            id: "l1",
            content: "Graph expanded memory",
            type: "fact",
            layer: "long_term",
            graph: {
              whyIncluded: "graph_expansion",
              linkedViaNode: "topic:billing",
              edgeType: "mentions",
              hopCount: 1,
              seedMemoryId: "w1",
            },
          },
        ],
        trace: {
          requestedStrategy: "hybrid_graph",
          strategy: "hybrid_graph",
          graphDepth: 1,
          graphLimit: 8,
          rolloutMode: "canary",
          shadowExecuted: false,
          qualityGateStatus: "pass",
          qualityGateBlocked: false,
          qualityGateReasonCodes: [],
          baselineCandidates: 1,
          graphCandidates: 2,
          graphExpandedCount: 1,
          fallbackTriggered: false,
          fallbackReason: null,
          totalCandidates: 2,
        },
      },
    })
  })

  it("graph/status GET requires API key", async () => {
    const response = await statusGET(makeRequest("/api/sdk/v1/graph/status", "GET"))
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error.code).toBe("MISSING_API_KEY")
  })

  it("graph/status POST returns status envelope", async () => {
    const response = await statusPOST(
      makeRequest(
        "/api/sdk/v1/graph/status",
        "POST",
        {
          topNodesLimit: 7,
          scope: {
            userId: "end-user-1",
            projectId: "github.com/acme/repo",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.health).toBe("ok")
    expect(body.data.counts.nodes).toBe(12)
    expect(body.data.scope.userId).toBe("end-user-1")
    expect(body.data.scope.projectId).toBe("github.com/acme/repo")
    expect(mockGetGraphStatusPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        topNodesLimit: 7,
      })
    )
    expect(mockResolveActiveMemoryContext).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        projectId: "github.com/acme/repo",
        fallbackToUserWithoutOrgCredentials: true,
      })
    )
  })

  it("graph/status GET parses query parameters", async () => {
    const response = await statusGET(
      makeRequest(
        "/api/sdk/v1/graph/status?topNodesLimit=5&userId=end-user-1&projectId=github.com/acme/repo",
        "GET",
        undefined,
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.scope.userId).toBe("end-user-1")
    expect(body.data.scope.projectId).toBe("github.com/acme/repo")
    expect(mockGetGraphStatusPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        topNodesLimit: 5,
      })
    )
  })

  it("graph/trace returns recall trace payload", async () => {
    const response = await tracePOST(
      makeRequest(
        "/api/sdk/v1/graph/trace",
        "POST",
        {
          query: "auth",
          strategy: "hybrid_graph",
          graphDepth: 2,
          graphLimit: 12,
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.trace.strategy).toBe("hybrid_graph")
    expect(body.data.trace.retrievalPolicySelection).toBe("request")
    expect(body.data.strategy).toEqual({
      requested: "hybrid_graph",
      applied: "hybrid_graph",
    })
    expect(body.data.recall).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryId: "w1",
          source: "baseline",
        }),
        expect.objectContaining({
          memoryId: "l1",
          source: "graph_expansion",
        }),
      ])
    )
    expect(mockGetContextPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "auth",
        userId: "end-user-1",
        retrievalStrategy: "hybrid_graph",
        graphDepth: 2,
        graphLimit: 12,
      })
    )
  })

  it("graph/trace uses policy default strategy when request strategy is omitted", async () => {
    mockEvaluateGraphRetrievalPolicy.mockResolvedValueOnce({
      plan: {
        readyForDefaultOn: true,
        blockerCodes: [],
      },
      policy: {
        defaultStrategy: "hybrid",
      },
    })

    const response = await tracePOST(
      makeRequest(
        "/api/sdk/v1/graph/trace",
        "POST",
        {
          query: "rollout",
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    expect(mockGetContextPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "rollout",
        retrievalStrategy: "hybrid_graph",
      })
    )
  })

  it("graph/trace returns validation error on invalid body", async () => {
    const response = await tracePOST(
      makeRequest(
        "/api/sdk/v1/graph/trace",
        "POST",
        {
          graphDepth: 9,
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("graph/rollout GET returns workspace rollout status", async () => {
    const response = await rolloutGET(makeRequest("/api/sdk/v1/graph/rollout", "GET", undefined, VALID_API_KEY))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.rollout.mode).toBe("shadow")
    expect(body.data.shadowMetrics.totalRequests).toBe(48)
    expect(body.data.qualityGate.status).toBe("pass")
    expect(body.data.rolloutPlan.defaultBehaviorDecision).toBe("hold_lexical_default")
    expect(body.data.retrievalPolicy.defaultStrategy).toBe("lexical")
    expect(body.data.scope.tenantId).toBeNull()
    expect(mockEvaluateGraphRetrievalPolicy).toHaveBeenCalledTimes(1)
    expect(mockEvaluateGraphRetrievalPolicy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        windowHours: 24,
        allowAutopilot: undefined,
      })
    )
  })

  it("graph/rollout POST updates workspace rollout mode", async () => {
    mockEvaluateGraphRetrievalPolicy.mockResolvedValueOnce({
      rollout: {
        mode: "canary",
        updatedAt: "2026-02-12T01:00:00.000Z",
        updatedBy: "user-1",
      },
      shadowMetrics: {
        windowHours: 24,
        totalRequests: 48,
        hybridRequested: 32,
        canaryApplied: 20,
        shadowExecutions: 12,
        fallbackCount: 12,
        fallbackRate: 0.25,
        graphErrorFallbacks: 2,
        avgGraphCandidates: 3,
        avgGraphExpandedCount: 1.4,
        lastFallbackAt: "2026-02-12T00:55:00.000Z",
        lastFallbackReason: "shadow_mode",
      },
      qualityGate: {
        evaluatedAt: "2026-02-12T01:00:00.000Z",
        windowHours: 24,
        minHybridSamples: 20,
        minCanarySamplesForRelevance: 12,
        status: "pass",
        canaryBlocked: false,
        reasons: [],
        current: {
          startAt: "2026-02-11T01:00:00.000Z",
          endAt: "2026-02-12T01:00:00.000Z",
          totalRequests: 48,
          hybridRequested: 32,
          canaryApplied: 20,
          hybridFallbacks: 12,
          graphErrorFallbacks: 2,
          fallbackRate: 0.25,
          graphErrorFallbackRate: 0.0417,
          canaryWithExpansion: 18,
          expansionCoverageRate: 0.9,
          avgExpandedCount: 1.4,
          avgCandidateLift: 1.8,
        },
        previous: {
          startAt: "2026-02-10T01:00:00.000Z",
          endAt: "2026-02-11T01:00:00.000Z",
          totalRequests: 48,
          hybridRequested: 32,
          canaryApplied: 24,
          hybridFallbacks: 6,
          graphErrorFallbacks: 1,
          fallbackRate: 0.1875,
          graphErrorFallbackRate: 0.0313,
          canaryWithExpansion: 21,
          expansionCoverageRate: 0.875,
          avgExpandedCount: 1.3,
          avgCandidateLift: 1.6,
        },
      },
      plan: {
        evaluatedAt: "2026-02-12T01:00:00.000Z",
        currentMode: "canary",
        recommendedMode: "canary",
        defaultBehaviorDecision: "hold_lexical_default",
        rationale: "Hold lexical default.",
        readyForDefaultOn: false,
        blockerCodes: ["MIN_CANARY_SAMPLES_NOT_MET"],
        stages: [],
        baseline: [],
        slo: {
          minShadowExecutionsForCanary: 40,
          minShadowAverageGraphCandidates: 1,
          maxShadowGraphErrorRateForCanary: 0.05,
          minHybridSamplesForDefaultOn: 20,
          minCanarySamplesForDefaultOn: 12,
          maxFallbackRateForDefaultOn: 0.15,
          maxGraphErrorRateForDefaultOn: 0.05,
          minExpansionCoverageForDefaultOn: 0.1,
        },
        autopilot: {
          enabled: false,
          applied: false,
        },
      },
      policy: {
        defaultStrategy: "lexical",
        readyWindowStreak: 0,
        lastDecision: "hold_lexical_default",
        lastEvaluatedAt: "2026-02-12T01:00:00.000Z",
        updatedAt: "2026-02-12T01:00:00.000Z",
        updatedBy: "user-1",
      },
      autopilot: {
        enabled: true,
        applied: false,
        promoteAfterReadyWindows: 2,
      },
    })

    const response = await rolloutPOST(
      makeRequest(
        "/api/sdk/v1/graph/rollout",
        "POST",
        {
          mode: "canary",
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.rollout.mode).toBe("canary")
    expect(body.data.qualityGate.status).toBe("pass")
    expect(body.data.retrievalPolicy.defaultStrategy).toBe("lexical")
    expect(mockEvaluateGraphRetrievalPolicy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        windowHours: 24,
        allowAutopilot: false,
      })
    )
    expect(mockSetGraphRolloutConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "canary",
        updatedBy: "user-1",
      })
    )
  })

  it("graph/rollout PATCH updates workspace rollout mode", async () => {
    const response = await rolloutPATCH(
      makeRequest(
        "/api/sdk/v1/graph/rollout",
        "PATCH",
        {
          mode: "off",
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    expect(mockSetGraphRolloutConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "off",
      })
    )
  })

  it("graph/rollout POST blocks canary when quality gate fails", async () => {
    mockEvaluateGraphRolloutQuality.mockResolvedValue({
      evaluatedAt: "2026-02-12T01:00:00.000Z",
      windowHours: 24,
      minHybridSamples: 20,
      minCanarySamplesForRelevance: 12,
      status: "fail",
      canaryBlocked: true,
      reasons: [
        {
          code: "FALLBACK_RATE_ABOVE_LIMIT",
          severity: "critical",
          blocking: true,
          metric: "fallback_rate",
          currentValue: 0.22,
          previousValue: 0.05,
          threshold: 0.15,
          message: "Fallback rate 22.0% is above 15.0% threshold.",
        },
      ],
      current: {
        startAt: "2026-02-11T01:00:00.000Z",
        endAt: "2026-02-12T01:00:00.000Z",
        totalRequests: 48,
        hybridRequested: 32,
        canaryApplied: 18,
        hybridFallbacks: 7,
        graphErrorFallbacks: 2,
        fallbackRate: 0.2188,
        graphErrorFallbackRate: 0.0625,
        canaryWithExpansion: 10,
        expansionCoverageRate: 0.5556,
        avgExpandedCount: 0.8,
        avgCandidateLift: 1.1,
      },
      previous: {
        startAt: "2026-02-10T01:00:00.000Z",
        endAt: "2026-02-11T01:00:00.000Z",
        totalRequests: 48,
        hybridRequested: 32,
        canaryApplied: 20,
        hybridFallbacks: 2,
        graphErrorFallbacks: 1,
        fallbackRate: 0.0625,
        graphErrorFallbackRate: 0.0313,
        canaryWithExpansion: 18,
        expansionCoverageRate: 0.9,
        avgExpandedCount: 1.4,
        avgCandidateLift: 1.8,
      },
    })

    const response = await rolloutPOST(
      makeRequest(
        "/api/sdk/v1/graph/rollout",
        "POST",
        {
          mode: "canary",
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("CANARY_ROLLOUT_BLOCKED")
    expect(mockSetGraphRolloutConfig).not.toHaveBeenCalled()
  })

  it("graph/status OPTIONS returns CORS headers", async () => {
    const response = await statusOPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")
  })

  it("graph/trace OPTIONS returns CORS headers", async () => {
    const response = await traceOPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
  })

  it("graph/rollout OPTIONS returns CORS headers", async () => {
    const response = await rolloutOPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PATCH, OPTIONS")
  })
})
