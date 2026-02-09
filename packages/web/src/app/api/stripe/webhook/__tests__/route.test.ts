import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Stripe
const mockConstructEvent = vi.fn()
const mockListLineItems = vi.fn()
const mockRetrieveSubscription = vi.fn()

vi.mock("@/lib/stripe/index", () => ({
  getStripe: vi.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    checkout: { sessions: { listLineItems: mockListLineItems } },
    subscriptions: { retrieve: mockRetrieveSubscription },
  })),
}))

// Mock Supabase admin
const mockUpdateChain = {
  update: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ error: null }),
  }),
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue(mockUpdateChain),
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
    // Reset the update chain mock
    mockUpdateChain.update.mockReturnValue({
      eq: vi.fn().mockReturnValue({ error: null }),
    })
  })

  it("should return 400 when stripe-signature is missing", async () => {
    const request = new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    })

    const response = await POST(request)
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe("Missing signature")
  })

  it("should return 400 on invalid signature", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature")
    })

    const request = makeWebhookRequest("{}")
    const response = await POST(request)
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBe("Invalid signature")
  })

  it("should handle checkout.session.completed event", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test",
          metadata: { supabase_user_id: "user-123" },
          customer: "cus_test",
        },
      },
    })
    mockListLineItems.mockResolvedValue({
      data: [{ price: { id: "price_pro_monthly" } }],
    })

    const request = makeWebhookRequest("{}")
    const response = await POST(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.received).toBe(true)
  })

  it("should skip checkout without user metadata", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: { id: "cs_test", metadata: {}, customer: "cus_test" },
      },
    })

    const request = makeWebhookRequest("{}")
    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it("should handle customer.subscription.updated to pro", async () => {
    mockConstructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_test",
          status: "active",
          metadata: {},
          items: { data: [{ price: { id: "price_pro_monthly" } }] },
        },
      },
    })

    const request = makeWebhookRequest("{}")
    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it("should handle customer.subscription.deleted", async () => {
    mockConstructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          customer: "cus_test",
          metadata: {},
          items: { data: [{ price: { id: "price_pro_monthly" } }] },
        },
      },
    })

    const request = makeWebhookRequest("{}")
    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it("should handle team subscription updates", async () => {
    mockConstructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: {
        object: {
          customer: "cus_test",
          status: "active",
          metadata: { type: "team_seats", org_id: "org-123" },
          items: { data: [{ price: { id: "price_pro_monthly" } }] },
        },
      },
    })

    const request = makeWebhookRequest("{}")
    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it("should return 200 for unhandled event types", async () => {
    mockConstructEvent.mockReturnValue({
      type: "payment_intent.created",
      data: { object: {} },
    })

    const request = makeWebhookRequest("{}")
    const response = await POST(request)
    expect(response.status).toBe(200)
  })
})
