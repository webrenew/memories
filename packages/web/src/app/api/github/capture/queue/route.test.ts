import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockAdminFrom,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

import { GET } from "./route"

describe("/api/github/capture/queue GET", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(new Request("https://example.com/api/github/capture/queue"))
    expect(response.status).toBe(401)
  })

  it("returns 500 with stable error when memberships lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "db timeout" },
            }),
          })),
        }
      }

      return {}
    })

    const response = await GET(new Request("https://example.com/api/github/capture/queue"))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to load queue",
    })
  })
})
