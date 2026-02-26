import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockResolveManagementIdentity,
  mockResolveTursoForScope,
  mockEnsureMemoryUserIdSchema,
  mockGetMemoryLifecycleObservabilitySnapshot,
} = vi.hoisted(() => ({
  mockResolveManagementIdentity: vi.fn(),
  mockResolveTursoForScope: vi.fn(),
  mockEnsureMemoryUserIdSchema: vi.fn(),
  mockGetMemoryLifecycleObservabilitySnapshot: vi.fn(),
}))

vi.mock("@/app/api/sdk/v1/management/identity", () => ({
  resolveManagementIdentity: mockResolveManagementIdentity,
}))

vi.mock("@/lib/memory-service/scope", () => ({
  ensureMemoryUserIdSchema: mockEnsureMemoryUserIdSchema,
}))

vi.mock("@/lib/memory-service/observability", () => ({
  getMemoryLifecycleObservabilitySnapshot: mockGetMemoryLifecycleObservabilitySnapshot,
}))

vi.mock("@/lib/sdk-api/runtime", () => ({
  resolveTursoForScope: mockResolveTursoForScope,
  successResponse: (endpoint: string, requestId: string, data: unknown, status = 200) =>
    new Response(
      JSON.stringify({
        ok: true,
        data,
        error: null,
        meta: { endpoint, requestId, version: "test", timestamp: "2026-02-26T00:00:00.000Z" },
      }),
      { status, headers: { "content-type": "application/json" } }
    ),
  errorResponse: (endpoint: string, requestId: string, detail: unknown) =>
    new Response(
      JSON.stringify({
        ok: false,
        data: null,
        error: detail,
        meta: { endpoint, requestId, version: "test", timestamp: "2026-02-26T00:00:00.000Z" },
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    ),
  invalidRequestResponse: (endpoint: string, requestId: string, message = "Invalid request payload") =>
    new Response(
      JSON.stringify({
        ok: false,
        data: null,
        error: {
          type: "validation_error",
          code: "INVALID_REQUEST",
          message,
          status: 400,
          retryable: false,
        },
        meta: { endpoint, requestId, version: "test", timestamp: "2026-02-26T00:00:00.000Z" },
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    ),
}))

import { GET } from "../route"

describe("/api/sdk/v1/management/memory/observability", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockResolveManagementIdentity.mockResolvedValue({
      userId: "user-1",
      apiKeyHash: "hash_123",
      authMode: "api_key",
    })

    mockResolveTursoForScope.mockResolvedValue({ execute: vi.fn() })
    mockEnsureMemoryUserIdSchema.mockResolvedValue(undefined)
    mockGetMemoryLifecycleObservabilitySnapshot.mockResolvedValue({
      sampledAt: "2026-02-26T00:00:00.000Z",
      windowHours: 24,
      scope: {
        tenantId: "tenant-a",
        projectId: "project-a",
        userId: null,
      },
      lifecycle: {
        createdCount: 10,
        updatedCount: 18,
        deletedCount: 2,
        activeCount: 48,
        totalCount: 50,
      },
      compaction: {
        totalEvents: 12,
        byTrigger: { count: 8, time: 2, semantic: 2 },
        compactedSessions: 5,
        checkpointMissingCount: 1,
        checkpointCoverage: 0.9167,
      },
      consolidation: {
        runCount: 4,
        mergedCount: 7,
        supersededCount: 9,
        conflictedCount: 2,
        conflictRate: 0.5,
        lastRunAt: "2026-02-26T00:00:00.000Z",
      },
      contradictions: {
        totalCount: 14,
        windowCount: 6,
        trend: "up",
        daily: [{ date: "2026-02-25", count: 3 }],
      },
      alarms: [],
      health: "healthy",
    })
  })

  it("returns memory observability snapshot", async () => {
    const response = await GET(
      new Request(
        "https://example.com/api/sdk/v1/management/memory/observability?tenantId=tenant-a&projectId=project-a&windowHours=24"
      ) as never
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.health).toBe("healthy")
    expect(body.data.compaction.totalEvents).toBe(12)
    expect(mockGetMemoryLifecycleObservabilitySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        projectId: "project-a",
        windowHours: 24,
      })
    )
  })

  it("returns validation envelope for invalid query", async () => {
    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/memory/observability?windowHours=0") as never
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns internal error envelope when lookup fails", async () => {
    mockGetMemoryLifecycleObservabilitySnapshot.mockRejectedValue(new Error("db down"))

    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/memory/observability") as never
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("MEMORY_OBSERVABILITY_LOOKUP_FAILED")
  })
})
