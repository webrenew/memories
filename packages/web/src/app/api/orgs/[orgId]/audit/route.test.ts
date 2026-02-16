import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetUser, mockFrom, mockAdminFrom, mockCheckRateLimit } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
}))

import { GET } from "./route"

describe("/api/orgs/[orgId]/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/audit"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(401)
  })

  it("returns 403 for non-admin members", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { role: "member" }, error: null }),
              }),
            }),
          })),
        }
      }
      return {}
    })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/audit"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(403)
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
      return {}
    })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/audit"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load audit events",
    })
  })

  it("returns audit events with actor details", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "owner-1" } } })

    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { role: "owner" }, error: null }),
              }),
            }),
          })),
        }
      }

      if (table === "org_audit_logs") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "event-1",
                      actor_user_id: "owner-1",
                      action: "org_invite_created",
                      target_type: "invite",
                      target_id: "invite-1",
                      target_label: "new@webrenew.io",
                      metadata: { role: "member" },
                      created_at: "2026-02-13T19:00:00.000Z",
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          })),
        }
      }

      return {}
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: "owner-1", email: "charles@webrenew.io", name: "Charles Howard" }],
              error: null,
            }),
          })),
        }
      }
      return {}
    })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1/audit?limit=20"),
      { params: Promise.resolve({ orgId: "org-1" }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({
      id: "event-1",
      action: "org_invite_created",
      target_label: "new@webrenew.io",
      actor: {
        id: "owner-1",
        email: "charles@webrenew.io",
      },
    })
  })
})
