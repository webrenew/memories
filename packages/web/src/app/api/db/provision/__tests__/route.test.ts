import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockCheckPreAuthApiRateLimit,
  mockResolveWorkspaceContext,
  mockAdminFrom,
  mockCreateDatabase,
  mockCreateDatabaseToken,
  mockDeleteDatabase,
  mockInitSchema,
  mockGetTursoOrgSlug,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockCheckPreAuthApiRateLimit: vi.fn(),
  mockResolveWorkspaceContext: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCreateDatabase: vi.fn(),
  mockCreateDatabaseToken: vi.fn(),
  mockDeleteDatabase: vi.fn(),
  mockInitSchema: vi.fn(),
  mockGetTursoOrgSlug: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
  checkPreAuthApiRateLimit: mockCheckPreAuthApiRateLimit,
}))

vi.mock("@/lib/workspace", () => ({
  resolveWorkspaceContext: mockResolveWorkspaceContext,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/turso", () => ({
  createDatabase: mockCreateDatabase,
  createDatabaseToken: mockCreateDatabaseToken,
  deleteDatabase: mockDeleteDatabase,
  initSchema: mockInitSchema,
}))

vi.mock("@/lib/env", () => ({
  getTursoOrgSlug: mockGetTursoOrgSlug,
}))

import { POST } from "../route"

describe("/api/db/provision", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPreAuthApiRateLimit.mockResolvedValue(null)
    mockCheckRateLimit.mockResolvedValue(null)
    mockDeleteDatabase.mockResolvedValue(undefined)
    mockGetTursoOrgSlug.mockReturnValue("webrenew")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await POST(new Request("https://example.com/api/db/provision", { method: "POST" }))
    expect(response.status).toBe(401)
  })

  it("returns 403 when org role is member", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "member@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      userId: "user-1",
      orgId: "org-1",
      orgRole: "member",
      plan: "pro",
      hasDatabase: false,
      canProvision: false,
      canManageBilling: false,
      turso_db_url: null,
      turso_db_token: null,
      turso_db_name: null,
    })

    const response = await POST(new Request("https://example.com/api/db/provision", { method: "POST" }))
    expect(response.status).toBe(403)
    expect(mockCreateDatabase).not.toHaveBeenCalled()
  })

  it("allows organization admins to provision", async () => {
    vi.useFakeTimers()

    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "admin@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      userId: "user-1",
      orgId: "org-1",
      orgRole: "admin",
      plan: "pro",
      hasDatabase: false,
      canProvision: true,
      canManageBilling: false,
      turso_db_url: null,
      turso_db_token: null,
      turso_db_name: null,
    })

    const mockOrgEq = vi.fn().mockResolvedValue({ error: null })
    const mockOrgUpdate = vi.fn().mockReturnValue({ eq: mockOrgEq })
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return { update: mockOrgUpdate }
      }
      return {}
    })

    mockCreateDatabase.mockResolvedValue({ name: "db-demo", hostname: "demo.turso.io" })
    mockCreateDatabaseToken.mockResolvedValue("token-123")
    mockInitSchema.mockResolvedValue(undefined)

    const responsePromise = POST(new Request("https://example.com/api/db/provision", { method: "POST" }))
    await vi.runAllTimersAsync()
    const response = await responsePromise
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      url: "libsql://demo.turso.io",
      provisioned: true,
    })
    expect(mockCreateDatabase).toHaveBeenCalledWith("webrenew")
    expect(mockCreateDatabaseToken).toHaveBeenCalledWith("webrenew", "db-demo")
    expect(mockInitSchema).toHaveBeenCalledWith("libsql://demo.turso.io", "token-123")
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      turso_db_url: "libsql://demo.turso.io",
      turso_db_token: "token-123",
      turso_db_name: "db-demo",
    })
    expect(mockOrgEq).toHaveBeenCalledWith("id", "org-1")
  })

  it("cleans up Turso DB when credential persistence fails", async () => {
    vi.useFakeTimers()

    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "admin@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      userId: "user-1",
      orgId: "org-1",
      orgRole: "admin",
      plan: "pro",
      hasDatabase: false,
      canProvision: true,
      canManageBilling: false,
      turso_db_url: null,
      turso_db_token: null,
      turso_db_name: null,
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: "save failed" } }),
          }),
        }
      }
      return {}
    })

    mockCreateDatabase.mockResolvedValue({ name: "db-demo", hostname: "demo.turso.io" })
    mockCreateDatabaseToken.mockResolvedValue("token-123")
    mockInitSchema.mockResolvedValue(undefined)

    const responsePromise = POST(new Request("https://example.com/api/db/provision", { method: "POST" }))
    await vi.runAllTimersAsync()
    const response = await responsePromise

    expect(response.status).toBe(500)
    expect(mockDeleteDatabase).toHaveBeenCalledWith("webrenew", "db-demo")
  })
})
