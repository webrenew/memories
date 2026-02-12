import { describe, expect, it } from "vitest"
import {
  WORKSPACE_SWITCH_BUDGETS,
  evaluateWorkspaceSwitchPerformance,
  emptyWorkspaceSwitchHealth,
  type WorkspaceSwitchEvent,
} from "./workspace-switch-performance"

function makeEvents(count: number, durationMs: number, success = true): WorkspaceSwitchEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    durationMs,
    success,
    createdAt: new Date(Date.UTC(2026, 1, 12, 0, 0, index)).toISOString(),
  }))
}

describe("workspace switch performance budgets", () => {
  it("returns insufficient_data below min sample threshold", () => {
    const report = evaluateWorkspaceSwitchPerformance(
      makeEvents(WORKSPACE_SWITCH_BUDGETS.minSamples - 1, 150),
      { nowIso: "2026-02-12T01:00:00.000Z" }
    )

    expect(report.status).toBe("insufficient_data")
    expect(report.alarms).toHaveLength(0)
    expect(report.p50Ms).toBe(150)
    expect(report.p95Ms).toBe(150)
  })

  it("raises p95 alarm when budget is exceeded", () => {
    const events = [
      ...makeEvents(WORKSPACE_SWITCH_BUDGETS.minSamples - 1, 180),
      { durationMs: WORKSPACE_SWITCH_BUDGETS.p95Ms + 250, success: true, createdAt: "2026-02-12T02:00:00.000Z" },
    ]

    const report = evaluateWorkspaceSwitchPerformance(events, {
      nowIso: "2026-02-12T02:00:01.000Z",
    })

    expect(report.status).toBe("degraded")
    expect(report.alarms.some((alarm) => alarm.code === "WORKSPACE_SWITCH_P95_BUDGET_EXCEEDED")).toBe(true)
    expect(report.p95Ms).toBeGreaterThan(WORKSPACE_SWITCH_BUDGETS.p95Ms)
  })

  it("raises p50 alarm when median budget is exceeded", () => {
    const report = evaluateWorkspaceSwitchPerformance(
      makeEvents(WORKSPACE_SWITCH_BUDGETS.minSamples, WORKSPACE_SWITCH_BUDGETS.p50Ms + 50),
      { nowIso: "2026-02-12T03:00:00.000Z" }
    )

    expect(report.status).toBe("degraded")
    expect(report.alarms.some((alarm) => alarm.code === "WORKSPACE_SWITCH_P50_BUDGET_EXCEEDED")).toBe(true)
    expect(report.p50Ms).toBeGreaterThan(WORKSPACE_SWITCH_BUDGETS.p50Ms)
  })

  it("stays healthy when p50 and p95 are within budget", () => {
    const report = evaluateWorkspaceSwitchPerformance(
      makeEvents(WORKSPACE_SWITCH_BUDGETS.minSamples + 4, 220),
      { nowIso: "2026-02-12T04:00:00.000Z" }
    )

    expect(report.status).toBe("ok")
    expect(report.ok).toBe(true)
    expect(report.alarms).toHaveLength(0)
    expect(report.p50Ms).toBeLessThanOrEqual(WORKSPACE_SWITCH_BUDGETS.p50Ms)
    expect(report.p95Ms).toBeLessThanOrEqual(WORKSPACE_SWITCH_BUDGETS.p95Ms)
  })

  it("builds unavailable payloads for missing telemetry backends", () => {
    const report = emptyWorkspaceSwitchHealth("unavailable", "table missing")

    expect(report.status).toBe("unavailable")
    expect(report.ok).toBe(false)
    expect(report.error).toBe("table missing")
  })
})
