import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  mockUserSelect,
  mockTenantSelect,
  mockResolveActiveMemoryContext,
  mockStartSessionPayload,
  mockCheckpointSessionPayload,
  mockEndSessionPayload,
  mockGetLatestSessionSnapshotPayload,
  mockExecute,
} = vi.hoisted(() => ({
  mockUserSelect: vi.fn(),
  mockTenantSelect: vi.fn(),
  mockResolveActiveMemoryContext: vi.fn(),
  mockStartSessionPayload: vi.fn(),
  mockCheckpointSessionPayload: vi.fn(),
  mockEndSessionPayload: vi.fn(),
  mockGetLatestSessionSnapshotPayload: vi.fn(),
  mockExecute: vi.fn(),
}))

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

vi.mock("@/lib/memory-service/sessions", () => ({
  startSessionPayload: mockStartSessionPayload,
  checkpointSessionPayload: mockCheckpointSessionPayload,
  endSessionPayload: mockEndSessionPayload,
  getLatestSessionSnapshotPayload: mockGetLatestSessionSnapshotPayload,
}))

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
  })),
}))

import { POST as startPOST } from "../start/route"
import { POST as checkpointPOST } from "../checkpoint/route"
import { POST as endPOST } from "../end/route"
import { GET as snapshotGET } from "../[sessionId]/snapshot/route"
import { ToolExecutionError, apiError } from "@/lib/memory-service/tools"

const VALID_API_KEY = `mem_${"a".repeat(64)}`

function makePost(path: string, body: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  return new NextRequest(`https://example.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

function makeGet(path: string, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  return new NextRequest(`https://example.com${path}`, {
    method: "GET",
    headers,
  })
}

describe("/api/sdk/v1/sessions/*", () => {
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

    mockExecute.mockResolvedValue({ rows: [] })

    mockStartSessionPayload.mockResolvedValue({
      text: "Started session sess_1",
      data: {
        sessionId: "sess_1",
        message: "Started session sess_1",
        session: {
          id: "sess_1",
          scope: "project",
          projectId: "github.com/acme/platform",
          userId: "end-user-1",
          status: "active",
        },
      },
    })

    mockCheckpointSessionPayload.mockResolvedValue({
      text: "Checkpointed session sess_1",
      data: {
        sessionId: "sess_1",
        eventId: "evt_1",
        message: "Checkpointed session sess_1",
        event: {
          id: "evt_1",
          sessionId: "sess_1",
          kind: "checkpoint",
          role: "assistant",
          content: "Saved key context",
        },
      },
    })

    mockEndSessionPayload.mockResolvedValue({
      text: "Ended session sess_1 as closed",
      data: {
        sessionId: "sess_1",
        message: "Ended session sess_1 as closed",
        session: {
          id: "sess_1",
          status: "closed",
          endedAt: "2026-02-26T00:00:00.000Z",
        },
      },
    })

    mockGetLatestSessionSnapshotPayload.mockResolvedValue({
      text: "Latest snapshot for session sess_1",
      data: {
        sessionId: "sess_1",
        message: "Latest snapshot for session sess_1",
        snapshot: {
          id: "snap_1",
          sessionId: "sess_1",
          slug: "manual-snapshot",
          sourceTrigger: "manual",
          transcriptMd: "# snapshot",
          messageCount: 3,
          createdAt: "2026-02-26T00:00:00.000Z",
        },
      },
    })
  })

  it("start returns 201 envelope and forwards scope args", async () => {
    const response = await startPOST(
      makePost(
        "/api/sdk/v1/sessions/start",
        {
          title: "Build memory plan",
          client: "codex",
          scope: {
            projectId: "github.com/acme/platform",
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.sessionId).toBe("sess_1")
    expect(mockStartSessionPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "github.com/acme/platform",
        userId: "end-user-1",
      })
    )
  })

  it("checkpoint returns 200 envelope", async () => {
    const response = await checkpointPOST(
      makePost(
        "/api/sdk/v1/sessions/checkpoint",
        {
          sessionId: "sess_1",
          content: "Saved key context",
          role: "assistant",
          kind: "checkpoint",
          scope: {
            projectId: "github.com/acme/platform",
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.eventId).toBe("evt_1")
  })

  it("end returns 200 envelope", async () => {
    const response = await endPOST(
      makePost(
        "/api/sdk/v1/sessions/end",
        {
          sessionId: "sess_1",
          status: "closed",
          scope: {
            projectId: "github.com/acme/platform",
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.session.status).toBe("closed")
  })

  it("snapshot GET returns 200 envelope", async () => {
    const response = await snapshotGET(
      makeGet(
        "/api/sdk/v1/sessions/sess_1/snapshot?projectId=github.com/acme/platform&userId=end-user-1",
        VALID_API_KEY
      ),
      {
        params: Promise.resolve({ sessionId: "sess_1" }),
      }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.snapshot.id).toBe("snap_1")
    expect(mockGetLatestSessionSnapshotPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        projectId: "github.com/acme/platform",
        userId: "end-user-1",
      })
    )
  })

  it("returns 401 when API key is missing", async () => {
    const response = await startPOST(
      makePost("/api/sdk/v1/sessions/start", {
        title: "no auth",
      })
    )

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("MISSING_API_KEY")
  })

  it("propagates tool execution errors for checkpoint", async () => {
    mockCheckpointSessionPayload.mockRejectedValueOnce(
      new ToolExecutionError(
        apiError({
          type: "not_found_error",
          code: "SESSION_NOT_FOUND",
          message: "Session not found: sess_404",
          status: 404,
          retryable: false,
        })
      )
    )

    const response = await checkpointPOST(
      makePost(
        "/api/sdk/v1/sessions/checkpoint",
        {
          sessionId: "sess_404",
          content: "missing",
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("SESSION_NOT_FOUND")
  })
})
