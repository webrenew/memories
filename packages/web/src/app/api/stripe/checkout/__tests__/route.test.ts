import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockResolveWorkspaceContext,
  mockAdminFrom,
  mockCustomersCreate,
  mockCheckoutSessionCreate,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceContext: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCustomersCreate: vi.fn(),
  mockCheckoutSessionCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/workspace", () => ({
  resolveWorkspaceContext: mockResolveWorkspaceContext,
}))

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    customers: { create: mockCustomersCreate },
    checkout: { sessions: { create: mockCheckoutSessionCreate } },
  })),
}))

import { POST } from "../route"

function makeRequest(body: unknown = { billing: "monthly" }) {
  return new Request("https://example.com/api/stripe/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("/api/stripe/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockCheckoutSessionCreate.mockResolvedValue({ url: "https://stripe.test/checkout" })
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)
    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
  })

  it("returns 403 when org user cannot manage billing", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "admin",
      plan: "free",
      hasDatabase: true,
      canProvision: true,
      canManageBilling: false,
      turso_db_url: "libsql://org.turso.io",
      turso_db_token: "token",
      turso_db_name: "org-db",
      userId: "user-1",
    })

    const response = await POST(makeRequest())
    expect(response.status).toBe(403)
  })

  it("creates org checkout session using organization customer + team metadata", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "owner@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "owner",
      plan: "free",
      hasDatabase: true,
      canProvision: true,
      canManageBilling: true,
      turso_db_url: "libsql://org.turso.io",
      turso_db_token: "token",
      turso_db_name: "org-db",
      userId: "user-1",
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { stripe_customer_id: "cus_org_123", name: "Acme" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    })

    const response = await POST(makeRequest({ billing: "annual" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe("https://stripe.test/checkout")
    expect(mockCheckoutSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_org_123",
        success_url: "https://example.com/app?upgraded=true",
        cancel_url: "https://example.com/app/upgrade",
        metadata: expect.objectContaining({
          workspace_owner_type: "organization",
          workspace_org_id: "org-1",
          supabase_user_id: "user-1",
        }),
        subscription_data: {
          metadata: {
            type: "team_seats",
            org_id: "org-1",
            created_by_user_id: "user-1",
          },
        },
      })
    )
  })

  it("creates user checkout session using user customer", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      orgRole: null,
      plan: "free",
      hasDatabase: true,
      canProvision: true,
      canManageBilling: true,
      turso_db_url: "libsql://user.turso.io",
      turso_db_token: "token",
      turso_db_name: "user-db",
      userId: "user-1",
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { stripe_customer_id: "cus_user_123", email: "user@example.com" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {}
    })

    const response = await POST(makeRequest({ billing: "monthly" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe("https://stripe.test/checkout")
    expect(mockCheckoutSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_user_123",
        success_url: "https://example.com/app?upgraded=true",
        cancel_url: "https://example.com/app/upgrade",
        metadata: expect.objectContaining({
          workspace_owner_type: "user",
          supabase_user_id: "user-1",
        }),
      })
    )
  })

  it("returns 500 when organization customer lookup fails", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "owner@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "owner",
      plan: "free",
      hasDatabase: true,
      canProvision: true,
      canManageBilling: true,
      turso_db_url: "libsql://org.turso.io",
      turso_db_token: "token",
      turso_db_name: "org-db",
      userId: "user-1",
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db read failed" },
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {}
    })

    const response = await POST(makeRequest({ billing: "annual" }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe("BILLING_CUSTOMER_CREATE_FAILED")
    expect(mockCustomersCreate).not.toHaveBeenCalled()
  })

  it("returns 500 when user customer lookup fails", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      orgRole: null,
      plan: "free",
      hasDatabase: true,
      canProvision: true,
      canManageBilling: true,
      turso_db_url: "libsql://user.turso.io",
      turso_db_token: "token",
      turso_db_name: "user-db",
      userId: "user-1",
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db read failed" },
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {}
    })

    const response = await POST(makeRequest({ billing: "monthly" }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe("BILLING_CUSTOMER_CREATE_FAILED")
    expect(mockCustomersCreate).not.toHaveBeenCalled()
  })
})
