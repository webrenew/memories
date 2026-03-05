import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockConstructEvent,
  mockListLineItems,
  mockRetrieveSubscription,
  mockRpc,
  mockUsersUpdate,
  mockUsersEq,
  mockOrganizationsUpdate,
  mockOrganizationsEq,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockListLineItems: vi.fn(),
  mockRetrieveSubscription: vi.fn(),
  mockRpc: vi.fn(),
  mockUsersUpdate: vi.fn(),
  mockUsersEq: vi.fn(),
  mockOrganizationsUpdate: vi.fn(),
  mockOrganizationsEq: vi.fn(),
}))

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    checkout: { sessions: { listLineItems: mockListLineItems } },
    subscriptions: { retrieve: mockRetrieveSubscription },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: mockRpc,
    from: vi.fn((table: string) => {
      if (table === "users") {
        return { update: mockUsersUpdate }
      }
      if (table === "organizations") {
        return { update: mockOrganizationsUpdate }
      }
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }
    }),
  })),
}))

import { POST } from "../route"

function makeWebhookRequest(body: string, signature = "sig_test"): Request {
  return new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    body,
    headers: {
      "stripe-signature": signature,
      "content-type": "application/json",
    },
  })
}

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ data: "claimed", error: null })
    mockUsersEq.mockResolvedValue({ error: null })
    mockOrganizationsEq.mockResolvedValue({ error: null })
    mockUsersUpdate.mockReturnValue({ eq: mockUsersEq })
    mockOrganizationsUpdate.mockReturnValue({ eq: mockOrganizationsEq })
    mockRetrieveSubscription.mockResolvedValue({
      id: "sub_team_123",
      metadata: { type: "team_seats", org_id: "org-1" },
    })
  })

  it("returns 400 when stripe-signature is missing", async () => {
    const request = new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it("returns 400 on invalid signature", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature")
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(400)
  })

  it("updates organization billing on org checkout completion", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_org_checkout_1",
      created: 1_709_000_001,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_org_123",
          customer: "cus_org_123",
          subscription: "sub_org_123",
          metadata: {
            workspace_owner_type: "organization",
            workspace_org_id: "org-1",
            supabase_user_id: "user-1",
          },
        },
      },
    })
    mockListLineItems.mockResolvedValue({
      data: [{ price: { id: "price_team_monthly" } }],
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockOrganizationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_customer_id: "cus_org_123",
        stripe_subscription_id: "sub_org_123",
        subscription_status: "active",
        plan: "team",
      })
    )
    expect(mockOrganizationsEq).toHaveBeenCalledWith("id", "org-1")
    expect(mockUsersUpdate).not.toHaveBeenCalled()
    expect(mockRpc).toHaveBeenCalledWith("claim_stripe_webhook_event", {
      p_event_id: "evt_org_checkout_1",
      p_event_type: "checkout.session.completed",
      p_event_created_at: new Date(1_709_000_001 * 1000).toISOString(),
      p_scope_type: "customer",
      p_scope_key: "cus_org_123",
    })
  })

  it("updates user plan on personal checkout completion", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_user_checkout_1",
      created: 1_709_000_002,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_user_123",
          customer: "cus_user_123",
          metadata: {
            supabase_user_id: "user-1",
            workspace_owner_type: "user",
          },
        },
      },
    })
    mockListLineItems.mockResolvedValue({
      data: [{ price: { id: "price_individual_monthly" } }],
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockUsersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "individual",
        stripe_customer_id: "cus_user_123",
      })
    )
    expect(mockUsersEq).toHaveBeenCalledWith("id", "user-1")
  })

  it("maps growth checkout completion to growth plan", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_user_growth_1",
      created: 1_709_000_003,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_user_growth",
          customer: "cus_user_growth",
          metadata: {
            supabase_user_id: "user-1",
            workspace_owner_type: "user",
            billing_plan: "growth",
          },
        },
      },
    })
    mockListLineItems.mockResolvedValue({
      data: [{ price: { id: "price_growth_monthly" } }],
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockUsersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "growth",
        stripe_customer_id: "cus_user_growth",
      })
    )
  })

  it("updates team subscription status with org billing identifiers", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_sub_update_1",
      created: 1_709_000_004,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_team_123",
          customer: "cus_org_123",
          status: "past_due",
          metadata: { type: "team_seats", org_id: "org-1" },
          items: { data: [{ price: { id: "price_team_monthly" } }] },
        },
      },
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockOrganizationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_status: "past_due",
        stripe_customer_id: "cus_org_123",
        stripe_subscription_id: "sub_team_123",
        plan: "past_due",
      })
    )
    expect(mockOrganizationsEq).toHaveBeenCalledWith("id", "org-1")
  })

  it("handles customer.subscription.created for org subscriptions", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_sub_created_1",
      created: 1_709_000_009,
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_team_created_123",
          customer: "cus_org_123",
          status: "active",
          metadata: { type: "team_seats", org_id: "org-1" },
          items: { data: [{ price: { id: "price_team_monthly" } }] },
        },
      },
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockOrganizationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_status: "active",
        stripe_customer_id: "cus_org_123",
        stripe_subscription_id: "sub_team_created_123",
        plan: "team",
      })
    )
    expect(mockOrganizationsEq).toHaveBeenCalledWith("id", "org-1")
  })

  it("supports expanded Stripe customer payloads on subscription updates", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_sub_update_expanded_customer_1",
      created: 1_709_000_010,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_team_123",
          customer: { id: "cus_org_123" },
          status: "past_due",
          metadata: { type: "team_seats", org_id: "org-1" },
          items: { data: [{ price: { id: "price_team_monthly" } }] },
        },
      },
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockOrganizationsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_status: "past_due",
        stripe_customer_id: "cus_org_123",
      })
    )
  })

  it("returns 200 for unhandled event type", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_unhandled_1",
      created: 1_709_000_005,
      type: "payment_intent.created",
      data: { object: {} },
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("returns 200 and skips writes when event is duplicate", async () => {
    mockRpc.mockResolvedValue({ data: "duplicate", error: null })
    mockConstructEvent.mockReturnValue({
      id: "evt_dup_1",
      created: 1_709_000_006,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_org_dup",
          customer: "cus_org_123",
          subscription: "sub_org_123",
          metadata: {
            workspace_owner_type: "organization",
            workspace_org_id: "org-1",
          },
        },
      },
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockListLineItems).not.toHaveBeenCalled()
    expect(mockUsersUpdate).not.toHaveBeenCalled()
    expect(mockOrganizationsUpdate).not.toHaveBeenCalled()
  })

  it("returns 200 and skips writes when event is stale", async () => {
    mockRpc.mockResolvedValue({ data: "stale", error: null })
    mockConstructEvent.mockReturnValue({
      id: "evt_stale_1",
      created: 1_709_000_007,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_team_123",
          customer: "cus_org_123",
          status: "past_due",
          metadata: { type: "team_seats", org_id: "org-1" },
          items: { data: [{ price: { id: "price_team_monthly" } }] },
        },
      },
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(200)
    expect(mockOrganizationsUpdate).not.toHaveBeenCalled()
    expect(mockUsersUpdate).not.toHaveBeenCalled()
  })

  it("returns 503 when webhook guard migration is missing", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'function public.claim_stripe_webhook_event does not exist' },
    })
    mockConstructEvent.mockReturnValue({
      id: "evt_missing_guard_1",
      created: 1_709_000_008,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_team_123",
          customer: "cus_org_123",
          status: "active",
          metadata: { type: "team_seats", org_id: "org-1" },
          items: { data: [{ price: { id: "price_team_monthly" } }] },
        },
      },
    })

    const response = await POST(makeWebhookRequest("{}"))
    expect(response.status).toBe(503)
    expect(mockOrganizationsUpdate).not.toHaveBeenCalled()
    expect(mockUsersUpdate).not.toHaveBeenCalled()
  })
})
