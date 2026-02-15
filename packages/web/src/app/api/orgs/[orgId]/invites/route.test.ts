import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockFrom,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
}))

import { GET } from "./route"

describe("/api/orgs/[orgId]/invites GET", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/invites"),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(401)
  })

  it("returns 500 when membership lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "DB read failed" },
                }),
              }),
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), is: vi.fn(), gt: vi.fn(), order: vi.fn() })),
      }
    })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/invites"),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load invites",
    })
  })
})
