import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  mockResolveManagementIdentity,
  mockResolveTursoForScope,
  mockEnsureMemoryUserIdSchema,
  mockGetEmbeddingBackfillStatus,
  mockRunEmbeddingBackfillBatch,
  mockSetEmbeddingBackfillPaused,
} = vi.hoisted(() => ({
  mockResolveManagementIdentity: vi.fn(),
  mockResolveTursoForScope: vi.fn(),
  mockEnsureMemoryUserIdSchema: vi.fn(),
  mockGetEmbeddingBackfillStatus: vi.fn(),
  mockRunEmbeddingBackfillBatch: vi.fn(),
  mockSetEmbeddingBackfillPaused: vi.fn(),
}))

vi.mock("@/app/api/sdk/v1/management/identity", () => ({
  resolveManagementIdentity: mockResolveManagementIdentity,
}))

vi.mock("@/lib/memory-service/scope", () => ({
  ensureMemoryUserIdSchema: mockEnsureMemoryUserIdSchema,
}))

vi.mock("@/lib/sdk-embeddings/backfill", () => ({
  getEmbeddingBackfillStatus: mockGetEmbeddingBackfillStatus,
  runEmbeddingBackfillBatch: mockRunEmbeddingBackfillBatch,
  setEmbeddingBackfillPaused: mockSetEmbeddingBackfillPaused,
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

import { GET, POST } from "../route"

describe("/api/sdk/v1/management/embeddings/backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockResolveManagementIdentity.mockResolvedValue({
      userId: "user-1",
      apiKeyHash: "hash-1",
      authMode: "api_key",
    })

    mockResolveTursoForScope.mockResolvedValue({ execute: vi.fn() })
    mockEnsureMemoryUserIdSchema.mockResolvedValue(undefined)

    mockGetEmbeddingBackfillStatus.mockResolvedValue({
      scopeKey: "openai/text-embedding-3-small|*|*",
      modelId: "openai/text-embedding-3-small",
      projectId: null,
      userId: null,
      status: "idle",
      checkpointCreatedAt: null,
      checkpointMemoryId: null,
      scannedCount: 0,
      enqueuedCount: 0,
      estimatedTotal: 0,
      estimatedRemaining: 0,
      estimatedCompletionSeconds: 0,
      batchLimit: 100,
      throttleMs: 25,
      startedAt: null,
      lastRunAt: null,
      completedAt: null,
      updatedAt: null,
      lastError: null,
    })

    mockRunEmbeddingBackfillBatch.mockResolvedValue({
      status: {
        scopeKey: "openai/text-embedding-3-small|*|*",
        modelId: "openai/text-embedding-3-small",
        projectId: null,
        userId: null,
        status: "running",
        checkpointCreatedAt: "2026-02-20T00:00:00.000Z",
        checkpointMemoryId: "mem-1",
        scannedCount: 1,
        enqueuedCount: 1,
        estimatedTotal: 10,
        estimatedRemaining: 9,
        estimatedCompletionSeconds: 90,
        batchLimit: 1,
        throttleMs: 0,
        startedAt: "2026-02-20T00:00:00.000Z",
        lastRunAt: "2026-02-20T00:00:00.000Z",
        completedAt: null,
        updatedAt: "2026-02-20T00:00:00.000Z",
        lastError: null,
      },
      batch: {
        scanned: 1,
        enqueued: 1,
        durationMs: 120,
      },
    })

    mockSetEmbeddingBackfillPaused.mockResolvedValue({
      scopeKey: "openai/text-embedding-3-small|*|*",
      modelId: "openai/text-embedding-3-small",
      projectId: null,
      userId: null,
      status: "paused",
      checkpointCreatedAt: null,
      checkpointMemoryId: null,
      scannedCount: 0,
      enqueuedCount: 0,
      estimatedTotal: 0,
      estimatedRemaining: 0,
      estimatedCompletionSeconds: 0,
      batchLimit: 100,
      throttleMs: 25,
      startedAt: null,
      lastRunAt: null,
      completedAt: null,
      updatedAt: "2026-02-20T00:00:00.000Z",
      lastError: null,
    })
  })

  it("returns backfill status on GET", async () => {
    const response = await GET(
      new NextRequest("https://example.com/api/sdk/v1/management/embeddings/backfill?modelId=openai/text-embedding-3-small")
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.status).toBe("idle")
    expect(mockGetEmbeddingBackfillStatus).toHaveBeenCalled()
  })

  it("runs a backfill batch on POST action=run", async () => {
    const response = await POST(
      new NextRequest("https://example.com/api/sdk/v1/management/embeddings/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "run",
          modelId: "openai/text-embedding-3-small",
          batchLimit: 1,
          throttleMs: 0,
        }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.action).toBe("run")
    expect(body.data.batch.scanned).toBe(1)
    expect(mockRunEmbeddingBackfillBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "openai/text-embedding-3-small",
        batchLimit: 1,
        throttleMs: 0,
      })
    )
  })

  it("pauses backfill on POST action=pause", async () => {
    const response = await POST(
      new NextRequest("https://example.com/api/sdk/v1/management/embeddings/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pause",
          modelId: "openai/text-embedding-3-small",
        }),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.action).toBe("pause")
    expect(body.data.status.status).toBe("paused")
    expect(mockSetEmbeddingBackfillPaused).toHaveBeenCalledWith(
      expect.objectContaining({
        paused: true,
      })
    )
  })

  it("returns validation envelope for invalid POST payload", async () => {
    const response = await POST(
      new NextRequest("https://example.com/api/sdk/v1/management/embeddings/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "run",
          batchLimit: 0,
        }),
      })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })
})

