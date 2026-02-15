import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockAdminFrom,
  mockCreateDatabase,
  mockCreateDatabaseToken,
  mockInitSchema,
  mockTursoExecute,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockCreateDatabase: vi.fn(),
  mockCreateDatabaseToken: vi.fn(),
  mockInitSchema: vi.fn(),
  mockTursoExecute: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  strictRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/turso", () => ({
  createDatabase: mockCreateDatabase,
  createDatabaseToken: mockCreateDatabaseToken,
  initSchema: mockInitSchema,
}))

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockTursoExecute,
  })),
}))

import { DELETE, GET, POST } from "../route"

describe("/api/mcp/tenants", () => {
  const expectedLink = '</api/sdk/v1/management/tenants>; rel="successor-version"'

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "owner@example.com" })
    mockCreateDatabase.mockResolvedValue({
      name: "memories-tenant-a",
      hostname: "tenant-a.turso.io",
      dbId: "db_1",
    })
    mockCreateDatabaseToken.mockResolvedValue("token-tenant-a")
    mockInitSchema.mockResolvedValue(undefined)
    mockTursoExecute.mockResolvedValue({ rows: [{ 1: 1 }] })
  })

  it("adds deprecation headers on GET unauthorized", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("http://localhost/api/mcp/tenants"))

    expect(response.headers.get("Deprecation")).toBe("true")
    expect(response.headers.get("Sunset")).toBe("Tue, 30 Jun 2026 00:00:00 GMT")
    expect(response.headers.get("Link")).toBe(expectedLink)
  })

  it("adds deprecation headers on POST validation errors", async () => {
    const request = new Request("http://localhost/api/mcp/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })

    const response = await POST(request)

    expect(response.headers.get("Deprecation")).toBe("true")
    expect(response.headers.get("Sunset")).toBe("Tue, 30 Jun 2026 00:00:00 GMT")
    expect(response.headers.get("Link")).toBe(expectedLink)
  })

  it("adds deprecation headers on DELETE validation errors", async () => {
    const response = await DELETE(new Request("http://localhost/api/mcp/tenants", {
      method: "DELETE",
    }))

    expect(response.headers.get("Deprecation")).toBe("true")
    expect(response.headers.get("Sunset")).toBe("Tue, 30 Jun 2026 00:00:00 GMT")
    expect(response.headers.get("Link")).toBe(expectedLink)
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("http://localhost/api/mcp/tenants"))
    expect(response.status).toBe(401)
  })

  it("returns 500 when api key lookup fails", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "db read failed" },
              }),
            }),
          }),
        }
      }

      return {}
    })

    const response = await GET(new Request("http://localhost/api/mcp/tenants"))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain("API key metadata")
  })

  it("lists tenant database mappings for the active API key", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  mcp_api_key_hash: "hash_123",
                  mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === "sdk_tenant_databases") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    tenant_id: "tenant-a",
                    turso_db_url: "libsql://tenant-a.turso.io",
                    turso_db_name: "memories-tenant-a",
                    status: "ready",
                    metadata: { plan: "pro" },
                    created_at: "2026-02-10T00:00:00.000Z",
                    updated_at: "2026-02-10T00:00:00.000Z",
                    last_verified_at: "2026-02-10T00:00:00.000Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        }
      }

      return {}
    })

    const response = await GET(new Request("http://localhost/api/mcp/tenants"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.count).toBe(1)
    expect(body.tenantDatabases[0]).toMatchObject({
      tenantId: "tenant-a",
      tursoDbUrl: "libsql://tenant-a.turso.io",
      tursoDbName: "memories-tenant-a",
      status: "ready",
    })
  })

  it("provisions a tenant database and stores mapping", async () => {
    let sdkCalls = 0
    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            tenant_id: "tenant-b",
            turso_db_url: "libsql://tenant-a.turso.io",
            turso_db_name: "memories-tenant-a",
            status: "ready",
            metadata: { env: "prod" },
            created_at: "2026-02-10T00:00:00.000Z",
            updated_at: "2026-02-10T00:00:00.000Z",
            last_verified_at: "2026-02-10T00:00:00.000Z",
          },
          error: null,
        }),
      }),
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  mcp_api_key_hash: "hash_123",
                  mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === "sdk_tenant_databases") {
        sdkCalls += 1
        if (sdkCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }

        return {
          upsert: upsertMock,
        }
      }

      return {}
    })

    const request = new Request("http://localhost/api/mcp/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant-b", mode: "provision", metadata: { env: "prod" } }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provisioned).toBe(true)
    expect(body.mode).toBe("provision")
    expect(body.tenantDatabase.tenantId).toBe("tenant-b")
    expect(mockCreateDatabase).toHaveBeenCalledOnce()
    expect(mockCreateDatabaseToken).toHaveBeenCalledOnce()
    expect(mockInitSchema).toHaveBeenCalledOnce()
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        api_key_hash: "hash_123",
        tenant_id: "tenant-b",
        status: "ready",
      }),
      { onConflict: "api_key_hash,tenant_id" }
    )
  })

  it("returns existing ready mapping without reprovisioning", async () => {
    let sdkCalls = 0
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  mcp_api_key_hash: "hash_123",
                  mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === "sdk_tenant_databases") {
        sdkCalls += 1
        if (sdkCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      tenant_id: "tenant-a",
                      turso_db_url: "libsql://tenant-a.turso.io",
                      turso_db_name: "memories-tenant-a",
                      status: "ready",
                      metadata: {},
                      created_at: "2026-02-10T00:00:00.000Z",
                      updated_at: "2026-02-10T00:00:00.000Z",
                      last_verified_at: "2026-02-10T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
      }

      return {}
    })

    const request = new Request("http://localhost/api/mcp/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant-a", mode: "provision" }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provisioned).toBe(false)
    expect(mockCreateDatabase).not.toHaveBeenCalled()
  })

  it("retries provisioning when an existing mapping is not ready", async () => {
    let sdkCalls = 0
    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            tenant_id: "tenant-retry",
            turso_db_url: "libsql://tenant-a.turso.io",
            turso_db_name: "memories-tenant-a",
            status: "ready",
            metadata: { attempt: 2 },
            created_at: "2026-02-10T00:00:00.000Z",
            updated_at: "2026-02-10T00:00:00.000Z",
            last_verified_at: "2026-02-10T00:00:00.000Z",
          },
          error: null,
        }),
      }),
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  mcp_api_key_hash: "hash_123",
                  mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === "sdk_tenant_databases") {
        sdkCalls += 1
        if (sdkCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      tenant_id: "tenant-retry",
                      turso_db_url: "libsql://old-tenant.turso.io",
                      turso_db_name: "old-db",
                      status: "error",
                      metadata: { attempt: 1 },
                      created_at: "2026-02-09T00:00:00.000Z",
                      updated_at: "2026-02-09T00:00:00.000Z",
                      last_verified_at: "2026-02-09T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }

        return {
          upsert: upsertMock,
        }
      }

      return {}
    })

    const response = await POST(
      new Request("http://localhost/api/mcp/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "tenant-retry", mode: "provision", metadata: { attempt: 2 } }),
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.provisioned).toBe(true)
    expect(mockCreateDatabase).toHaveBeenCalledOnce()
    expect(mockCreateDatabaseToken).toHaveBeenCalledOnce()
    expect(mockInitSchema).toHaveBeenCalledOnce()
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-retry",
        status: "ready",
      }),
      { onConflict: "api_key_hash,tenant_id" },
    )
  })

  it("rejects attach mode without libsql url", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  mcp_api_key_hash: "hash_123",
                  mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === "sdk_tenant_databases") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }
      }

      return {}
    })

    const request = new Request("http://localhost/api/mcp/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant-c", mode: "attach", tursoDbUrl: "https://invalid" }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(mockTursoExecute).not.toHaveBeenCalled()
  })

  it("disables an existing tenant mapping", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  mcp_api_key_hash: "hash_123",
                  mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === "sdk_tenant_databases") {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      tenant_id: "tenant-a",
                      status: "disabled",
                      updated_at: "2026-02-10T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      return {}
    })

    const response = await DELETE(new Request("http://localhost/api/mcp/tenants?tenantId=tenant-a", {
      method: "DELETE",
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe("disabled")
  })
})
