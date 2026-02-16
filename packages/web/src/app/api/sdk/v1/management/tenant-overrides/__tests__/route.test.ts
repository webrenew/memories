import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockGetApiKey,
  mockAuthenticateApiKey,
  mockAdminFrom,
  mockEnforceSdkProjectProvisionLimit,
  mockCountActiveProjectsForBillingContext,
  mockRecordGrowthProjectMeterEvent,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockAuthenticateApiKey: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockEnforceSdkProjectProvisionLimit: vi.fn(),
  mockCountActiveProjectsForBillingContext: vi.fn(),
  mockRecordGrowthProjectMeterEvent: vi.fn(),
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

vi.mock("@/lib/sdk-project-billing", () => ({
  enforceSdkProjectProvisionLimit: mockEnforceSdkProjectProvisionLimit,
  countActiveProjectsForBillingContext: mockCountActiveProjectsForBillingContext,
  recordGrowthProjectMeterEvent: mockRecordGrowthProjectMeterEvent,
}))

vi.mock("@/lib/sdk-api/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sdk-api/runtime")>("@/lib/sdk-api/runtime")
  return {
    ...actual,
    getApiKey: mockGetApiKey,
    authenticateApiKey: mockAuthenticateApiKey,
  }
})

vi.mock("@/lib/turso", () => ({
  createDatabase: vi.fn(),
  createDatabaseToken: vi.fn(),
  initSchema: vi.fn(),
}))

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: vi.fn(),
  })),
}))

import { DELETE, GET, POST } from "../route"

describe("/api/sdk/v1/management/tenant-overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetApiKey.mockReturnValue("mem_test_key")
    mockAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      apiKeyHash: "hash_123",
    })
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "owner@example.com" })
    mockCheckRateLimit.mockResolvedValue(null)

    mockEnforceSdkProjectProvisionLimit.mockResolvedValue({
      ok: true,
      billing: {
        plan: "growth",
        ownerType: "user",
        ownerUserId: "user-1",
        orgId: null,
        stripeCustomerId: "cus_123",
        includedProjects: 500,
        overageUsdPerProject: 0.05,
        maxProjectsPerMonth: null,
      },
      activeProjectCount: 1,
    })
    mockCountActiveProjectsForBillingContext.mockResolvedValue(1)
    mockRecordGrowthProjectMeterEvent.mockResolvedValue(undefined)
  })

  it("lists tenant overrides with sdk envelope", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "sdk_tenant_databases") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    tenant_id: "tenant-a",
                    turso_db_url: "libsql://tenant-a.turso.io",
                    turso_db_name: "tenant-a",
                    status: "ready",
                    metadata: {},
                    created_at: "2026-02-11T00:00:00.000Z",
                    updated_at: "2026-02-11T00:00:00.000Z",
                    last_verified_at: "2026-02-11T00:00:00.000Z",
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

    const response = await GET(new Request("https://example.com", { method: "GET" }) as never)
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.ok).toBe(true)
    expect(body.meta.endpoint).toBe("/api/sdk/v1/management/tenant-overrides")
    expect(body.data.count).toBe(1)
    expect(body.data.tenantDatabases[0].tenantId).toBe("tenant-a")
  })

  it("returns unauthorized envelope when session auth fails and no api key is present", async () => {
    mockGetApiKey.mockReturnValue(null)
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("https://example.com", { method: "GET" }) as never)
    expect(response.status).toBe(401)
    const body = await response.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("returns invalid request envelope for malformed POST payload", async () => {
    const response = await POST(
      new Request("https://example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as never
    )
    expect(response.status).toBe(400)
    const body = await response.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns growth gating envelope when billing check denies provisioning", async () => {
    mockEnforceSdkProjectProvisionLimit.mockResolvedValue({
      ok: false,
      status: 403,
      code: "GROWTH_PLAN_REQUIRED",
      message: "AI SDK project routing requires the Growth plan.",
    })

    const response = await POST(
      new Request("https://example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "tenant-b", mode: "provision" }),
      }) as never
    )
    expect(response.status).toBe(403)
    const body = await response.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("GROWTH_PLAN_REQUIRED")
  })

  it("returns invalid request envelope when DELETE misses tenantId", async () => {
    const response = await DELETE(new Request("https://example.com", { method: "DELETE" }) as never)
    expect(response.status).toBe(400)
    const body = await response.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })
})
