import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockResolveWorkspaceContext,
  mockListSdkProjectsForOwner,
  mockCreateSdkProject,
  mockCreateUserApiKey,
  mockRevokeUserApiKeys,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceContext: vi.fn(),
  mockListSdkProjectsForOwner: vi.fn(),
  mockCreateSdkProject: vi.fn(),
  mockCreateUserApiKey: vi.fn(),
  mockRevokeUserApiKeys: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock("@/lib/workspace", () => ({
  resolveWorkspaceContext: mockResolveWorkspaceContext,
}))

vi.mock("@/lib/sdk-project-store", () => ({
  listSdkProjectsForOwner: mockListSdkProjectsForOwner,
  createSdkProject: mockCreateSdkProject,
  isMissingSdkProjectsTableError: (error: unknown) =>
    error instanceof Error && error.message === "missing-sdk-projects-table",
  isDuplicateSdkProjectError: (error: unknown) =>
    error instanceof Error && error.message === "duplicate-sdk-project",
}))

vi.mock("@/lib/mcp-api-key-store", () => ({
  createUserApiKey: mockCreateUserApiKey,
  revokeUserApiKeys: mockRevokeUserApiKeys,
}))

import { GET, POST } from "../route"

describe("/api/sdk-projects", () => {
  const validExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "test@example.com" })
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      plan: "individual",
      canProvision: true,
    })
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("http://localhost/api/sdk-projects"))

    expect(response.status).toBe(401)
  })

  it("lists workspace SDK projects", async () => {
    mockListSdkProjectsForOwner.mockResolvedValue([
      {
        id: "project-1",
        tenantId: "tenant-acme",
        displayName: "Acme Production",
        description: "Primary customer tenant",
        createdByUserId: "user-1",
        createdAt: "2026-03-09T10:00:00.000Z",
        updatedAt: "2026-03-09T10:00:00.000Z",
        routingStatus: null,
        routingSource: null,
        routingUpdatedAt: null,
      },
    ])

    const response = await GET(new Request("http://localhost/api/sdk-projects"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.projects).toHaveLength(1)
    expect(mockListSdkProjectsForOwner).toHaveBeenCalledWith({}, "user:user-1")
  })

  it("creates a project without generating a key", async () => {
    mockCreateSdkProject.mockResolvedValue({
      id: "project-1",
      tenantId: "tenant-acme",
      displayName: "Acme Production",
      description: "Primary customer tenant",
      createdByUserId: "user-1",
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      routingStatus: null,
      routingSource: null,
      routingUpdatedAt: null,
    })

    const response = await POST(
      new Request("http://localhost/api/sdk-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Acme Production",
          tenantId: "tenant-acme",
          description: "Primary customer tenant",
        }),
      })
    )

    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.project.tenantId).toBe("tenant-acme")
    expect(body.apiKey).toBeNull()
    expect(mockCreateUserApiKey).not.toHaveBeenCalled()
  })

  it("creates a project and API key together", async () => {
    mockCreateUserApiKey.mockResolvedValue({
      keyId: "key-1",
      apiKey: `mem_${"a".repeat(64)}`,
      keyPreview: "mem_aaaaaaaa********************aaaa",
      createdAt: "2026-03-09T10:00:00.000Z",
      expiresAt: validExpiry,
    })
    mockCreateSdkProject.mockResolvedValue({
      id: "project-1",
      tenantId: "tenant-acme",
      displayName: "Acme Production",
      description: null,
      createdByUserId: "user-1",
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      routingStatus: null,
      routingSource: null,
      routingUpdatedAt: null,
    })

    const response = await POST(
      new Request("http://localhost/api/sdk-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Acme Production",
          tenantId: "tenant-acme",
          generateApiKey: true,
          expiresAt: validExpiry,
        }),
      })
    )

    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.apiKey.apiKey).toMatch(/^mem_[a-f0-9]{64}$/)
    expect(mockCreateUserApiKey).toHaveBeenCalledWith({}, { userId: "user-1", expiresAt: validExpiry })
  })

  it("requires org admin/owner privileges for project creation", async () => {
    mockResolveWorkspaceContext.mockResolvedValue({
      ownerType: "organization",
      orgId: "org-1",
      plan: "team",
      canProvision: false,
    })

    const response = await POST(
      new Request("http://localhost/api/sdk-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Acme Production",
          tenantId: "tenant-acme",
        }),
      })
    )

    expect(response.status).toBe(403)
  })

  it("returns 409 for duplicate tenant ids and revokes any generated key", async () => {
    mockCreateUserApiKey.mockResolvedValue({
      keyId: "key-1",
      apiKey: `mem_${"a".repeat(64)}`,
      keyPreview: "mem_aaaaaaaa********************aaaa",
      createdAt: "2026-03-09T10:00:00.000Z",
      expiresAt: validExpiry,
    })
    mockCreateSdkProject.mockRejectedValue(new Error("duplicate-sdk-project"))

    const response = await POST(
      new Request("http://localhost/api/sdk-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Acme Production",
          tenantId: "tenant-acme",
          generateApiKey: true,
          expiresAt: validExpiry,
        }),
      })
    )

    expect(response.status).toBe(409)
    expect(mockRevokeUserApiKeys).toHaveBeenCalledWith({}, { userId: "user-1", keyId: "key-1" })
  })
})
