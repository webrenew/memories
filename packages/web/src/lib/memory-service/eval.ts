export type ReplayEvalTriggerType = "count" | "time" | "semantic" | null
export type ReplayEvalStatus = "pass" | "warn" | "fail"

export interface ReplayEvalPassCriteria {
  extractionF1: number
  compactionRetention: number
  triggerAccuracy: number
  casePassRatio: number
}

export interface ReplayEvalExtractionInput {
  expected: string[]
  observed: string[]
}

export interface ReplayEvalCompactionInput {
  checkpoint: string
  requiredFacts: string[]
}

export interface ReplayEvalTriggerSignalsInput {
  estimatedTokens?: number
  budgetTokens?: number
  turnCount?: number
  turnBudget?: number
  lastActivityAt?: string
  inactivityThresholdMinutes?: number
  taskCompleted?: boolean
  nowIso?: string
}

export interface ReplayEvalTriggerInput {
  expected: ReplayEvalTriggerType
  observed?: ReplayEvalTriggerType
  signals?: ReplayEvalTriggerSignalsInput
}

export interface ReplayEvalScenarioInput {
  id: string
  title?: string
  extraction?: ReplayEvalExtractionInput
  compaction?: ReplayEvalCompactionInput
  trigger?: ReplayEvalTriggerInput
}

export interface ReplayEvalInput {
  nowIso?: string
  passCriteria?: Partial<ReplayEvalPassCriteria>
  scenarios: ReplayEvalScenarioInput[]
}

export interface ReplayEvalExtractionResult {
  expectedCount: number
  observedCount: number
  truePositiveCount: number
  falsePositiveCount: number
  falseNegativeCount: number
  precision: number
  recall: number
  f1: number
  pass: boolean
}

export interface ReplayEvalCompactionResult {
  requiredCount: number
  retainedCount: number
  missingFacts: string[]
  retention: number
  pass: boolean
}

export interface ReplayEvalTriggerResult {
  expected: ReplayEvalTriggerType
  actual: ReplayEvalTriggerType
  matched: boolean
  pass: boolean
}

export interface ReplayEvalScenarioResult {
  id: string
  title: string | null
  score: number
  status: ReplayEvalStatus
  extraction: ReplayEvalExtractionResult | null
  compaction: ReplayEvalCompactionResult | null
  trigger: ReplayEvalTriggerResult | null
}

export interface ReplayEvalSummary {
  evaluatedAt: string
  criteria: ReplayEvalPassCriteria
  scenarios: number
  extractionCases: number
  compactionCases: number
  triggerCases: number
  extractionF1Avg: number
  compactionRetentionAvg: number
  triggerAccuracy: number
  passRate: number
  scoreAvg: number
  status: ReplayEvalStatus
}

export interface ReplayEvalResult {
  summary: ReplayEvalSummary
  scenarios: ReplayEvalScenarioResult[]
}

const DEFAULT_PASS_CRITERIA: ReplayEvalPassCriteria = {
  extractionF1: 0.7,
  compactionRetention: 0.85,
  triggerAccuracy: 0.9,
  casePassRatio: 0.85,
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

function uniqueNormalized(values: string[]): Set<string> {
  const normalized = values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0)
  return new Set(normalized)
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return numerator / denominator
}

function round(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(decimals))
}

function normalizeCriteria(input: Partial<ReplayEvalPassCriteria> | undefined): ReplayEvalPassCriteria {
  const parseUnitRatio = (value: number | undefined, fallback: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback
    if (value < 0) return 0
    if (value > 1) return 1
    return value
  }

  return {
    extractionF1: parseUnitRatio(input?.extractionF1, DEFAULT_PASS_CRITERIA.extractionF1),
    compactionRetention: parseUnitRatio(input?.compactionRetention, DEFAULT_PASS_CRITERIA.compactionRetention),
    triggerAccuracy: parseUnitRatio(input?.triggerAccuracy, DEFAULT_PASS_CRITERIA.triggerAccuracy),
    casePassRatio: parseUnitRatio(input?.casePassRatio, DEFAULT_PASS_CRITERIA.casePassRatio),
  }
}

function parseIso(value: string | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function evaluateTriggerSignals(input: ReplayEvalTriggerSignalsInput | undefined): ReplayEvalTriggerType {
  if (!input) return null

  const estimatedTokens = Number.isFinite(input.estimatedTokens) ? Math.max(0, Math.floor(input.estimatedTokens as number)) : null
  const budgetTokens = Number.isFinite(input.budgetTokens) ? Math.max(0, Math.floor(input.budgetTokens as number)) : null
  const turnCount = Number.isFinite(input.turnCount) ? Math.max(0, Math.floor(input.turnCount as number)) : null
  const turnBudget = Number.isFinite(input.turnBudget) ? Math.max(0, Math.floor(input.turnBudget as number)) : null

  const tokenExceeded = estimatedTokens !== null && budgetTokens !== null && budgetTokens > 0 && estimatedTokens > budgetTokens
  const turnsExceeded = turnCount !== null && turnBudget !== null && turnBudget > 0 && turnCount > turnBudget
  if (tokenExceeded || turnsExceeded) return "count"

  const inactivityThresholdMinutes =
    Number.isFinite(input.inactivityThresholdMinutes) && (input.inactivityThresholdMinutes as number) > 0
      ? Math.floor(input.inactivityThresholdMinutes as number)
      : null
  const now = parseIso(input.nowIso) ?? new Date()
  const lastActivityAt = parseIso(input.lastActivityAt)
  if (inactivityThresholdMinutes !== null && lastActivityAt) {
    const inactiveForMs = now.getTime() - lastActivityAt.getTime()
    if (inactiveForMs >= inactivityThresholdMinutes * 60_000) {
      return "time"
    }
  }

  if (input.taskCompleted === true) return "semantic"
  return null
}

function evaluateExtraction(
  input: ReplayEvalExtractionInput,
  criteria: ReplayEvalPassCriteria
): ReplayEvalExtractionResult {
  const expectedSet = uniqueNormalized(input.expected)
  const observedSet = uniqueNormalized(input.observed)

  let truePositiveCount = 0
  for (const candidate of observedSet) {
    if (expectedSet.has(candidate)) {
      truePositiveCount += 1
    }
  }

  const falsePositiveCount = observedSet.size - truePositiveCount
  const falseNegativeCount = expectedSet.size - truePositiveCount
  const precision = safeRatio(truePositiveCount, observedSet.size)
  const recall = safeRatio(truePositiveCount, expectedSet.size)
  const f1 =
    precision > 0 || recall > 0
      ? safeRatio(2 * precision * recall, precision + recall)
      : 0

  return {
    expectedCount: expectedSet.size,
    observedCount: observedSet.size,
    truePositiveCount,
    falsePositiveCount,
    falseNegativeCount,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    pass: f1 >= criteria.extractionF1,
  }
}

function evaluateCompaction(
  input: ReplayEvalCompactionInput,
  criteria: ReplayEvalPassCriteria
): ReplayEvalCompactionResult {
  const checkpoint = normalizeText(input.checkpoint)
  const requiredFacts = input.requiredFacts
    .map((fact) => fact.trim())
    .filter((fact) => fact.length > 0)

  const missingFacts: string[] = []
  let retainedCount = 0

  for (const fact of requiredFacts) {
    const normalizedFact = normalizeText(fact)
    if (!normalizedFact) continue
    if (checkpoint.includes(normalizedFact)) {
      retainedCount += 1
    } else {
      missingFacts.push(fact)
    }
  }

  const requiredCount = requiredFacts.length
  const retention = requiredCount > 0 ? safeRatio(retainedCount, requiredCount) : 1

  return {
    requiredCount,
    retainedCount,
    missingFacts,
    retention: round(retention),
    pass: retention >= criteria.compactionRetention,
  }
}

function evaluateTrigger(
  input: ReplayEvalTriggerInput,
  criteria: ReplayEvalPassCriteria
): ReplayEvalTriggerResult {
  const actual = input.observed ?? evaluateTriggerSignals(input.signals)
  const matched = actual === input.expected
  const pass = safeRatio(matched ? 1 : 0, 1) >= criteria.triggerAccuracy

  return {
    expected: input.expected,
    actual,
    matched,
    pass,
  }
}

function deriveSummaryStatus(summary: Omit<ReplayEvalSummary, "status">): ReplayEvalStatus {
  if (summary.scenarios === 0) return "fail"
  const passesGate =
    summary.passRate >= summary.criteria.casePassRatio &&
    (summary.extractionCases === 0 || summary.extractionF1Avg >= summary.criteria.extractionF1) &&
    (summary.compactionCases === 0 || summary.compactionRetentionAvg >= summary.criteria.compactionRetention) &&
    (summary.triggerCases === 0 || summary.triggerAccuracy >= summary.criteria.triggerAccuracy)

  if (passesGate) return "pass"
  if (summary.passRate >= 0.5) return "warn"
  return "fail"
}

export function runReplayEval(input: ReplayEvalInput): ReplayEvalResult {
  const criteria = normalizeCriteria(input.passCriteria)
  const evaluatedAt = parseIso(input.nowIso)?.toISOString() ?? new Date().toISOString()

  const scenarios: ReplayEvalScenarioResult[] = input.scenarios.map((scenario) => {
    const extraction = scenario.extraction ? evaluateExtraction(scenario.extraction, criteria) : null
    const compaction = scenario.compaction ? evaluateCompaction(scenario.compaction, criteria) : null
    const trigger = scenario.trigger ? evaluateTrigger(scenario.trigger, criteria) : null

    const scoreParts: number[] = []
    const componentPasses: boolean[] = []

    if (extraction) {
      scoreParts.push(extraction.f1)
      componentPasses.push(extraction.pass)
    }
    if (compaction) {
      scoreParts.push(compaction.retention)
      componentPasses.push(compaction.pass)
    }
    if (trigger) {
      scoreParts.push(trigger.matched ? 1 : 0)
      componentPasses.push(trigger.pass)
    }

    const score = scoreParts.length > 0 ? scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length : 0
    const allPassed = componentPasses.length > 0 && componentPasses.every(Boolean)

    return {
      id: scenario.id,
      title: scenario.title?.trim() || null,
      score: round(score),
      status: allPassed ? "pass" : scoreParts.length > 0 ? "fail" : "warn",
      extraction,
      compaction,
      trigger,
    }
  })

  const extractionResults = scenarios
    .map((scenario) => scenario.extraction)
    .filter((value): value is ReplayEvalExtractionResult => value !== null)
  const compactionResults = scenarios
    .map((scenario) => scenario.compaction)
    .filter((value): value is ReplayEvalCompactionResult => value !== null)
  const triggerResults = scenarios
    .map((scenario) => scenario.trigger)
    .filter((value): value is ReplayEvalTriggerResult => value !== null)

  const extractionF1Avg =
    extractionResults.length > 0
      ? extractionResults.reduce((sum, result) => sum + result.f1, 0) / extractionResults.length
      : 0
  const compactionRetentionAvg =
    compactionResults.length > 0
      ? compactionResults.reduce((sum, result) => sum + result.retention, 0) / compactionResults.length
      : 0
  const triggerAccuracy =
    triggerResults.length > 0
      ? triggerResults.reduce((sum, result) => sum + (result.matched ? 1 : 0), 0) / triggerResults.length
      : 0
  const passRate =
    scenarios.length > 0
      ? scenarios.reduce((sum, scenario) => sum + (scenario.status === "pass" ? 1 : 0), 0) / scenarios.length
      : 0
  const scoreAvg =
    scenarios.length > 0
      ? scenarios.reduce((sum, scenario) => sum + scenario.score, 0) / scenarios.length
      : 0

  const summaryWithoutStatus: Omit<ReplayEvalSummary, "status"> = {
    evaluatedAt,
    criteria,
    scenarios: scenarios.length,
    extractionCases: extractionResults.length,
    compactionCases: compactionResults.length,
    triggerCases: triggerResults.length,
    extractionF1Avg: round(extractionF1Avg),
    compactionRetentionAvg: round(compactionRetentionAvg),
    triggerAccuracy: round(triggerAccuracy),
    passRate: round(passRate),
    scoreAvg: round(scoreAvg),
  }

  return {
    summary: {
      ...summaryWithoutStatus,
      status: deriveSummaryStatus(summaryWithoutStatus),
    },
    scenarios,
  }
}
