import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockResolveManagementIdentity,
  mockResolveTursoForScope,
  mockEnsureMemoryUserIdSchema,
  mockGetEmbeddingObservabilitySnapshot,
} = vi.hoisted(() => ({
  mockResolveManagementIdentity: vi.fn(),
  mockResolveTursoForScope: vi.fn(),
  mockEnsureMemoryUserIdSchema: vi.fn(),
  mockGetEmbeddingObservabilitySnapshot: vi.fn(),
}))

vi.mock("@/app/api/sdk/v1/management/identity", () => ({
  resolveManagementIdentity: mockResolveManagementIdentity,
}))

vi.mock("@/lib/memory-service/scope", () => ({
  ensureMemoryUserIdSchema: mockEnsureMemoryUserIdSchema,
}))

vi.mock("@/lib/sdk-embeddings/observability", () => ({
  getEmbeddingObservabilitySnapshot: mockGetEmbeddingObservabilitySnapshot,
}))

vi.mock("@/lib/sdk-api/runtime", () => ({
  resolveTursoForScope: mockResolveTursoForScope,
  successResponse: (endpoint: string, requestId: string, data: unknown, status = 200) =>
    new Response(
      JSON.stringify({
        ok: true,
        data,
        error: null,
        meta: { endpoint, requestId, version: "test", timestamp: "2026-02-20T00:00:00.000Z" },
      }),
      { status, headers: { "content-type": "application/json" } }
    ),
  errorResponse: (endpoint: string, requestId: string, detail: unknown) =>
    new Response(
      JSON.stringify({
        ok: false,
        data: null,
        error: detail,
        meta: { endpoint, requestId, version: "test", timestamp: "2026-02-20T00:00:00.000Z" },
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
        meta: { endpoint, requestId, version: "test", timestamp: "2026-02-20T00:00:00.000Z" },
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    ),
}))

import { GET } from "../route"

describe("/api/sdk/v1/management/embeddings/observability", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockResolveManagementIdentity.mockResolvedValue({
      userId: "user-1",
      apiKeyHash: "hash_123",
      authMode: "api_key",
    })

    mockResolveTursoForScope.mockResolvedValue({ execute: vi.fn() })
    mockEnsureMemoryUserIdSchema.mockResolvedValue(undefined)
    mockGetEmbeddingObservabilitySnapshot.mockResolvedValue({
      sampledAt: "2026-02-20T00:00:00.000Z",
      windowHours: 24,
      scope: {
        tenantId: "tenant-a",
        projectId: "project-a",
        userId: null,
        modelId: "openai/text-embedding-3-small",
      },
      slos: {},
      queue: {
        queuedCount: 3,
        processingCount: 1,
        deadLetterCount: 0,
        staleProcessingCount: 0,
        oldestDueAt: "2026-02-19T23:58:00.000Z",
        oldestClaimedAt: null,
        queueLagMs: 120000,
      },
      worker: {
        attempts: 10,
        successCount: 9,
        retryCount: 1,
        deadLetterCount: 0,
        skippedCount: 0,
        failureRate: 0,
        retryRate: 0.1,
        avgDurationMs: 280,
        p50DurationMs: 240,
        p95DurationMs: 600,
        durationSampleCount: 10,
        topErrorCodes: [],
      },
      backfill: {
        runs: 3,
        scannedCount: 320,
        enqueuedCount: 320,
        errorRuns: 0,
        avgDurationMs: 150,
        lastRunAt: "2026-02-20T00:00:00.000Z",
        activeScopes: 0,
        runningScopes: 0,
        pausedScopes: 0,
      },
      retrieval: {
        totalRequests: 40,
        hybridRequested: 20,
        fallbackCount: 1,
        fallbackRate: 0.025,
        avgLatencyMs: 300,
        p50LatencyMs: 220,
        p95LatencyMs: 810,
        latencySampleCount: 40,
        lastFallbackAt: "2026-02-20T00:00:00.000Z",
        lastFallbackReason: "shadow_mode",
      },
      cost: {
        usageMonth: "2026-02-01",
        requestCount: 320,
        inputTokens: 64_000,
        gatewayCostUsd: 0.128,
        marketCostUsd: 0.12,
        customerCostUsd: 0.138,
        customerCostPerRequestUsd: 0.00043125,
      },
      alarms: [],
      health: "healthy",
    })
  })

  it("returns embedding observability snapshot", async () => {
    const response = await GET(
      new Request(
        "https://example.com/api/sdk/v1/management/embeddings/observability?tenantId=tenant-a&projectId=project-a&modelId=openai/text-embedding-3-small&windowHours=24"
      ) as never
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.health).toBe("healthy")
    expect(body.data.queue.queuedCount).toBe(3)
    expect(mockGetEmbeddingObservabilitySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        tenantId: "tenant-a",
        projectId: "project-a",
        modelId: "openai/text-embedding-3-small",
        windowHours: 24,
      })
    )
  })

  it("returns validation envelope for invalid query", async () => {
    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/embeddings/observability?windowHours=0") as never
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns internal error envelope when lookup fails", async () => {
    mockGetEmbeddingObservabilitySnapshot.mockRejectedValue(new Error("db down"))

    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/embeddings/observability") as never
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("EMBEDDING_OBSERVABILITY_LOOKUP_FAILED")
  })
})
