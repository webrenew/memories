import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockAdminFrom,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
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

import { GET } from "../route"

describe("/api/db/credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 without bearer auth", async () => {
    const request = new Request("http://localhost/api/db/credentials")
    const response = await GET(request as never)
    expect(response.status).toBe(401)
  })

  it("returns credentials for mcp api key auth", async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        turso_db_url: "libsql://demo.turso.io",
        turso_db_token: "token-123",
        turso_db_name: "demo-db",
      },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    mockAdminFrom.mockReturnValue({ select: mockSelect })

    const request = new Request("http://localhost/api/db/credentials", {
      headers: { authorization: "Bearer mcp_testkey" },
    })

    const response = await GET(request as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockEq).toHaveBeenCalledWith("mcp_api_key", "mcp_testkey")
    expect(body).toMatchObject({
      url: "libsql://demo.turso.io",
      token: "token-123",
      dbName: "demo-db",
      turso_db_url: "libsql://demo.turso.io",
      turso_db_token: "token-123",
      turso_db_name: "demo-db",
    })
  })

  it("returns credentials for cli/session auth", async () => {
    mockAuthenticateRequest.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
    })

    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        turso_db_url: "libsql://userdb.turso.io",
        turso_db_token: "token-xyz",
        turso_db_name: "userdb",
      },
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
    expect(mockEq).toHaveBeenCalledWith("id", "user-1")
    expect(body.url).toBe("libsql://userdb.turso.io")
    expect(body.token).toBe("token-xyz")
    expect(body.dbName).toBe("userdb")
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
