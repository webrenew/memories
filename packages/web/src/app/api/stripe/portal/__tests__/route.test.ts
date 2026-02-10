import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockResolveWorkspaceContext,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceContext: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock("@/lib/workspace", () => ({
  resolveWorkspaceContext: mockResolveWorkspaceContext,
}))

import { POST } from "../route"

describe("/api/stripe/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)
    const response = await POST(new Request("https://example.com/api/stripe/portal", { method: "POST" }))
    expect(response.status).toBe(401)
  })

  it("returns 403 when org user cannot manage billing", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "member",
      plan: "free",
      hasDatabase: true,
      canProvision: false,
      canManageBilling: false,
      turso_db_url: "libsql://org.turso.io",
      turso_db_token: "token",
      turso_db_name: "org-db",
      userId: "user-1",
    })

    const response = await POST(new Request("https://example.com/api/stripe/portal", { method: "POST" }))
    expect(response.status).toBe(403)
  })
})
