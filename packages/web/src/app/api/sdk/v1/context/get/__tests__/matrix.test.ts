import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { mockUserSelect, mockTenantSelect, mockResolveActiveMemoryContext, mockExecute } = vi.hoisted(() => ({
  mockUserSelect: vi.fn(),
  mockTenantSelect: vi.fn(),
  mockResolveActiveMemoryContext: vi.fn(),
  mockExecute: vi.fn(),
}))

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

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
  })),
}))

import { POST } from "../route"

const VALID_API_KEY = `mcp_${"a".repeat(64)}`

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("https://example.com/api/sdk/v1/context/get", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${VALID_API_KEY}`,
    },
    body: JSON.stringify(body),
  })
}

function getExecuteCallBySqlFragment(fragment: string): { sql: string; args?: unknown[] } {
  const call = mockExecute.mock.calls.find((entry) => {
    const input = entry[0] as { sql?: string } | string
    const sql = typeof input === "string" ? input : input.sql
    return typeof sql === "string" && sql.includes(fragment)
  })?.[0] as { sql: string; args?: unknown[] } | undefined

  if (!call) {
    throw new Error(`Expected Turso execute call containing SQL fragment: ${fragment}`)
  }
  return call
}

describe("/api/sdk/v1/context/get isolation matrix", () => {
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
  })

  it.each([
    {
      name: "default workspace shared scope",
      body: { query: "architecture" },
      expectedUserClause: "m.user_id IS NULL",
      expectedUserArg: null,
      tenantId: null,
    },
    {
      name: "tenant workspace with user scope",
      body: {
        query: "architecture",
        scope: {
          tenantId: "tenant-a",
          userId: "user-42",
        },
      },
      expectedUserClause: "m.user_id IS NULL OR m.user_id = ?",
      expectedUserArg: "user-42",
      tenantId: "tenant-a",
    },
  ])("enforces isolation and tier order ($name)", async ({ body, expectedUserClause, expectedUserArg, tenantId }) => {
    if (tenantId) {
      mockTenantSelect.mockReturnValue({
        data: {
          turso_db_url: "libsql://tenant-a.turso.io",
          turso_db_token: "tenant-token",
          status: "ready",
        },
        error: null,
      })
    }

    mockExecute.mockImplementation(async (input: { sql: string } | string) => {
      const sql = typeof input === "string" ? input : input.sql

      if (sql.includes("memory_layer = 'rule'") || sql.includes("type = 'rule'")) {
        return {
          rows: [
            {
              id: "r1",
              content: "Always validate input",
              type: "rule",
              memory_layer: "rule",
              scope: "global",
              project_id: null,
              user_id: null,
              tags: null,
              paths: null,
              category: null,
              metadata: null,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
              expires_at: null,
            },
          ],
        }
      }

      if (sql.includes("m.memory_layer = 'working'")) {
        return {
          rows: [
            {
              id: "w1",
              content: "In-flight migration context",
              type: "note",
              memory_layer: "working",
              scope: "global",
              project_id: null,
              user_id: expectedUserArg,
              tags: null,
              paths: null,
              category: null,
              metadata: null,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-02T00:00:00.000Z",
              expires_at: "2099-01-01T00:00:00.000Z",
            },
          ],
        }
      }

      if (sql.includes("m.memory_layer IS NULL OR m.memory_layer = 'long_term'")) {
        return {
          rows: [
            {
              id: "l1",
              content: "Persisted architecture decision",
              type: "decision",
              memory_layer: "long_term",
              scope: "global",
              project_id: null,
              user_id: expectedUserArg,
              tags: null,
              paths: null,
              category: null,
              metadata: null,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
              expires_at: null,
            },
          ],
        }
      }

      return { rows: [] }
    })

    const response = await POST(makePostRequest(body))
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.data.memories.map((memory: { id: string }) => memory.id)).toEqual(["w1", "l1"])
    expect(payload.data.workingMemories.map((memory: { id: string }) => memory.id)).toEqual(["w1"])
    expect(payload.data.longTermMemories.map((memory: { id: string }) => memory.id)).toEqual(["l1"])

    const workingCall = getExecuteCallBySqlFragment("m.memory_layer = 'working'")
    const longTermCall = getExecuteCallBySqlFragment("m.memory_layer IS NULL OR m.memory_layer = 'long_term'")
    expect(workingCall.sql).toContain(expectedUserClause)
    expect(longTermCall.sql).toContain(expectedUserClause)

    if (expectedUserArg) {
      expect(workingCall.args).toContain(expectedUserArg)
      expect(longTermCall.args).toContain(expectedUserArg)
    }

    if (tenantId) {
      const tenantLookup = mockTenantSelect.mock.calls[0]?.[0] as { filters?: Record<string, string> }
      expect(tenantLookup.filters?.tenant_id).toBe(tenantId)
    }
  })
})
