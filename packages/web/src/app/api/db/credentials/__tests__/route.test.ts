import { beforeEach, describe, expect, it, vi } from "vitest"
import { hashMcpApiKey } from "@/lib/mcp-api-key"

const {
  mockAuthenticateRequest,
  mockAdminFrom,
  mockCheckRateLimit,
  mockResolveActiveMemoryContext,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockResolveActiveMemoryContext: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/active-memory-context", () => ({
  resolveActiveMemoryContext: mockResolveActiveMemoryContext,
}))

import { GET } from "../route"

const VALID_API_KEY = `mem_${"a".repeat(64)}`

describe("/api/db/credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockResolveActiveMemoryContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      turso_db_url: "libsql://demo.turso.io",
      turso_db_token: "token-123",
      turso_db_name: "demo-db",
    })
  })

  it("returns 401 without bearer auth", async () => {
    const request = new Request("http://localhost/api/db/credentials")
    const response = await GET(request as never)
    expect(response.status).toBe(401)
  })

  it("returns credentials for mcp api key auth", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: "user-mcp-1", mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z" },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    mockAdminFrom.mockReturnValue({ select: mockSelect })

    const request = new Request("http://localhost/api/db/credentials", {
      headers: { authorization: `Bearer ${VALID_API_KEY}` },
    })

    const response = await GET(request as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockEq).toHaveBeenCalledWith("mcp_api_key_hash", hashMcpApiKey(VALID_API_KEY))
    expect(mockResolveActiveMemoryContext).toHaveBeenCalledWith(expect.anything(), "user-mcp-1")
    expect(body).toMatchObject({
      url: "libsql://demo.turso.io",
      token: "token-123",
      dbName: "demo-db",
      turso_db_url: "libsql://demo.turso.io",
      turso_db_token: "token-123",
      turso_db_name: "demo-db",
    })
  })

  it("returns 401 when mcp key is expired", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: "user-mcp-1", mcp_api_key_expires_at: "2020-01-01T00:00:00.000Z" },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    mockAdminFrom.mockReturnValue({ select: mockSelect })

    const request = new Request("http://localhost/api/db/credentials", {
      headers: { authorization: `Bearer ${VALID_API_KEY}` },
    })

    const response = await GET(request as never)
    expect(response.status).toBe(401)
  })

  it("returns credentials for cli/session auth", async () => {
    mockAuthenticateRequest.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    })

    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: "ignored-for-cli" },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    mockAdminFrom.mockReturnValue({ select: mockSelect })

    const request = new Request("http://localhost/api/db/credentials", {
      headers: { authorization: "Bearer cli_abc123" },
    })

    const response = await GET(request as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(1)
    expect(mockResolveActiveMemoryContext).toHaveBeenCalledWith(expect.anything(), "user-1")
    expect(body.url).toBe("libsql://demo.turso.io")
    expect(body.token).toBe("token-123")
    expect(body.dbName).toBe("demo-db")
  })

  it("returns personal credentials when org membership is revoked", async () => {
    mockAuthenticateRequest.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    })
    mockResolveActiveMemoryContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      turso_db_url: "libsql://personal.turso.io",
      turso_db_token: "personal-token",
      turso_db_name: "personal-db",
    })

    const request = new Request("http://localhost/api/db/credentials", {
      headers: { authorization: "Bearer cli_abc123" },
    })

    const response = await GET(request as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ownerType).toBe("user")
    expect(body.orgId).toBeNull()
    expect(body.url).toBe("libsql://personal.turso.io")
    expect(body.token).toBe("personal-token")
    expect(body.dbName).toBe("personal-db")
  })

  it("returns 401 when cli auth fails", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const request = new Request("http://localhost/api/db/credentials", {
      headers: { authorization: "Bearer cli_invalid" },
    })

    const response = await GET(request as never)
    expect(response.status).toBe(401)
  })
})
