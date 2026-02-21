import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockCheckRateLimit,
  mockListUserApiKeys,
  mockCreateUserApiKey,
  mockRevokeUserApiKeys,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockListUserApiKeys: vi.fn(),
  mockCreateUserApiKey: vi.fn(),
  mockRevokeUserApiKeys: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/mcp-api-key-store", () => ({
  listUserApiKeys: mockListUserApiKeys,
  createUserApiKey: mockCreateUserApiKey,
  revokeUserApiKeys: mockRevokeUserApiKeys,
}))

import { DELETE, GET, POST } from "../route"

describe("/api/mcp/key", () => {
  const validExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const expectedLink = '</api/sdk/v1/management/keys>; rel="successor-version"'

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const response = await GET()
    expect(response.status).toBe(401)
    expect(response.headers.get("Deprecation")).toBe("true")
    expect(response.headers.get("Sunset")).toBe("Tue, 30 Jun 2026 00:00:00 GMT")
    expect(response.headers.get("Link")).toBe(expectedLink)
  })

  it("returns hasKey false when no key exists", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockListUserApiKeys.mockResolvedValue([])

    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({ hasKey: false, keys: [] })
  })

  it("returns key summary and key list when keys exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockListUserApiKeys.mockResolvedValue([
      {
        id: "k-expired",
        keyPreview: "mem_old********************dead",
        createdAt: "2026-02-10T00:00:00.000Z",
        expiresAt: "2026-02-11T00:00:00.000Z",
        isExpired: true,
      },
      {
        id: "k-active",
        keyPreview: "mem_new********************beef",
        createdAt: "2026-02-12T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        isExpired: false,
      },
    ])

    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.hasKey).toBe(true)
    expect(body.keyCount).toBe(2)
    expect(body.activeKeyCount).toBe(1)
    expect(body.keyPreview).toBe("mem_new********************beef")
    expect(body.isExpired).toBe(false)
    expect(body.keys).toHaveLength(2)
  })

  it("returns 500 when key metadata load fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockListUserApiKeys.mockRejectedValue(new Error("db down"))

    const response = await GET()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain("API key status metadata")
  })

  it("requires expiresAt for POST", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    const response = await POST(
      new Request("http://localhost/api/mcp/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain("expiresAt")
  })

  it("creates an additional API key via POST", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockCreateUserApiKey.mockResolvedValue({
      keyId: "key-1",
      apiKey: `mem_${"a".repeat(64)}`,
      keyPreview: "mem_aaaaaaaa********************aaaa",
      createdAt: "2026-02-21T00:00:00.000Z",
      expiresAt: validExpiry,
    })

    const response = await POST(
      new Request("http://localhost/api/mcp/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresAt: validExpiry }),
      })
    )

    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.apiKey).toMatch(/^mem_[a-f0-9]{64}$/)
    expect(body.keyId).toBe("key-1")
    expect(body.expiresAt).toBe(validExpiry)
    expect(body.message).toContain("Save this key")
  })

  it("returns 500 when key creation fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockCreateUserApiKey.mockRejectedValue(new Error("write failed"))

    const response = await POST(
      new Request("http://localhost/api/mcp/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresAt: validExpiry }),
      })
    )

    expect(response.status).toBe(500)
  })

  it("revokes all keys when DELETE has no keyId", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockRevokeUserApiKeys.mockResolvedValue({ revokedCount: 2 })

    const response = await DELETE(new Request("http://localhost/api/mcp/key", { method: "DELETE" }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.revokedCount).toBe(2)
  })

  it("returns 404 when keyId DELETE does not match a key", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockRevokeUserApiKeys.mockResolvedValue({ revokedCount: 0 })

    const response = await DELETE(
      new Request("http://localhost/api/mcp/key?keyId=missing-key", { method: "DELETE" })
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toContain("not found")
  })

  it("revokes a single key when keyId is provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockRevokeUserApiKeys.mockResolvedValue({ revokedCount: 1 })

    const response = await DELETE(
      new Request("http://localhost/api/mcp/key?keyId=key-1", { method: "DELETE" })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.revokedKeyId).toBe("key-1")
    expect(body.revokedCount).toBe(1)
  })
})
