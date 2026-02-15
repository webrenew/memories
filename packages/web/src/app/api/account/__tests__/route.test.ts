import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockSignOut,
  mockFrom,
  mockProfileSingle,
  mockDeleteEq,
  mockCheckRateLimit,
  mockDeleteUser,
  mockSubscriptionsList,
  mockSubscriptionsCancel,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockFrom: vi.fn(),
  mockProfileSingle: vi.fn(),
  mockDeleteEq: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockDeleteUser: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockSubscriptionsCancel: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
    from: mockFrom,
  })),
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: {
        deleteUser: mockDeleteUser,
      },
    },
  })),
}))

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    subscriptions: {
      list: mockSubscriptionsList,
      cancel: mockSubscriptionsCancel,
    },
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/env", () => ({
  getTursoOrgSlug: vi.fn(() => "org"),
  getTursoApiToken: vi.fn(() => "token"),
  getSupabaseUrl: vi.fn(() => "https://supabase.test"),
  getSupabaseServiceRoleKey: vi.fn(() => "service-role"),
}))

import { DELETE } from "../route"

describe("DELETE /api/account", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockSignOut.mockResolvedValue(undefined)
    mockDeleteUser.mockResolvedValue({ error: null })
    mockSubscriptionsList.mockResolvedValue({ data: [] })
    mockSubscriptionsCancel.mockResolvedValue({})
    mockProfileSingle.mockResolvedValue({
      data: { stripe_customer_id: null, turso_db_name: null },
      error: null,
    })
    mockDeleteEq.mockResolvedValue({ error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table !== "users") return {}
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockProfileSingle,
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: mockDeleteEq,
        }),
      }
    })
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await DELETE()
    expect(response.status).toBe(401)
  })

  it("returns 500 when loading user profile fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockProfileSingle.mockResolvedValue({
      data: null,
      error: { message: "db read failed" },
    })

    const response = await DELETE()
    expect(response.status).toBe(500)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it("returns 500 when deleting user row fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockDeleteEq.mockResolvedValue({ error: { message: "delete failed" } })

    const response = await DELETE()
    expect(response.status).toBe(500)
    expect(mockDeleteUser).not.toHaveBeenCalled()
  })

  it("returns success when account deletion completes", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    const response = await DELETE()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(mockDeleteUser).toHaveBeenCalledWith("user-1")
  })
})
