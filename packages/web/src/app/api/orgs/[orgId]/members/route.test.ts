import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockSupabaseFrom,
  mockAdminFrom,
  mockAdminListUsers,
  mockAdminGetUserById,
  mockTursoExecute,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSupabaseFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockAdminListUsers: vi.fn(),
  mockAdminGetUserById: vi.fn(),
  mockTursoExecute: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockSupabaseFrom,
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
    auth: {
      admin: {
        listUsers: mockAdminListUsers,
        getUserById: mockAdminGetUserById,
      },
    },
  })),
}))

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockTursoExecute,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
}))

import { DELETE, GET, PATCH } from "./route"

describe("/api/orgs/[orgId]/members", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockAdminListUsers.mockResolvedValue({
      data: {
        users: [{ id: "user-1", last_sign_in_at: "2026-02-12T10:00:00.000Z" }],
        total: 1,
      },
      error: null,
    })
    mockAdminGetUserById.mockResolvedValue({
      data: { user: null },
      error: null,
    })
    mockTursoExecute.mockResolvedValue({ rows: [] })
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/members"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(401)
  })

  it("returns 500 when membership lookup fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn((columns: string) => {
            if (columns === "role") {
              const single = vi.fn().mockResolvedValue({
                data: null,
                error: { message: "DB read failed" },
              })
              const eqUser = vi.fn().mockReturnValue({ single })
              const eqOrg = vi.fn().mockReturnValue({ eq: eqUser })
              return { eq: eqOrg }
            }

            return { eq: vi.fn() }
          }),
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

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load organization members",
    })
  })

  it("returns 500 when user profile lookup fails", async () => {
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
              data: null,
              error: { message: "DB read failed" },
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

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load organization members",
    })
  })

  it("returns 500 when members list lookup fails", async () => {
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
              data: null,
              error: { message: "DB read failed" },
            })
            const eqOrg = vi.fn().mockReturnValue({ order })
            return { eq: eqOrg }
          }),
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

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load organization members",
    })
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

  it("falls back to getUserById when listUsers does not include member login data", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockAdminListUsers.mockResolvedValue({
      data: {
        users: [{ id: "other-user", last_sign_in_at: "2026-02-01T10:00:00.000Z" }],
        total: 1,
      },
      error: null,
    })
    mockAdminGetUserById.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          user_metadata: { last_sign_in_at: "2026-02-14T09:30:00.000Z" },
        },
      },
      error: null,
    })

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
    expect(body.members[0].last_login_at).toBe("2026-02-14T09:30:00.000Z")
    expect(mockAdminGetUserById).toHaveBeenCalledWith("user-1")
  })

  it("normalizes user ids when mapping user-scoped memory counts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockAdminListUsers.mockResolvedValue({
      data: {
        users: [
          { id: "user-1", last_sign_in_at: "2026-02-12T10:00:00.000Z" },
          { id: "user-2", last_sign_in_at: "2026-02-11T10:00:00.000Z" },
        ],
        total: 2,
      },
      error: null,
    })

    mockTursoExecute
      .mockResolvedValueOnce({ rows: [{ count: 12 }] })
      .mockResolvedValueOnce({
        rows: [
          { user_id: " user-1 ", count: 7 },
          { user_id: "USER-2", count: 5 },
        ],
      })

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
                {
                  id: "member-2",
                  user_id: "user-2",
                  role: "member",
                  created_at: "2026-02-13T00:00:00.000Z",
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
                  email: "owner@webrenew.io",
                  name: "Owner",
                  avatar_url: null,
                },
                {
                  id: "user-2",
                  email: "member@webrenew.io",
                  name: "Member",
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
                data: { turso_db_url: "libsql://workspace-db", turso_db_token: "token" },
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
    expect(body.members).toHaveLength(2)

    const owner = body.members.find((member: { user: { id: string } }) => member.user.id === "user-1")
    const member = body.members.find((row: { user: { id: string } }) => row.user.id === "user-2")
    expect(owner?.memory_count).toBe(12)
    expect(owner?.user_memory_count).toBe(7)
    expect(member?.memory_count).toBe(12)
    expect(member?.user_memory_count).toBe(5)
    expect(mockTursoExecute).toHaveBeenCalledTimes(2)
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

describe("/api/orgs/[orgId]/members DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  })

  it("returns 500 when actor membership lookup fails", async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
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

    const response = await DELETE(
      new Request("https://example.com/api/orgs/org-1/members?userId=user-2", { method: "DELETE" }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to remove member",
    })
  })

  it("returns 500 when target membership lookup fails", async () => {
    let membershipLookupCount = 0

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  membershipLookupCount += 1
                  if (membershipLookupCount === 1) {
                    return { data: { role: "owner" }, error: null }
                  }
                  return { data: null, error: { message: "DB read failed" } }
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

    const response = await DELETE(
      new Request("https://example.com/api/orgs/org-1/members?userId=user-2", { method: "DELETE" }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to remove member",
    })
  })

  it("returns 500 when member deletion fails", async () => {
    let membershipLookupCount = 0

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  membershipLookupCount += 1
                  if (membershipLookupCount === 1) {
                    return { data: { role: "owner" }, error: null }
                  }
                  return { data: { role: "member" }, error: null }
                }),
              }),
            }),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                error: { message: "DB write failed" },
              }),
            }),
          })),
        }
      }

      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { stripe_subscription_id: null },
                error: null,
              }),
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn() })),
      }
    })

    const response = await DELETE(
      new Request("https://example.com/api/orgs/org-1/members?userId=user-2", { method: "DELETE" }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to remove member",
    })
  })
})

describe("/api/orgs/[orgId]/members PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
  })

  it("returns 500 when actor membership lookup fails", async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
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

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1/members", {
        method: "PATCH",
        body: JSON.stringify({ userId: "user-2", role: "member" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to update member role",
    })
  })

  it("returns 500 when target membership lookup fails", async () => {
    let membershipLookupCount = 0

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  membershipLookupCount += 1
                  if (membershipLookupCount === 1) {
                    return { data: { role: "owner" }, error: null }
                  }
                  return { data: null, error: { message: "DB read failed" } }
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

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1/members", {
        method: "PATCH",
        body: JSON.stringify({ userId: "user-2", role: "member" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to update member role",
    })
  })

  it("returns 500 when role update fails", async () => {
    let membershipLookupCount = 0

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  membershipLookupCount += 1
                  if (membershipLookupCount === 1) {
                    return { data: { role: "owner" }, error: null }
                  }
                  return { data: { role: "member" }, error: null }
                }),
              }),
            }),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                error: { message: "DB write failed" },
              }),
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({ eq: vi.fn(), single: vi.fn() })),
      }
    })

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1/members", {
        method: "PATCH",
        body: JSON.stringify({ userId: "user-2", role: "member" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to update member role",
    })
  })
})
