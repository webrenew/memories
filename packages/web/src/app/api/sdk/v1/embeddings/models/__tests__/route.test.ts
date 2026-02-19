import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockResolveManagementIdentity,
  mockResolveSdkEmbeddingModelSelection,
} = vi.hoisted(() => ({
  mockResolveManagementIdentity: vi.fn(),
  mockResolveSdkEmbeddingModelSelection: vi.fn(),
}))

vi.mock("@/app/api/sdk/v1/management/identity", () => ({
  resolveManagementIdentity: mockResolveManagementIdentity,
}))

vi.mock("@/lib/sdk-embeddings/models", () => ({
  resolveSdkEmbeddingModelSelection: mockResolveSdkEmbeddingModelSelection,
}))

import { GET } from "../route"
import { ToolExecutionError, apiError } from "@/lib/memory-service/tools"

describe("/api/sdk/v1/embeddings/models", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockResolveManagementIdentity.mockResolvedValue({
      userId: "user-1",
      apiKeyHash: "hash_123",
      authMode: "api_key",
    })

    mockResolveSdkEmbeddingModelSelection.mockResolvedValue({
      selectedModelId: "openai/text-embedding-3-small",
      source: "workspace",
      workspaceDefaultModelId: "openai/text-embedding-3-small",
      projectOverrideModelId: null,
      allowlistModelIds: ["openai/text-embedding-3-small"],
      availableModels: [
        {
          id: "openai/text-embedding-3-small",
          name: "text-embedding-3-small",
          provider: "openai",
          description: null,
          contextWindow: 8192,
          pricing: { input: "0.00000002" },
          inputCostUsdPerToken: 0.00000002,
          tags: [],
        },
      ],
    })
  })

  it("returns model catalog and effective config", async () => {
    const response = await GET(
      new Request(
        "https://example.com/api/sdk/v1/embeddings/models?tenantId=tenant-a&projectId=github.com/acme/platform&embeddingModel=openai/text-embedding-3-small"
      ) as never
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.models).toHaveLength(1)
    expect(body.data.config.selectedModelId).toBe("openai/text-embedding-3-small")

    expect(mockResolveSdkEmbeddingModelSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        apiKeyHash: "hash_123",
        tenantId: "tenant-a",
        projectId: "github.com/acme/platform",
        requestedModelId: "openai/text-embedding-3-small",
      })
    )
  })

  it("returns validation error envelope when query is invalid", async () => {
    const response = await GET(
      new Request("https://example.com/api/sdk/v1/embeddings/models?tenantId=   ") as never
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns typed error when selection fails", async () => {
    mockResolveSdkEmbeddingModelSelection.mockRejectedValue(
      new ToolExecutionError(
        apiError({
          type: "validation_error",
          code: "UNSUPPORTED_EMBEDDING_MODEL",
          message: "Unsupported embedding model",
          status: 400,
          retryable: false,
        }),
        { rpcCode: -32602 }
      )
    )

    const response = await GET(
      new Request("https://example.com/api/sdk/v1/embeddings/models?embeddingModel=not-real") as never
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("UNSUPPORTED_EMBEDDING_MODEL")
  })
})
