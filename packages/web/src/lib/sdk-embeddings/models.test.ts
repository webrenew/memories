import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockCreateAdminClient,
  mockAdminFrom,
  mockResolveSdkProjectBillingContext,
  mockGetAiGatewayApiKey,
  mockGetAiGatewayBaseUrl,
  mockGetSdkDefaultEmbeddingModelId,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockResolveSdkProjectBillingContext: vi.fn(),
  mockGetAiGatewayApiKey: vi.fn(),
  mockGetAiGatewayBaseUrl: vi.fn(),
  mockGetSdkDefaultEmbeddingModelId: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}))

vi.mock("@/lib/sdk-project-billing", () => ({
  resolveSdkProjectBillingContext: mockResolveSdkProjectBillingContext,
  buildSdkTenantOwnerScopeKey: vi.fn(
    (input: { ownerType: "user" | "organization"; ownerUserId: string; orgId: string | null }) =>
      input.ownerType === "organization" && input.orgId ? `org:${input.orgId}` : `user:${input.ownerUserId}`
  ),
}))

vi.mock("@/lib/env", () => ({
  getAiGatewayApiKey: mockGetAiGatewayApiKey,
  getAiGatewayBaseUrl: mockGetAiGatewayBaseUrl,
  getSdkDefaultEmbeddingModelId: mockGetSdkDefaultEmbeddingModelId,
}))

import { resolveSdkEmbeddingModelSelection } from "./models"

function createQueryResult(payload: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn((_column: string, _value: unknown) => query),
    maybeSingle: vi.fn().mockResolvedValue(payload),
  }

  return {
    select: vi.fn().mockReturnValue(query),
  }
}

describe("resolveSdkEmbeddingModelSelection", () => {
  let userRow: { embedding_model: string | null } | null
  let tenantRow: { metadata: Record<string, unknown> | null } | null

  beforeEach(() => {
    vi.clearAllMocks()

    userRow = { embedding_model: "openai/text-embedding-3-small" }
    tenantRow = {
      metadata: {
        embedding_model_by_project: {
          "github.com/acme/platform": "openai/text-embedding-3-large",
        },
        embedding_model_allowlist: [
          "openai/text-embedding-3-small",
          "openai/text-embedding-3-large",
        ],
      },
    }

    mockGetAiGatewayApiKey.mockReturnValue("gateway_key")
    mockGetAiGatewayBaseUrl.mockReturnValue("https://ai-gateway.vercel.sh")
    mockGetSdkDefaultEmbeddingModelId.mockReturnValue("openai/text-embedding-3-small")

    mockResolveSdkProjectBillingContext.mockResolvedValue({
      ownerScopeKey: "user:user-1",
    })

    mockCreateAdminClient.mockReturnValue({
      from: mockAdminFrom,
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return createQueryResult({ data: userRow, error: null })
      }

      if (table === "sdk_tenant_databases") {
        return createQueryResult({ data: tenantRow, error: null })
      }

      return createQueryResult({ data: null, error: null })
    })

    const gatewayResponse = {
      object: "list",
      data: [
        {
          id: "openai/text-embedding-3-small",
          type: "embedding",
          owned_by: "openai",
          name: "text-embedding-3-small",
          context_window: 8192,
          pricing: { input: "0.00000002" },
          tags: ["fast"],
        },
        {
          id: "openai/text-embedding-3-large",
          type: "embedding",
          owned_by: "openai",
          name: "text-embedding-3-large",
          context_window: 8192,
          pricing: { input: "0.00000013" },
          tags: ["quality"],
        },
      ],
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(gatewayResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    )
  })

  it("uses request override when provided", async () => {
    const result = await resolveSdkEmbeddingModelSelection({
      ownerUserId: "user-1",
      apiKeyHash: "hash_1",
      tenantId: "tenant-1",
      projectId: "github.com/acme/platform",
      requestedModelId: "openai/text-embedding-3-large",
    })

    expect(result.selectedModelId).toBe("openai/text-embedding-3-large")
    expect(result.source).toBe("request")
  })

  it("uses project override when request override is absent", async () => {
    const result = await resolveSdkEmbeddingModelSelection({
      ownerUserId: "user-1",
      apiKeyHash: "hash_1",
      tenantId: "tenant-1",
      projectId: "github.com/acme/platform",
    })

    expect(result.selectedModelId).toBe("openai/text-embedding-3-large")
    expect(result.source).toBe("project")
  })

  it("uses workspace default when no request or project override applies", async () => {
    const result = await resolveSdkEmbeddingModelSelection({
      ownerUserId: "user-1",
      apiKeyHash: "hash_1",
      tenantId: "tenant-1",
    })

    expect(result.selectedModelId).toBe("openai/text-embedding-3-small")
    expect(result.source).toBe("workspace")
  })

  it("falls back to system default when workspace default is unavailable", async () => {
    userRow = { embedding_model: "all-MiniLM-L6-v2" }
    tenantRow = { metadata: null }
    mockGetSdkDefaultEmbeddingModelId.mockReturnValue("openai/text-embedding-3-large")

    const result = await resolveSdkEmbeddingModelSelection({
      ownerUserId: "user-1",
      apiKeyHash: "hash_1",
      tenantId: null,
    })

    expect(result.selectedModelId).toBe("openai/text-embedding-3-large")
    expect(result.source).toBe("system_default")
  })

  it("rejects unsupported requested models", async () => {
    await expect(
      resolveSdkEmbeddingModelSelection({
        ownerUserId: "user-1",
        apiKeyHash: "hash_1",
        tenantId: "tenant-1",
        requestedModelId: "not-a-real-model",
      })
    ).rejects.toMatchObject({
      detail: expect.objectContaining({
        code: "UNSUPPORTED_EMBEDDING_MODEL",
        type: "validation_error",
      }),
    })
  })

  it("rejects requested models outside allowlist", async () => {
    tenantRow = {
      metadata: {
        embedding_model_allowlist: ["openai/text-embedding-3-small"],
      },
    }

    await expect(
      resolveSdkEmbeddingModelSelection({
        ownerUserId: "user-1",
        apiKeyHash: "hash_1",
        tenantId: "tenant-1",
        requestedModelId: "openai/text-embedding-3-large",
      })
    ).rejects.toMatchObject({
      detail: expect.objectContaining({
        code: "EMBEDDING_MODEL_NOT_ALLOWED",
        type: "validation_error",
      }),
    })
  })
})
