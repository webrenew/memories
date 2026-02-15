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

import { DELETE, GET, POST } from "./route"

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

  it("returns 500 when invites query fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { role: "owner" },
                  error: null,
                }),
              }),
            }),
          })),
        }
      }

      if (table === "org_invites") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                gt: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: "DB read failed" },
                  }),
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

describe("/api/orgs/[orgId]/invites POST", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
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
        select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn() })),
      }
    })

    const response = await POST(
      new Request("https://example.com/api/orgs/org-1/invites", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", role: "member" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to create invite",
    })
  })

  it("returns 500 when existing-user lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { role: "owner" },
                  error: null,
                }),
              }),
            }),
          })),
        }
      }

      if (table === "users") {
        return {
          select: vi.fn(() => ({
            ilike: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "DB read failed" },
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn() })),
      }
    })

    const response = await POST(
      new Request("https://example.com/api/orgs/org-1/invites", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", role: "member" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to create invite",
    })
  })

  it("returns 500 when existing-member lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    let orgMembersLookupCount = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        orgMembersLookupCount += 1

        if (orgMembersLookupCount === 1) {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { role: "owner" },
                    error: null,
                  }),
                }),
              }),
            })),
          }
        }

        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: "DB read failed" },
                  }),
                }),
              }),
            }),
          })),
        }
      }

      if (table === "users") {
        return {
          select: vi.fn(() => ({
            ilike: vi.fn().mockResolvedValue({
              data: [{ id: "existing-user-1" }],
              error: null,
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn() })),
      }
    })

    const response = await POST(
      new Request("https://example.com/api/orgs/org-1/invites", {
        method: "POST",
        body: JSON.stringify({ email: "existing@example.com", role: "member" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to create invite",
    })
  })

  it("returns 500 when pending-invite lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { role: "owner" },
                  error: null,
                }),
              }),
            }),
          })),
        }
      }

      if (table === "users") {
        return {
          select: vi.fn(() => ({
            ilike: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
        }
      }

      if (table === "org_invites") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: "DB read failed" },
                    }),
                  }),
                }),
              }),
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn() })),
      }
    })

    const response = await POST(
      new Request("https://example.com/api/orgs/org-1/invites", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", role: "member" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to create invite",
    })
  })
})

describe("/api/orgs/[orgId]/invites DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
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
        select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() })),
      }
    })

    const response = await DELETE(
      new Request("https://example.com/api/orgs/org-1/invites?inviteId=inv-1", { method: "DELETE" }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to revoke invite",
    })
  })
})
