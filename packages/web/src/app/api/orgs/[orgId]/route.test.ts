import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockFrom,
  mockAdminRpc,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockAdminRpc: vi.fn(),
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: mockAdminRpc,
  })),
}))

import { DELETE, GET, PATCH } from "./route"

describe("/api/orgs/[orgId] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("blocks admins from changing domain auto-join settings", async () => {
    mockAdminRpc.mockResolvedValue({ data: "owner_required", error: null })

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

  it("returns 500 when settings RPC fails", async () => {
    mockAdminRpc.mockResolvedValue({
      data: null,
      error: { message: "DB write failed" },
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

  it("returns 500 when organization update fails", async () => {
    mockAdminRpc.mockResolvedValue({ data: "unexpected_state", error: null })

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
    mockAdminRpc.mockResolvedValue({ data: "domain_required", error: null })

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
    mockAdminRpc.mockResolvedValue({ data: "updated", error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "org-1",
                  plan: "team",
                  domain_auto_join_enabled: true,
                  domain_auto_join_domain: "webrenew.io",
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
        body: JSON.stringify({
          domain_auto_join_enabled: true,
          domain_auto_join_domain: " HTTPS://@WebRenew.io ",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(200)
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "update_org_settings_atomic",
      expect.objectContaining({
        p_domain_auto_join_enabled: true,
        p_set_domain_auto_join_enabled: true,
        p_domain_auto_join_domain: "webrenew.io",
        p_set_domain_auto_join_domain: true,
      })
    )
  })

  it("activates auto-join when saving a new domain even if enabled=false was sent", async () => {
    mockAdminRpc.mockResolvedValue({ data: "updated", error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "org-1",
                  plan: "team",
                  domain_auto_join_enabled: true,
                  domain_auto_join_domain: "webrenew.io",
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
        body: JSON.stringify({
          domain_auto_join_enabled: false,
          domain_auto_join_domain: "webrenew.io",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(200)
    expect(mockAdminRpc).toHaveBeenCalledWith(
      "update_org_settings_atomic",
      expect.objectContaining({
        p_domain_auto_join_enabled: false,
        p_set_domain_auto_join_enabled: true,
        p_domain_auto_join_domain: "webrenew.io",
        p_set_domain_auto_join_domain: true,
      })
    )
  })

  it("returns upgrade-required when enabling domain auto-join on free plan", async () => {
    mockAdminRpc.mockResolvedValue({ data: "team_plan_required", error: null })

    const response = await PATCH(
      new Request("https://example.com/api/orgs/org-1", {
        method: "PATCH",
        body: JSON.stringify({ domain_auto_join_domain: "webrenew.io" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: "Domain auto-join requires the Team plan. Upgrade to continue.",
      code: "TEAM_PLAN_REQUIRED",
      upgradeUrl: "/app/upgrade?plan=team",
    })
  })
})

describe("/api/orgs/[orgId] GET", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockCheckRateLimit.mockResolvedValue(null)
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

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1"),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to fetch organization",
    })
  })

  it("returns 500 when organization lookup fails", async () => {
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

      if (table === "organizations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "DB read failed" },
              }),
            }),
          })),
        }
      }

      return {}
    })

    const response = await GET(
      new Request("https://example.com/api/orgs/org-1"),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to fetch organization",
    })
  })
})

describe("/api/orgs/[orgId] DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 500 when delete RPC fails", async () => {
    mockAdminRpc.mockResolvedValue({
      data: null,
      error: { message: "DB read failed" },
    })

    const response = await DELETE(
      new Request("https://example.com/api/orgs/org-1", { method: "DELETE" }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to delete organization",
    })
  })

  it("returns 500 when organization deletion fails", async () => {
    mockAdminRpc.mockResolvedValue({ data: "unexpected_state", error: null })

    const response = await DELETE(
      new Request("https://example.com/api/orgs/org-1", { method: "DELETE" }),
      { params: Promise.resolve({ orgId: "org-1" }) },
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to delete organization",
    })
  })
})
