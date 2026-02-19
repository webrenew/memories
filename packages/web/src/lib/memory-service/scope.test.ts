import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAdminFrom,
  mockCreateDatabase,
  mockCreateDatabaseToken,
  mockDeleteDatabase,
  mockInitSchema,
  mockEnforceSdkProjectProvisionLimit,
  mockRecordGrowthProjectMeterEvent,
  mockResolveSdkProjectBillingContext,
  mockShouldAutoProvisionTenants,
  mockHasTursoPlatformApiToken,
  mockGetTursoOrgSlug,
  mockDelay,
  mockCreateTurso,
} = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
  mockCreateDatabase: vi.fn(),
  mockCreateDatabaseToken: vi.fn(),
  mockDeleteDatabase: vi.fn(),
  mockInitSchema: vi.fn(),
  mockEnforceSdkProjectProvisionLimit: vi.fn(),
  mockRecordGrowthProjectMeterEvent: vi.fn(),
  mockResolveSdkProjectBillingContext: vi.fn(),
  mockShouldAutoProvisionTenants: vi.fn(),
  mockHasTursoPlatformApiToken: vi.fn(),
  mockGetTursoOrgSlug: vi.fn(),
  mockDelay: vi.fn(),
  mockCreateTurso: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}))

vi.mock("@/lib/turso", () => ({
  createDatabase: mockCreateDatabase,
  createDatabaseToken: mockCreateDatabaseToken,
  deleteDatabase: mockDeleteDatabase,
  initSchema: mockInitSchema,
}))

vi.mock("@/lib/env", () => ({
  getTursoOrgSlug: mockGetTursoOrgSlug,
  hasTursoPlatformApiToken: mockHasTursoPlatformApiToken,
  shouldAutoProvisionTenants: mockShouldAutoProvisionTenants,
}))

vi.mock("@/lib/sdk-project-billing", () => ({
  resolveSdkProjectBillingContext: mockResolveSdkProjectBillingContext,
  enforceSdkProjectProvisionLimit: mockEnforceSdkProjectProvisionLimit,
  recordGrowthProjectMeterEvent: mockRecordGrowthProjectMeterEvent,
  buildSdkTenantOwnerScopeKey: vi.fn(
    (input: { ownerType: "user" | "organization"; ownerUserId: string; orgId: string | null }) =>
      input.ownerType === "organization" && input.orgId ? `org:${input.orgId}` : `user:${input.ownerUserId}`
  ),
}))

vi.mock("node:timers/promises", () => ({
  setTimeout: mockDelay,
}))

vi.mock("@libsql/client", () => ({
  createClient: mockCreateTurso,
}))

import { resolveTenantTurso } from "./scope"

describe("resolveTenantTurso", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockShouldAutoProvisionTenants.mockReturnValue(true)
    mockHasTursoPlatformApiToken.mockReturnValue(true)
    mockGetTursoOrgSlug.mockReturnValue("acme-org")
    mockDelay.mockResolvedValue(undefined)

    mockCreateDatabase.mockResolvedValue({
      name: "tenant-a-db",
      hostname: "tenant-a-db.turso.io",
    })
    mockCreateDatabaseToken.mockResolvedValue("token-a")
    mockDeleteDatabase.mockResolvedValue(undefined)
    mockInitSchema.mockResolvedValue(undefined)

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
      activeProjectCount: 0,
    })

    mockRecordGrowthProjectMeterEvent.mockResolvedValue(undefined)

    mockCreateTurso.mockImplementation((input: { url: string; authToken: string }) => ({
      url: input.url,
      authToken: input.authToken,
      execute: vi.fn(),
    }))
  })

  it("stores auto-provisioned mappings with source=auto", async () => {
    let lookupCount = 0
    const upsertMock = vi.fn().mockResolvedValue({ error: null })

    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "sdk_tenant_databases") {
        return {}
      }

      const maybeSingle = vi.fn().mockImplementation(async () => {
        lookupCount += 1
        if (lookupCount === 1) {
          return { data: null, error: null }
        }

        return {
          data: {
            turso_db_url: "libsql://tenant-a-db.turso.io",
            turso_db_token: "token-a",
            status: "ready",
            metadata: { provisionedBy: "sdk_auto" },
          },
          error: null,
        }
      })

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle }),
          }),
        }),
        upsert: upsertMock,
      }
    })

    const client = await resolveTenantTurso("hash_123", "tenant-a", {
      ownerUserId: "user-1",
      autoProvision: true,
    })

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_scope_key: "user:user-1",
        tenant_id: "tenant-a",
        mapping_source: "auto",
        status: "ready",
      }),
      { onConflict: "owner_scope_key,tenant_id" }
    )

    expect(client).toMatchObject({
      url: "libsql://tenant-a-db.turso.io",
      authToken: "token-a",
    })
  })

  it("cleans up provisioned Turso DB when mapping persistence fails", async () => {
    let lookupCount = 0
    let upsertCount = 0

    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "sdk_tenant_databases") {
        return {}
      }

      const maybeSingle = vi.fn().mockImplementation(async () => {
        lookupCount += 1
        if (lookupCount === 1) {
          return { data: null, error: null }
        }

        return {
          data: {
            turso_db_url: null,
            turso_db_token: null,
            status: "error",
            metadata: {},
          },
          error: null,
        }
      })

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle }),
          }),
        }),
        upsert: vi.fn().mockImplementation(async () => {
          upsertCount += 1
          if (upsertCount === 1) {
            return { error: { message: "write failed" } }
          }
          return { error: null }
        }),
      }
    })

    await expect(
      resolveTenantTurso("hash_123", "tenant-fail", {
        ownerUserId: "user-1",
        autoProvision: true,
      })
    ).rejects.toBeDefined()

    expect(mockDeleteDatabase).toHaveBeenCalledWith("acme-org", "tenant-a-db")
  })

  it("respects auto-provision retry backoff when mapping is in error state", async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table !== "sdk_tenant_databases") {
        return {}
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  turso_db_url: null,
                  turso_db_token: null,
                  status: "error",
                  metadata: {
                    autoProvisionRetryAfter: new Date(Date.now() + 5 * 60_000).toISOString(),
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
        upsert: vi.fn(),
      }
    })

    await expect(
      resolveTenantTurso("hash_123", "tenant-backoff", {
        ownerUserId: "user-1",
        autoProvision: true,
      })
    ).rejects.toBeDefined()

    expect(mockCreateDatabase).not.toHaveBeenCalled()
  })
})
