import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockAdminFrom,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAdminFrom: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

import { POST } from "./route"

describe("/api/workspace/switch-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await POST(
      new Request("https://example.com/api/workspace/switch-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ success: true }),
      }),
    )

    expect(response.status).toBe(401)
  })

  it("records profile telemetry", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "u@example.com" })

    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "workspace_switch_profile_events") {
        return { insert: mockInsert }
      }
      return {}
    })

    const response = await POST(
      new Request("https://example.com/api/workspace/switch-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: true,
          from_org_id: null,
          to_org_id: "org-1",
          client_total_ms: 740,
          user_patch_ms: 110,
          workspace_prefetch_ms: 370,
          integration_health_prefetch_ms: 220,
          workspace_summary_total_ms: 320,
          workspace_summary_query_ms: 140,
          workspace_summary_org_count: 14,
          workspace_summary_workspace_count: 15,
          workspace_summary_response_bytes: 126000,
          include_summaries: true,
          cache_mode: "force-cache",
        }),
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        to_org_id: "org-1",
        success: true,
        client_total_ms: 740,
        workspace_summary_org_count: 14,
      }),
    )
  })
})
