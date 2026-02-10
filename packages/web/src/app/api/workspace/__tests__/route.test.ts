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
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock("@/lib/workspace", () => ({
  resolveWorkspaceContext: mockResolveWorkspaceContext,
}))

import { GET } from "../route"

describe("/api/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("https://example.com/api/workspace"))
    expect(response.status).toBe(401)
  })

  it("returns workspace state", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "admin",
      plan: "free",
      hasDatabase: false,
      canProvision: true,
    })

    const response = await GET(new Request("https://example.com/api/workspace"))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.workspace).toEqual({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "admin",
      plan: "free",
      hasDatabase: false,
      canProvision: true,
    })
  })

  it("returns 404 when workspace context is missing", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "user@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue(null)

    const response = await GET(new Request("https://example.com/api/workspace"))
    expect(response.status).toBe(404)
  })
})
