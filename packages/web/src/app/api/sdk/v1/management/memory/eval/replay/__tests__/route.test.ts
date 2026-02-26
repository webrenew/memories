import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockResolveManagementIdentity,
  mockResolveTursoForScope,
  mockRunReplayEval,
} = vi.hoisted(() => ({
  mockResolveManagementIdentity: vi.fn(),
  mockResolveTursoForScope: vi.fn(),
  mockRunReplayEval: vi.fn(),
}))

vi.mock("@/app/api/sdk/v1/management/identity", () => ({
  resolveManagementIdentity: mockResolveManagementIdentity,
}))

vi.mock("@/lib/memory-service/eval", () => ({
  runReplayEval: mockRunReplayEval,
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

import { POST } from "../route"

describe("/api/sdk/v1/management/memory/eval/replay", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockResolveManagementIdentity.mockResolvedValue({
      userId: "user-1",
      apiKeyHash: "hash_123",
      authMode: "api_key",
    })

    mockResolveTursoForScope.mockResolvedValue({ execute: vi.fn() })

    mockRunReplayEval.mockReturnValue({
      summary: {
        evaluatedAt: "2026-02-26T00:00:00.000Z",
        criteria: {
          extractionF1: 0.7,
          compactionRetention: 0.85,
          triggerAccuracy: 0.9,
          casePassRatio: 0.85,
        },
        scenarios: 1,
        extractionCases: 1,
        compactionCases: 0,
        triggerCases: 1,
        extractionF1Avg: 1,
        compactionRetentionAvg: 0,
        triggerAccuracy: 1,
        passRate: 1,
        scoreAvg: 1,
        status: "pass",
      },
      scenarios: [
        {
          id: "scenario-1",
          title: null,
          score: 1,
          status: "pass",
          extraction: {
            expectedCount: 1,
            observedCount: 1,
            truePositiveCount: 1,
            falsePositiveCount: 0,
            falseNegativeCount: 0,
            precision: 1,
            recall: 1,
            f1: 1,
            pass: true,
          },
          compaction: null,
          trigger: {
            expected: "semantic",
            actual: "semantic",
            matched: true,
            pass: true,
          },
        },
      ],
    })
  })

  it("returns replay eval result envelope", async () => {
    const response = await POST(
      new Request("https://example.com/api/sdk/v1/management/memory/eval/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "tenant-a",
          projectId: "project-a",
          scenarios: [
            {
              id: "scenario-1",
              extraction: {
                expected: ["Remember this"],
                observed: ["Remember this"],
              },
              trigger: {
                expected: "semantic",
                observed: "semantic",
              },
            },
          ],
        }),
      }) as never
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.summary.status).toBe("pass")
    expect(body.data.scope).toEqual({
      tenantId: "tenant-a",
      projectId: "project-a",
      userId: null,
    })
    expect(mockRunReplayEval).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarios: [
          expect.objectContaining({
            id: "scenario-1",
          }),
        ],
      })
    )
  })

  it("returns validation envelope for invalid payload", async () => {
    const response = await POST(
      new Request("https://example.com/api/sdk/v1/management/memory/eval/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarios: [],
        }),
      }) as never
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns internal error envelope when eval execution fails", async () => {
    mockRunReplayEval.mockImplementation(() => {
      throw new Error("eval crashed")
    })

    const response = await POST(
      new Request("https://example.com/api/sdk/v1/management/memory/eval/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarios: [
            {
              extraction: {
                expected: ["x"],
                observed: ["x"],
              },
            },
          ],
        }),
      }) as never
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("MEMORY_EVAL_REPLAY_FAILED")
  })
})
