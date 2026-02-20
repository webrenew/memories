import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockCreateAdminClient,
  mockFrom,
  mockResolveSdkProjectBillingContext,
  mockBuildSdkTenantOwnerScopeKey,
  mockGetStripe,
  mockGetStripeGrowthEmbeddingMeterEventName,
  mockGetSdkEmbeddingMarkupPercent,
  mockGetSdkEmbeddingFixedFeeUsd,
} = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
  mockResolveSdkProjectBillingContext: vi.fn(),
  mockBuildSdkTenantOwnerScopeKey: vi.fn(),
  mockGetStripe: vi.fn(),
  mockGetStripeGrowthEmbeddingMeterEventName: vi.fn(),
  mockGetSdkEmbeddingMarkupPercent: vi.fn(),
  mockGetSdkEmbeddingFixedFeeUsd: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}))

vi.mock("@/lib/sdk-project-billing", () => ({
  resolveSdkProjectBillingContext: mockResolveSdkProjectBillingContext,
  buildSdkTenantOwnerScopeKey: mockBuildSdkTenantOwnerScopeKey,
}))

vi.mock("@/lib/stripe", () => ({
  getStripe: mockGetStripe,
}))

vi.mock("@/lib/env", () => ({
  getStripeGrowthEmbeddingMeterEventName: mockGetStripeGrowthEmbeddingMeterEventName,
  getSdkEmbeddingMarkupPercent: mockGetSdkEmbeddingMarkupPercent,
  getSdkEmbeddingFixedFeeUsd: mockGetSdkEmbeddingFixedFeeUsd,
}))

import {
  computeCustomerEmbeddingCostUsd,
  estimateEmbeddingInputTokens,
  estimateGatewayCostUsd,
  listSdkEmbeddingUsage,
  recordSdkEmbeddingMeterEvent,
} from "./sdk-embedding-billing"

describe("sdk-embedding-billing", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCreateAdminClient.mockReturnValue({
      from: mockFrom,
    })

    mockResolveSdkProjectBillingContext.mockResolvedValue({
      plan: "growth",
      ownerType: "user",
      ownerUserId: "user-1",
      orgId: null,
      ownerScopeKey: "user:user-1",
      stripeCustomerId: "cus_123",
    })

    mockBuildSdkTenantOwnerScopeKey.mockImplementation(
      (input: { ownerType: "user" | "organization"; ownerUserId: string; orgId: string | null }) =>
        input.ownerType === "organization" && input.orgId ? `org:${input.orgId}` : `user:${input.ownerUserId}`
    )

    mockGetStripeGrowthEmbeddingMeterEventName.mockReturnValue("memories_growth_embedding_cost_micros")
    mockGetSdkEmbeddingMarkupPercent.mockReturnValue(0.15)
    mockGetSdkEmbeddingFixedFeeUsd.mockReturnValue(0)

    mockGetStripe.mockReturnValue({
      billing: {
        meterEvents: {
          create: vi.fn().mockResolvedValue({ id: "meter_evt_1" }),
        },
      },
    })
  })

  it("computes customer cost with configured markup and fixed fee", () => {
    mockGetSdkEmbeddingMarkupPercent.mockReturnValue(0.2)
    mockGetSdkEmbeddingFixedFeeUsd.mockReturnValue(0.001)

    expect(computeCustomerEmbeddingCostUsd(0.01)).toBe(0.013)
  })

  it("estimates tokens and gateway cost", () => {
    expect(estimateEmbeddingInputTokens("hello world")).toBeGreaterThan(0)
    expect(
      estimateGatewayCostUsd({
        inputTokens: 500,
        modelInputCostUsdPerToken: 0.00000002,
      })
    ).toBe(0.00001)
  })

  it("records embedding meter event and reports Stripe meter event", async () => {
    const insertSingle = vi.fn().mockResolvedValue({ data: { id: "row_1" }, error: null })
    const selectForInsert = vi.fn().mockReturnValue({ single: insertSingle })
    const insert = vi.fn().mockReturnValue({ select: selectForInsert })

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockFrom.mockImplementation((table: string) => {
      if (table === "sdk_embedding_meter_events") {
        return {
          insert,
          update,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    await recordSdkEmbeddingMeterEvent({
      ownerUserId: "user-1",
      apiKeyHash: "hash_123",
      tenantId: "tenant-a",
      projectId: "github.com/acme/platform",
      userId: "end-user-1",
      requestId: "req_1",
      modelId: "openai/text-embedding-3-small",
      provider: "openai",
      inputTokens: 500,
      modelInputCostUsdPerToken: 0.00000002,
      estimatedCost: true,
      metadata: {
        endpoint: "/api/sdk/v1/memories/add",
        embeddingVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
        nested: {
          queryEmbedding: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      },
    })

    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_scope_key: "user:user-1",
        model_id: "openai/text-embedding-3-small",
        input_tokens: 500,
        metadata: {
          endpoint: "/api/sdk/v1/memories/add",
          embeddingVector: "[redacted]",
          nested: {
            queryEmbedding: "[redacted]",
          },
        },
      })
    )

    const stripe = mockGetStripe.mock.results[0]?.value
    expect(stripe.billing.meterEvents.create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("aggregates usage by tenant/project/model", async () => {
    const eqUsageMonth = vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({
        data: [
          {
            usage_month: "2026-02-01",
            tenant_id: "tenant-a",
            project_id: "project-a",
            model_id: "openai/text-embedding-3-small",
            provider: "openai",
            input_tokens: 100,
            gateway_cost_usd: "0.00000200",
            market_cost_usd: "0.00000200",
            customer_cost_usd: "0.00000230",
            estimated_cost: true,
            created_at: "2026-02-19T00:00:00.000Z",
          },
          {
            usage_month: "2026-02-01",
            tenant_id: "tenant-a",
            project_id: "project-a",
            model_id: "openai/text-embedding-3-small",
            provider: "openai",
            input_tokens: 300,
            gateway_cost_usd: "0.00000600",
            market_cost_usd: "0.00000600",
            customer_cost_usd: "0.00000690",
            estimated_cost: false,
            created_at: "2026-02-19T00:00:01.000Z",
          },
        ],
        error: null,
      }),
    })

    const eqOwnerScope = vi.fn().mockReturnValue({
      eq: eqUsageMonth,
    })

    const select = vi.fn().mockReturnValue({
      eq: eqOwnerScope,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === "sdk_embedding_meter_events") {
        return {
          select,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const usage = await listSdkEmbeddingUsage({
      ownerUserId: "user-1",
      usageMonth: "2026-02-01",
    })

    expect(usage.summary.requestCount).toBe(2)
    expect(usage.summary.estimatedRequestCount).toBe(1)
    expect(usage.summary.inputTokens).toBe(400)
    expect(usage.breakdown).toHaveLength(1)
    expect(usage.breakdown[0]).toEqual(
      expect.objectContaining({
        tenantId: "tenant-a",
        projectId: "project-a",
        modelId: "openai/text-embedding-3-small",
        requestCount: 2,
      })
    )
  })
})
