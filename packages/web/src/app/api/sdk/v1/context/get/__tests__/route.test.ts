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
        const runSingle = () => {
          if (table === "users") {
            return mockUserSelect({ table, filters })
          }
          if (table === "sdk_tenant_databases") {
            return mockTenantSelect({ table, filters })
          }
          return { data: null, error: { message: `Unexpected table: ${table}` } }
        }
        const query = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value
            return query
          }),
          single: vi.fn(runSingle),
          maybeSingle: vi.fn(runSingle),
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

const VALID_API_KEY = `mem_${"a".repeat(64)}`

function normalizeEnvelope(body: Record<string, unknown>) {
  return {
    ...body,
    meta: {
      ...(typeof body.meta === "object" && body.meta ? body.meta : {}),
      requestId: "<request-id>",
      timestamp: "<timestamp>",
    },
  }
}

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

    mockTenantSelect.mockReturnValue({ data: null, error: null })

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
        trace: {
          strategy: "baseline",
          graphDepth: 0,
          graphLimit: 0,
          baselineCandidates: 2,
          graphCandidates: 0,
          graphExpandedCount: 0,
          totalCandidates: 2,
        },
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
          strategy: "hybrid",
          graphDepth: 2,
          graphLimit: 12,
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
    expect(body.data.trace.strategy).toBe("baseline")
    expect(body.meta.endpoint).toBe("/api/sdk/v1/context/get")
    expect(typeof body.meta.requestId).toBe("string")

    expect(mockGetContextPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "github.com/acme/platform",
        query: "auth",
        userId: "end-user-1",
        retrievalStrategy: "hybrid_graph",
        graphDepth: 2,
        graphLimit: 12,
      })
    )
    expect(mockResolveActiveMemoryContext).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        projectId: "github.com/acme/platform",
        fallbackToUserWithoutOrgCredentials: true,
      })
    )
  })

  it("maps semantic strategy requests to baseline retrieval", async () => {
    const response = await POST(
      makePostRequest(
        {
          query: "auth",
          strategy: "semantic",
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    expect(mockGetContextPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "auth",
        userId: "end-user-1",
        retrievalStrategy: "baseline",
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

  it("matches sdk context success envelope contract snapshot", async () => {
    const response = await POST(
      makePostRequest(
        {
          query: "auth",
          scope: { userId: "end-user-1", projectId: "github.com/acme/platform" },
        },
        VALID_API_KEY
      )
    )

    const body = (await response.json()) as Record<string, unknown>
    expect(normalizeEnvelope(body)).toMatchInlineSnapshot(`
      {
        "data": {
          "longTermMemories": [
            {
              "content": "Long-term context",
              "id": "l1",
              "layer": "long_term",
              "type": "fact",
            },
          ],
          "memories": [
            {
              "content": "Working context",
              "id": "w1",
              "layer": "working",
              "type": "note",
            },
            {
              "content": "Long-term context",
              "id": "l1",
              "layer": "long_term",
              "type": "fact",
            },
          ],
          "mode": "all",
          "query": "auth",
          "rules": [
            {
              "content": "Always test",
              "id": "r1",
              "layer": "rule",
              "type": "rule",
            },
          ],
          "skillFiles": [],
          "trace": {
            "baselineCandidates": 2,
            "graphCandidates": 0,
            "graphDepth": 0,
            "graphExpandedCount": 0,
            "graphLimit": 0,
            "strategy": "baseline",
            "totalCandidates": 2,
          },
          "workingMemories": [
            {
              "content": "Working context",
              "id": "w1",
              "layer": "working",
              "type": "note",
            },
          ],
        },
        "error": null,
        "meta": {
          "endpoint": "/api/sdk/v1/context/get",
          "requestId": "<request-id>",
          "timestamp": "<timestamp>",
          "version": "2026-02-11",
        },
        "ok": true,
      }
    `)
  })

  it("matches sdk context error envelope contract snapshot", async () => {
    const response = await POST(makePostRequest({ query: "auth", limit: -1 }, VALID_API_KEY))
    const body = (await response.json()) as Record<string, unknown>

    expect(normalizeEnvelope(body)).toMatchInlineSnapshot(`
      {
        "data": null,
        "error": {
          "code": "INVALID_REQUEST",
          "message": "Invalid request payload",
          "retryable": false,
          "status": 400,
          "type": "validation_error",
        },
        "meta": {
          "endpoint": "/api/sdk/v1/context/get",
          "requestId": "<request-id>",
          "timestamp": "<timestamp>",
          "version": "2026-02-11",
        },
        "ok": false,
      }
    `)
  })
})
