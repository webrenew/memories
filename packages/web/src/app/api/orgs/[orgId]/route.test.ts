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

import { PATCH } from "./route"

describe("/api/orgs/[orgId] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("blocks admins from changing domain auto-join settings", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
              }),
            }),
          })),
        }
      }
      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1", {
        method: "PATCH",
        body: JSON.stringify({ domain_auto_join_enabled: true, domain_auto_join_domain: "webrenew.io" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "Only the owner can manage domain auto-join",
    })
  })

  it("returns 500 when membership lookup fails", async () => {
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

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "New org name" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to update organization",
    })
  })

  it("requires a domain before enabling auto-join", async () => {
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

      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  domain_auto_join_enabled: false,
                  domain_auto_join_domain: null,
                },
                error: null,
              }),
            }),
          })),
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1", {
        method: "PATCH",
        body: JSON.stringify({ domain_auto_join_enabled: true }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "Set a domain before enabling domain auto-join",
    })
  })

  it("normalizes the domain when owner updates settings", async () => {
    const mockUpdate = vi.fn(() => ({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "org-1",
              domain_auto_join_enabled: true,
              domain_auto_join_domain: "webrenew.io",
            },
            error: null,
          }),
        }),
      }),
    }))

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

      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  domain_auto_join_enabled: false,
                  domain_auto_join_domain: null,
                },
                error: null,
              }),
            }),
          })),
          update: mockUpdate,
        }
      }

      return {}
    })

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1", {
        method: "PATCH",
        body: JSON.stringify({
          domain_auto_join_enabled: true,
          domain_auto_join_domain: " HTTPS://@WebRenew.io ",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        domain_auto_join_enabled: true,
        domain_auto_join_domain: "webrenew.io",
      }),
    )
  })
})
