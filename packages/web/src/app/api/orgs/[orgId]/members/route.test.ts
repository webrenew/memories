import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockAdminFrom,
  mockAdminGetUserById,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockAdminGetUserById: vi.fn(),
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
    auth: {
      admin: {
        getUserById: mockAdminGetUserById,
      },
    },
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
}))

import { GET } from "./route"

describe("/api/orgs/[orgId]/members", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockAdminGetUserById.mockResolvedValue({
      data: { user: { last_sign_in_at: "2026-02-12T10:00:00.000Z" } },
      error: null,
    })
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/members"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(401)
  })

  it("returns member list including owner", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn((columns: string) => {
            if (columns === "role") {
              const single = vi.fn().mockResolvedValue({ data: { role: "owner" }, error: null })
              const eqUser = vi.fn().mockReturnValue({ single })
              const eqOrg = vi.fn().mockReturnValue({ eq: eqUser })
              return { eq: eqOrg }
            }

            const order = vi.fn().mockResolvedValue({
              data: [
                {
                  id: "member-1",
                  user_id: "user-1",
                  role: "owner",
                  created_at: "2026-02-12T00:00:00.000Z",
                },
              ],
              error: null,
            })
            const eqOrg = vi.fn().mockReturnValue({ order })
            return { eq: eqOrg }
          }),
        }
      }

      if (table === "users") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "user-1",
                  email: "charles@webrenew.io",
                  name: "Charles Howard",
                  avatar_url: null,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { turso_db_url: null, turso_db_token: null },
                error: null,
              }),
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), in: vi.fn(), single: vi.fn(), order: vi.fn() })),
      }
    })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/members"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.members).toHaveLength(1)
    expect(body.members[0].role).toBe("owner")
    expect(body.members[0].user.email).toBe("charles@webrenew.io")
    expect(body.members[0].last_login_at).toBe("2026-02-12T10:00:00.000Z")
    expect(body.members[0].memory_count).toBe(0)
    expect(body.members[0].user_memory_count).toBe(0)
  })

  it("falls back when created_at is missing from org_members", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn((columns: string) => {
            if (columns === "role") {
              const single = vi.fn().mockResolvedValue({ data: { role: "owner" }, error: null })
              const eqUser = vi.fn().mockReturnValue({ single })
              const eqOrg = vi.fn().mockReturnValue({ eq: eqUser })
              return { eq: eqOrg }
            }

            if (columns === "id, user_id, role, created_at") {
              const order = vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'column "created_at" does not exist' },
              })
              const eqOrg = vi.fn().mockReturnValue({ order })
              return { eq: eqOrg }
            }

            const order = vi.fn().mockResolvedValue({
              data: [{ id: "member-1", user_id: "user-1", role: "owner" }],
              error: null,
            })
            const eqOrg = vi.fn().mockReturnValue({ order })
            return { eq: eqOrg }
          }),
        }
      }

      if (table === "users") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "user-1",
                  email: "charles@webrenew.io",
                  name: "Charles Howard",
                  avatar_url: null,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { turso_db_url: null, turso_db_token: null },
                error: null,
              }),
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), in: vi.fn(), single: vi.fn(), order: vi.fn() })),
      }
    })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/members"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.members).toHaveLength(1)
    expect(body.members[0].joined_at).toBeNull()
    expect(body.members[0].user.email).toBe("charles@webrenew.io")
    expect(body.members[0].memory_count).toBe(0)
  })
})
