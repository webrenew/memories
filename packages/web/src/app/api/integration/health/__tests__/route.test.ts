import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockAuthenticateRequest,
  mockCheckRateLimit,
  mockCheckPreAuthApiRateLimit,
  mockBuildIntegrationHealthPayload,
} = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockCheckPreAuthApiRateLimit: vi.fn(),
  mockBuildIntegrationHealthPayload: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: mockAuthenticateRequest,
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
  checkPreAuthApiRateLimit: mockCheckPreAuthApiRateLimit,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}))

vi.mock("@/lib/integration-health", () => ({
  buildIntegrationHealthPayload: mockBuildIntegrationHealthPayload,
}))

import { GET } from "../route"

describe("/api/integration/health", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckPreAuthApiRateLimit.mockResolvedValue(null)
    mockCheckRateLimit.mockResolvedValue(null)
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null)

    const response = await GET(new Request("https://example.com/api/integration/health"))
    expect(response.status).toBe(401)
  })

  it("returns integration health payload", async () => {
    mockAuthenticateRequest.mockResolvedValue({
      userId: "user-1",
      email: "charles@webrenew.io",
    })
    mockBuildIntegrationHealthPayload.mockResolvedValue({
      status: "ok",
      sampledAt: "2026-02-12T00:00:00.000Z",
      auth: { ok: true, userId: "user-1", email: "charles@webrenew.io" },
      workspace: {
        ok: true,
        label: "personal",
        ownerType: "user",
        orgId: null,
        orgRole: null,
        plan: "pro",
        hasDatabase: true,
        canProvision: true,
      },
      workspaceSwitch: {
        ok: true,
        status: "ok",
        windowHours: 24,
        sampleCount: 20,
        successCount: 20,
        failureCount: 0,
        p50Ms: 210,
        p95Ms: 520,
        budgets: {
          minSamples: 10,
          p50Ms: 400,
          p95Ms: 1000,
        },
        lastSwitchedAt: "2026-02-12T00:00:00.000Z",
        lastErrorAt: null,
        alarms: [],
        profiling: {
          status: "ok",
          sampleCount: 20,
          successfulSampleCount: 20,
          profiledSampleCount: 20,
          largeTenantThresholds: {
            orgCount: 10,
            responseBytes: 80000,
          },
          largeTenantSampleCount: 4,
          p95ClientTotalMs: 740,
          p95LargeTenantClientTotalMs: 1120,
          phaseP95Ms: {
            userPatchMs: 140,
            workspacePrefetchMs: 300,
            integrationHealthPrefetchMs: 160,
            workspaceSummaryTotalMs: 260,
            workspaceSummaryQueryMs: 120,
          },
          warnings: [],
          error: null,
        },
        error: null,
      },
      database: {
        ok: true,
        latencyMs: 42,
        memoriesCount: 100,
        error: null,
      },
      graph: {
        ok: true,
        health: "ok",
        nodes: 20,
        edges: 40,
        memoryLinks: 60,
        rolloutMode: "canary",
        fallbackRate24h: 0.01,
      },
      issues: [],
    })

    const response = await GET(new Request("https://example.com/api/integration/health"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.health.status).toBe("ok")
    expect(body.health.database.latencyMs).toBe(42)
    expect(mockBuildIntegrationHealthPayload).toHaveBeenCalledWith({
      admin: {},
      userId: "user-1",
      email: "charles@webrenew.io",
    })
  })
})
