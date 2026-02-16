import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockGetApiKey,
  mockAuthenticateApiKey,
  mockAdminFrom,
  mockResolveSdkProjectBillingContext,
  mockEnforceSdkProjectProvisionLimit,
  mockShouldAutoProvisionTenants,
  mockHasTursoPlatformApiToken,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockAuthenticateApiKey: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockResolveSdkProjectBillingContext: vi.fn(),
  mockEnforceSdkProjectProvisionLimit: vi.fn(),
  mockShouldAutoProvisionTenants: vi.fn(),
  mockHasTursoPlatformApiToken: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/sdk-api/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sdk-api/runtime")>("@/lib/sdk-api/runtime")
  return {
    ...actual,
    getApiKey: mockGetApiKey,
    authenticateApiKey: mockAuthenticateApiKey,
  }
})

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
  })),
}))

vi.mock("@/lib/env", () => ({
  shouldAutoProvisionTenants: mockShouldAutoProvisionTenants,
  hasTursoPlatformApiToken: mockHasTursoPlatformApiToken,
}))

vi.mock("@/lib/sdk-project-billing", () => ({
  resolveSdkProjectBillingContext: mockResolveSdkProjectBillingContext,
  enforceSdkProjectProvisionLimit: mockEnforceSdkProjectProvisionLimit,
  buildSdkTenantOwnerScopeKey: vi.fn(
    (input: { ownerType: "user" | "organization"; ownerUserId: string; orgId: string | null }) =>
      input.ownerType === "organization" && input.orgId ? `org:${input.orgId}` : `user:${input.ownerUserId}`
  ),
}))

import { GET } from "../route"

function usersTable(payload: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(payload),
      }),
    }),
  }
}

function tenantMappingTable(payload: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn((_column: string, _value: unknown) => query),
    maybeSingle: vi.fn().mockResolvedValue(payload),
  }

  return {
    select: vi.fn().mockReturnValue(query),
  }
}

describe("/api/sdk/v1/management/tenant-routing/effective", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetApiKey.mockReturnValue(null)
    mockAuthenticateApiKey.mockResolvedValue({ userId: "user-1", apiKeyHash: "hash_123" })
    mockAuthenticateRequest.mockResolvedValue({ userId: "user-1", email: "owner@example.com" })
    mockCheckRateLimit.mockResolvedValue(null)

    mockShouldAutoProvisionTenants.mockReturnValue(true)
    mockHasTursoPlatformApiToken.mockReturnValue(true)

    mockResolveSdkProjectBillingContext.mockResolvedValue({
      plan: "growth",
      ownerType: "user",
      ownerUserId: "user-1",
      orgId: null,
      ownerScopeKey: "user:user-1",
      stripeCustomerId: "cus_123",
      includedProjects: 500,
      overageUsdPerProject: 0.05,
      maxProjectsPerMonth: null,
    })

    mockEnforceSdkProjectProvisionLimit.mockResolvedValue({
      ok: true,
      billing: {
        plan: "growth",
        ownerType: "user",
        ownerUserId: "user-1",
        orgId: null,
        ownerScopeKey: "user:user-1",
        stripeCustomerId: "cus_123",
        includedProjects: 500,
        overageUsdPerProject: 0.05,
        maxProjectsPerMonth: null,
      },
      activeProjectCount: 1,
    })
  })

  it("returns unauthorized envelope when not authenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("https://example.com/api/sdk/v1/management/tenant-routing/effective?tenantId=t1") as never)
    expect(response.status).toBe(401)

    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("returns invalid request when tenantId is missing", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersTable({
          data: {
            mcp_api_key_hash: "hash_123",
            mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        })
      }

      return {}
    })

    const response = await GET(new Request("https://example.com/api/sdk/v1/management/tenant-routing/effective") as never)
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("returns ready mapping details when tenant mapping is routable", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersTable({
          data: {
            mcp_api_key_hash: "hash_123",
            mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        })
      }

      if (table === "sdk_tenant_databases") {
        return tenantMappingTable({
          data: {
            tenant_id: "tenant-a",
            turso_db_url: "libsql://tenant-a.turso.io",
            turso_db_token: "token-a",
            turso_db_name: "tenant-a",
            status: "ready",
            mapping_source: "override",
            metadata: {},
            updated_at: "2026-02-16T00:00:00.000Z",
            last_verified_at: "2026-02-16T00:00:00.000Z",
          },
          error: null,
        })
      }

      return {}
    })

    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/tenant-routing/effective?tenantId=tenant-a") as never
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.mapping.exists).toBe(true)
    expect(body.data.mapping.source).toBe("override")
    expect(body.data.resolvedTarget.kind).toBe("tenant_database")
    expect(body.data.decision.code).toBe("MAPPING_READY")
    expect(body.data.ownerScope.key).toBe("user:user-1")
  })

  it("returns auto-provision eligible decision when mapping is missing", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersTable({
          data: {
            mcp_api_key_hash: "hash_123",
            mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        })
      }

      if (table === "sdk_tenant_databases") {
        return tenantMappingTable({ data: null, error: null })
      }

      return {}
    })

    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/tenant-routing/effective?tenantId=tenant-missing") as never
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.mapping.exists).toBe(false)
    expect(body.data.decision.code).toBe("AUTO_PROVISION_ELIGIBLE")
    expect(body.data.decision.billingEligible).toBe(true)
  })

  it("returns auto-provision blocked decision when billing gate fails", async () => {
    mockEnforceSdkProjectProvisionLimit.mockResolvedValue({
      ok: false,
      status: 403,
      code: "GROWTH_PLAN_REQUIRED",
      message: "AI SDK project routing requires the Growth plan.",
    })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return usersTable({
          data: {
            mcp_api_key_hash: "hash_123",
            mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
          },
          error: null,
        })
      }

      if (table === "sdk_tenant_databases") {
        return tenantMappingTable({ data: null, error: null })
      }

      return {}
    })

    const response = await GET(
      new Request("https://example.com/api/sdk/v1/management/tenant-routing/effective?tenantId=tenant-missing") as never
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.decision.code).toBe("AUTO_PROVISION_BLOCKED")
    expect(body.data.decision.billingEligible).toBe(false)
    expect(body.data.decision.billingCode).toBe("GROWTH_PLAN_REQUIRED")
  })
})
