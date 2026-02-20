import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockResolveManagementIdentity,
  mockListSdkEmbeddingUsage,
} = vi.hoisted(() => ({
  mockResolveManagementIdentity: vi.fn(),
  mockListSdkEmbeddingUsage: vi.fn(),
}))

vi.mock("@/app/api/sdk/v1/management/identity", () => ({
  resolveManagementIdentity: mockResolveManagementIdentity,
}))

vi.mock("@/lib/sdk-embedding-billing", () => ({
  listSdkEmbeddingUsage: mockListSdkEmbeddingUsage,
}))

import { GET } from "../route"

describe("/api/sdk/v1/management/embeddings/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockResolveManagementIdentity.mockResolvedValue({
      userId: "user-1",
      apiKeyHash: "hash_123",
      authMode: "api_key",
    })

    mockListSdkEmbeddingUsage.mockResolvedValue({
      usageMonth: "2026-02-01",
      summary: {
        usageMonth: "2026-02-01",
        requestCount: 2,
        estimatedRequestCount: 1,
        tokenizerRequestCount: 1,
        fallbackRequestCount: 1,
        inputTokensDelta: 24,
        inputTokens: 400,
        gatewayCostUsd: 0.000008,
        marketCostUsd: 0.000008,
        customerCostUsd: 0.0000092,
      },
      breakdown: [
        {
          usageMonth: "2026-02-01",
          tenantId: "tenant-a",
          projectId: "project-a",
          modelId: "openai/text-embedding-3-small",
          provider: "openai",
          requestCount: 2,
          estimatedRequestCount: 1,
          tokenizerRequestCount: 1,
          fallbackRequestCount: 1,
          inputTokensDelta: 24,
          inputTokens: 400,
          gatewayCostUsd: 0.000008,
          marketCostUsd: 0.000008,
          customerCostUsd: 0.0000092,
        },
      ],
    })
  })

  it("returns usage summary and breakdown", async () => {
    const response = await GET(
      new Request(
        "https://example.com/api/sdk/v1/management/embeddings/usage?usageMonth=2026-02-01&tenantId=tenant-a&projectId=project-a&limit=100"
      ) as never
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.summary.requestCount).toBe(2)
    expect(body.data.breakdown).toHaveLength(1)

    expect(mockListSdkEmbeddingUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        usageMonth: "2026-02-01",
        tenantId: "tenant-a",
        projectId: "project-a",
        limit: 100,
      })
    )
  })

  it("returns validation envelope for invalid query", async () => {
    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/embeddings/usage?usageMonth=2026-02") as never
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns internal error envelope when usage lookup fails", async () => {
    mockListSdkEmbeddingUsage.mockRejectedValue(new Error("db down"))

    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/embeddings/usage") as never
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("EMBEDDING_USAGE_LOOKUP_FAILED")
  })
})
