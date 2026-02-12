import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  mockUserSelect,
  mockTenantSelect,
  mockResolveActiveMemoryContext,
  mockGetGraphStatusPayload,
  mockGetContextPayload,
  mockGetGraphRolloutConfig,
  mockSetGraphRolloutConfig,
  mockGetGraphRolloutMetricsSummary,
  mockExecute,
} = vi.hoisted(() => ({
  mockUserSelect: vi.fn(),
  mockTenantSelect: vi.fn(),
  mockResolveActiveMemoryContext: vi.fn(),
  mockGetGraphStatusPayload: vi.fn(),
  mockGetContextPayload: vi.fn(),
  mockGetGraphRolloutConfig: vi.fn(),
  mockSetGraphRolloutConfig: vi.fn(),
  mockGetGraphRolloutMetricsSummary: vi.fn(),
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
  getGraphRolloutConfig: mockGetGraphRolloutConfig,
  setGraphRolloutConfig: mockSetGraphRolloutConfig,
  getGraphRolloutMetricsSummary: mockGetGraphRolloutMetricsSummary,
}))

import { GET as statusGET, OPTIONS as statusOPTIONS, POST as statusPOST } from "../status/route"
import { OPTIONS as traceOPTIONS, POST as tracePOST } from "../trace/route"
import {
  GET as rolloutGET,
  OPTIONS as rolloutOPTIONS,
  PATCH as rolloutPATCH,
  POST as rolloutPOST,
} from "../rollout/route"

const VALID_API_KEY = `mcp_${"a".repeat(64)}`

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
    mockTenantSelect.mockReturnValue({ data: null, error: { message: "not found" } })
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
    expect(body.data.scope.tenantId).toBeNull()
    expect(mockGetGraphRolloutConfig).toHaveBeenCalledTimes(1)
    expect(mockGetGraphRolloutMetricsSummary).toHaveBeenCalledTimes(1)
  })

  it("graph/rollout POST updates workspace rollout mode", async () => {
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
