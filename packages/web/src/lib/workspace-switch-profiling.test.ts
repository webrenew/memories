import { describe, expect, it } from "vitest"
import {
  WORKSPACE_SWITCH_PROFILE_BUDGETS,
  emptyWorkspaceSwitchProfiling,
  evaluateWorkspaceSwitchProfiling,
  type WorkspaceSwitchProfileEvent,
} from "./workspace-switch-profiling"

function makeEvent(index: number, overrides: Partial<WorkspaceSwitchProfileEvent> = {}): WorkspaceSwitchProfileEvent {
  return {
    success: true,
    createdAt: new Date(Date.UTC(2026, 1, 13, 0, 0, index)).toISOString(),
    clientTotalMs: 900,
    userPatchMs: 120,
    workspacePrefetchMs: 260,
    integrationHealthPrefetchMs: 90,
    workspaceSummaryTotalMs: 240,
    workspaceSummaryQueryMs: 140,
    workspaceSummaryOrgCount: 3,
    workspaceSummaryWorkspaceCount: 4,
    workspaceSummaryResponseBytes: 12_000,
    ...overrides,
  }
}

describe("workspace switch profiling", () => {
  it("returns insufficient_data with low profiled sample size", () => {
    const events = Array.from({ length: WORKSPACE_SWITCH_PROFILE_BUDGETS.minSamples - 1 }, (_, index) =>
      makeEvent(index),
    )

    const report = evaluateWorkspaceSwitchProfiling(events)
    expect(report.status).toBe("insufficient_data")
    expect(report.warnings).toHaveLength(0)
  })

  it("raises warnings when p95 budgets are exceeded", () => {
    const events = Array.from({ length: WORKSPACE_SWITCH_PROFILE_BUDGETS.minSamples + 3 }, (_, index) =>
      makeEvent(index, {
        clientTotalMs: 3000,
        workspaceSummaryTotalMs: 1500,
        workspaceSummaryQueryMs: 900,
      }),
    )

    const report = evaluateWorkspaceSwitchProfiling(events)
    expect(report.status).toBe("warn")
    expect(report.warnings.length).toBeGreaterThanOrEqual(2)
    expect(report.p95ClientTotalMs).toBeGreaterThan(WORKSPACE_SWITCH_PROFILE_BUDGETS.p95ClientTotalMs)
  })

  it("evaluates large-tenant p95 separately", () => {
    const events = Array.from({ length: WORKSPACE_SWITCH_PROFILE_BUDGETS.minSamples + 2 }, (_, index) =>
      makeEvent(index, {
        workspaceSummaryOrgCount: 20,
        workspaceSummaryResponseBytes: 200_000,
        clientTotalMs: 2600,
      }),
    )

    const report = evaluateWorkspaceSwitchProfiling(events)
    expect(report.largeTenantSampleCount).toBe(events.length)
    expect(report.p95LargeTenantClientTotalMs).toBe(2600)
    expect(report.warnings.some((warning) => warning.includes("Large-tenant"))).toBe(true)
  })

  it("builds unavailable payload for missing profile telemetry table", () => {
    const report = emptyWorkspaceSwitchProfiling("unavailable", "table missing")
    expect(report.status).toBe("unavailable")
    expect(report.error).toBe("table missing")
  })
})
