import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockResolveWorkspaceContext,
  mockAdminFrom,
  mockPortalCreate,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceContext: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockPortalCreate: vi.fn(),
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
    billingPortal: { sessions: { create: mockPortalCreate } },
  })),
}))

import { POST } from "../route"

function makeRequest() {
  return new Request("https://example.com/api/stripe/portal", { method: "POST" })
}

describe("/api/stripe/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockPortalCreate.mockResolvedValue({ url: "https://stripe.test/portal" })
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
      orgRole: "member",
      plan: "free",
      hasDatabase: true,
      canProvision: false,
      canManageBilling: false,
      turso_db_url: "libsql://org.turso.io",
      turso_db_token: "token",
      turso_db_name: "org-db",
      userId: "user-1",
    })

    const response = await POST(makeRequest())
    expect(response.status).toBe(403)
  })

  it("creates portal session for organization billing owner", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "owner@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "owner",
      plan: "pro",
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
              maybeSingle: vi.fn().mockResolvedValue({
                data: { stripe_customer_id: "cus_org_123" },
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    const response = await POST(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe("https://stripe.test/portal")
    expect(mockPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_org_123",
        return_url: "https://example.com/app/billing",
      })
    )
  })

  it("creates portal session for personal workspace", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      orgRole: null,
      plan: "pro",
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
              maybeSingle: vi.fn().mockResolvedValue({
                data: { stripe_customer_id: "cus_user_123" },
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    const response = await POST(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe("https://stripe.test/portal")
    expect(mockPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_user_123",
        return_url: "https://example.com/app/billing",
      })
    )
  })

  it("returns 500 when organization billing customer lookup fails", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "owner@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "owner",
      plan: "pro",
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
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db read failed" },
              }),
            }),
          }),
        }
      }
      return {}
    })

    const response = await POST(makeRequest())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe("BILLING_CUSTOMER_LOOKUP_FAILED")
  })

  it("returns 500 when personal billing customer lookup fails", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      orgRole: null,
      plan: "pro",
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
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db read failed" },
              }),
            }),
          }),
        }
      }
      return {}
    })

    const response = await POST(makeRequest())
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe("BILLING_CUSTOMER_LOOKUP_FAILED")
  })
})
