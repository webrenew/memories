import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockAdminFrom,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAdminFrom: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

import { GET } from "../route"

describe("/api/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "user-1",
                  plan: "free",
                  current_org_id: "org-1",
                  turso_db_url: null,
                  turso_db_token: null,
                },
                error: null,
              }),
            }),
          })),
        }
      }

      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  role: "admin",
                  organization: {
                    id: "org-1",
                    name: "WebRenew",
                    slug: "webrenew",
                    plan: "team",
                    subscription_status: "active",
                    stripe_subscription_id: "sub_123",
                    turso_db_url: "libsql://team",
                    turso_db_token: "token",
                  },
                },
              ],
              error: null,
            }),
          })),
        }
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(),
          single: vi.fn(),
        })),
      }
    })
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("https://example.com/api/workspace"))
    expect(response.status).toBe(401)
  })

  it("returns workspace state", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })

    const response = await GET(new Request("https://example.com/api/workspace"))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.workspace).toEqual({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "admin",
      plan: "team",
      hasDatabase: true,
      canProvision: true,
      canManageBilling: false,
    })
  })

  it("returns 404 when user row is missing", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
            }),
          })),
        }
      }
      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(),
          single: vi.fn(),
        })),
      }
    })

    const response = await GET(new Request("https://example.com/api/workspace"))
    expect(response.status).toBe(404)
  })

  it("returns 500 with a stable error when memberships lookup fails", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "user-1",
                  plan: "free",
                  current_org_id: "org-1",
                  turso_db_url: null,
                  turso_db_token: null,
                },
                error: null,
              }),
            }),
          })),
        }
      }

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

      return {
        select: vi.fn(() => ({
          eq: vi.fn(),
          single: vi.fn(),
        })),
      }
    })

    const response = await GET(new Request("https://example.com/api/workspace"))
    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body).toEqual({ error: "Failed to load workspace" })
  })

  it("returns workspace summaries when requested", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    const response = await GET(
      new Request("https://example.com/api/workspace?includeSummaries=1")
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.summaries.currentOrgId).toBe("org-1")
    expect(body.summaries.organizations).toHaveLength(1)
    expect(body.summaries.organizations[0]).toMatchObject({
      id: "org-1",
      name: "WebRenew",
      slug: "webrenew",
      role: "admin",
    })
    expect(body.summaries.personal).toMatchObject({
      ownerType: "user",
      orgId: null,
      canProvision: true,
      canManageBilling: true,
    })
    expect(response.headers.get("Cache-Control")).toContain("private")
  })

  it("returns profiling headers when profile mode is requested", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    const response = await GET(
      new Request("https://example.com/api/workspace?includeSummaries=1&profile=1"),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("X-Workspace-Profile-Total-Ms")).toBeTruthy()
    expect(response.headers.get("X-Workspace-Profile-Summary-Query-Ms")).toBeTruthy()
    expect(response.headers.get("X-Workspace-Profile-User-Query-Ms")).toBeTruthy()
    expect(response.headers.get("X-Workspace-Profile-Memberships-Query-Ms")).toBeTruthy()
    expect(response.headers.get("X-Workspace-Profile-Build-Ms")).toBeTruthy()
    expect(response.headers.get("X-Workspace-Profile-Org-Count")).toBe("1")
    expect(response.headers.get("X-Workspace-Profile-Workspace-Count")).toBe("2")
  })
})
