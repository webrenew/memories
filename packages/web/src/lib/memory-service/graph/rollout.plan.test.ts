import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildGraphRolloutPlan,
  evaluateGraphRetrievalPolicy,
  evaluateGraphRolloutPlan,
  recordGraphRolloutMetric,
  setGraphRolloutConfig,
  type GraphRolloutQualitySummary,
} from "./rollout"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

function baseQualitySummary(nowIso: string): GraphRolloutQualitySummary {
  return {
    evaluatedAt: nowIso,
    windowHours: 24,
    minHybridSamples: 20,
    minCanarySamplesForRelevance: 12,
    status: "insufficient_data",
    canaryBlocked: false,
    reasons: [],
    current: {
      startAt: "2026-02-12T00:00:00.000Z",
      endAt: nowIso,
      totalRequests: 0,
      hybridRequested: 0,
      canaryApplied: 0,
      hybridFallbacks: 0,
      graphErrorFallbacks: 0,
      fallbackRate: 0,
      graphErrorFallbackRate: 0,
      canaryWithExpansion: 0,
      expansionCoverageRate: 0,
      avgExpandedCount: 0,
      avgCandidateLift: 0,
    },
    previous: {
      startAt: "2026-02-11T00:00:00.000Z",
      endAt: "2026-02-12T00:00:00.000Z",
      totalRequests: 0,
      hybridRequested: 0,
      canaryApplied: 0,
      hybridFallbacks: 0,
      graphErrorFallbacks: 0,
      fallbackRate: 0,
      graphErrorFallbackRate: 0,
      canaryWithExpansion: 0,
      expansionCoverageRate: 0,
      avgExpandedCount: 0,
      avgCandidateLift: 0,
    },
  }
}

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "graph-rollout-plan.db")}` })
  testDatabases.push(db)
  return db
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("graph rollout plan", () => {
  it("holds lexical default when SLO samples are insufficient", () => {
    const nowIso = "2026-02-13T00:00:00.000Z"
    const plan = buildGraphRolloutPlan({
      evaluatedAt: nowIso,
      rollout: {
        mode: "shadow",
        updatedAt: nowIso,
        updatedBy: "user-1",
      },
      shadowMetrics: {
        windowHours: 24,
        totalRequests: 10,
        hybridRequested: 5,
        canaryApplied: 0,
        shadowExecutions: 10,
        fallbackCount: 0,
        fallbackRate: 0,
        graphErrorFallbacks: 0,
        avgGraphCandidates: 0.4,
        avgGraphExpandedCount: 0,
        lastFallbackAt: null,
        lastFallbackReason: null,
      },
      qualityGate: baseQualitySummary(nowIso),
    })

    expect(plan.defaultBehaviorDecision).toBe("hold_lexical_default")
    expect(plan.readyForDefaultOn).toBe(false)
    expect(plan.stages.find((stage) => stage.stage === "canary")?.ready).toBe(false)
    expect(plan.blockerCodes).toContain("MIN_HYBRID_SAMPLES_NOT_MET")
  })

  it("autopilot can advance rollout from off to shadow", async () => {
    const db = await setupDb("memories-graph-rollout-autopilot")
    const nowIso = "2026-02-13T00:00:00.000Z"

    await setGraphRolloutConfig(db, {
      mode: "off",
      nowIso: "2026-02-12T23:55:00.000Z",
      updatedBy: "user-1",
    })

    const result = await evaluateGraphRolloutPlan(db, {
      nowIso,
      windowHours: 24,
      updatedBy: "user-1",
      allowAutopilot: true,
    })

    expect(result.rollout.mode).toBe("shadow")
    expect(result.plan.autopilot.enabled).toBe(true)
    expect(result.plan.autopilot.applied).toBe(true)
  })

  it("promotes default strategy after sustained readiness and rolls back on regression", async () => {
    const db = await setupDb("memories-graph-default-strategy-autopilot")

    await setGraphRolloutConfig(db, {
      mode: "canary",
      nowIso: "2026-02-12T23:00:00.000Z",
      updatedBy: "user-1",
    })

    for (let index = 0; index < 24; index += 1) {
      await recordGraphRolloutMetric(db, {
        nowIso: `2026-02-13T00:${index.toString().padStart(2, "0")}:00.000Z`,
        mode: "canary",
        requestedStrategy: "hybrid_graph",
        appliedStrategy: "hybrid_graph",
        shadowExecuted: false,
        baselineCandidates: 2,
        graphCandidates: 3,
        graphExpandedCount: 1,
        totalCandidates: 3,
        fallbackTriggered: false,
        fallbackReason: null,
      })
    }

    const first = await evaluateGraphRetrievalPolicy(db, {
      nowIso: "2026-02-13T01:00:00.000Z",
      updatedBy: "user-1",
      allowAutopilot: true,
      promoteAfterReadyWindows: 2,
    })
    expect(first.policy.defaultStrategy).toBe("lexical")
    expect(first.policy.readyWindowStreak).toBe(1)
    expect(first.autopilot.applied).toBe(false)

    const second = await evaluateGraphRetrievalPolicy(db, {
      nowIso: "2026-02-13T01:30:00.000Z",
      updatedBy: "user-1",
      allowAutopilot: true,
      promoteAfterReadyWindows: 2,
    })
    expect(second.policy.defaultStrategy).toBe("hybrid")
    expect(second.autopilot.applied).toBe(true)

    for (let index = 0; index < 20; index += 1) {
      await recordGraphRolloutMetric(db, {
        nowIso: `2026-02-13T01:${index.toString().padStart(2, "0")}:30.000Z`,
        mode: "canary",
        requestedStrategy: "hybrid_graph",
        appliedStrategy: "baseline",
        shadowExecuted: true,
        baselineCandidates: 3,
        graphCandidates: 2,
        graphExpandedCount: 0,
        totalCandidates: 3,
        fallbackTriggered: true,
        fallbackReason: "quality_gate_blocked",
      })
    }

    const third = await evaluateGraphRetrievalPolicy(db, {
      nowIso: "2026-02-13T02:00:00.000Z",
      updatedBy: "user-1",
      allowAutopilot: true,
      promoteAfterReadyWindows: 2,
    })
    expect(third.policy.defaultStrategy).toBe("lexical")
    expect(third.policy.readyWindowStreak).toBe(0)
    expect(third.autopilot.applied).toBe(true)
  })
})
