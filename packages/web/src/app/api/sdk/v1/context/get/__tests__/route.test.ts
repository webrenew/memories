import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { mockUserSelect, mockTenantSelect, mockResolveActiveMemoryContext, mockGetContextPayload, mockExecute } = vi.hoisted(
  () => ({
    mockUserSelect: vi.fn(),
    mockTenantSelect: vi.fn(),
    mockResolveActiveMemoryContext: vi.fn(),
    mockGetContextPayload: vi.fn(),
    mockExecute: vi.fn(),
  })
)

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const filters: Record<string, unknown> = {}
        const query = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value
            return query
          }),
          single: vi.fn(() => {
            if (table === "users") {
              return mockUserSelect({ table, filters })
            }
            if (table === "sdk_tenant_databases") {
              return mockTenantSelect({ table, filters })
            }
            return { data: null, error: { message: `Unexpected table: ${table}` } }
          }),
        }
        return query
      }),
    })),
  })),
}))

vi.mock("@/lib/active-memory-context", () => ({
  resolveActiveMemoryContext: mockResolveActiveMemoryContext,
}))

vi.mock("@/lib/rate-limit", () => ({
  mcpRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/memory-service/queries", () => ({
  getContextPayload: mockGetContextPayload,
}))

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
  })),
}))

import { OPTIONS, POST } from "../route"

const VALID_API_KEY = `mcp_${"a".repeat(64)}`

function makePostRequest(body: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  return new NextRequest("https://example.com/api/sdk/v1/context/get", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

describe("/api/sdk/v1/context/get", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUserSelect.mockReturnValue({
      data: {
        id: "user-1",
        mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
      },
      error: null,
    })

    mockTenantSelect.mockReturnValue({ data: null, error: { message: "not found" } })

    mockResolveActiveMemoryContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      turso_db_url: "libsql://default-db.turso.io",
      turso_db_token: "default-token",
      turso_db_name: "default-db",
    })

    mockGetContextPayload.mockResolvedValue({
      text: "## Global Rules\n- Always test",
      data: {
        rules: [{ id: "r1", content: "Always test", type: "rule", layer: "rule" }],
        workingMemories: [{ id: "w1", content: "Working context", type: "note", layer: "working" }],
        longTermMemories: [{ id: "l1", content: "Long-term context", type: "fact", layer: "long_term" }],
        memories: [
          { id: "w1", content: "Working context", type: "note", layer: "working" },
          { id: "l1", content: "Long-term context", type: "fact", layer: "long_term" },
        ],
      },
    })

    mockExecute.mockResolvedValue({ rows: [] })
  })

  it("returns 401 when API key is missing", async () => {
    const response = await POST(makePostRequest({ query: "auth" }))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("MISSING_API_KEY")
  })

  it("returns 400 for invalid request payload", async () => {
    const response = await POST(
      makePostRequest(
        {
          query: "auth",
          limit: -1,
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns filtered context by mode and includeRules", async () => {
    const response = await POST(
      makePostRequest(
        {
          query: "auth",
          mode: "working",
          includeRules: false,
          scope: {
            userId: "end-user-1",
            projectId: "github.com/acme/platform",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.mode).toBe("working")
    expect(body.data.rules).toEqual([])
    expect(body.data.memories).toEqual([{ id: "w1", content: "Working context", type: "note", layer: "working" }])
    expect(body.meta.endpoint).toBe("/api/sdk/v1/context/get")
    expect(typeof body.meta.requestId).toBe("string")

    expect(mockGetContextPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "github.com/acme/platform",
        query: "auth",
        userId: "end-user-1",
      })
    )
  })

  it("routes to tenant database when tenantId is provided", async () => {
    mockTenantSelect.mockReturnValue({
      data: {
        turso_db_url: "libsql://tenant-db.turso.io",
        turso_db_token: "tenant-token",
        status: "ready",
      },
      error: null,
    })

    const response = await POST(
      makePostRequest(
        {
          query: "auth",
          scope: {
            tenantId: "tenant-a",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    expect(mockTenantSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ tenant_id: "tenant-a" }),
      })
    )
  })

  it("returns typed tenant error when tenant db is not ready", async () => {
    mockTenantSelect.mockReturnValue({
      data: {
        turso_db_url: "libsql://tenant-db.turso.io",
        turso_db_token: "tenant-token",
        status: "provisioning",
      },
      error: null,
    })

    const response = await POST(
      makePostRequest(
        {
          query: "auth",
          scope: {
            tenantId: "tenant-a",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("TENANT_DATABASE_NOT_READY")
  })

  it("returns CORS headers on OPTIONS", async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS")
  })
})
