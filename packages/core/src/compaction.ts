import type { ContextSessionState, MemoryRecord, SkillFileRecord } from "./types"

const AVG_CHARS_PER_TOKEN = 4
const CONTEXT_BASE_TOKENS = 24
const RULE_OVERHEAD_TOKENS = 8
const MEMORY_OVERHEAD_TOKENS = 12
const SKILL_OVERHEAD_TOKENS = 20

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

function normalizeNonNegativeInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const normalized = Math.floor(value)
  return normalized >= 0 ? normalized : null
}

function estimateTextTokens(value: string | null | undefined): number {
  if (!value) return 0
  const trimmed = value.trim()
  if (!trimmed) return 0
  return Math.max(1, Math.ceil(trimmed.length / AVG_CHARS_PER_TOKEN))
}

function estimateMemoryTokens(memory: MemoryRecord): number {
  const tagsTokens = memory.tags.reduce((sum, tag) => sum + estimateTextTokens(tag), 0)
  return MEMORY_OVERHEAD_TOKENS + estimateTextTokens(memory.content) + estimateTextTokens(memory.type) + tagsTokens
}

function estimateRuleTokens(rule: MemoryRecord): number {
  const tagsTokens = rule.tags.reduce((sum, tag) => sum + estimateTextTokens(tag), 0)
  return RULE_OVERHEAD_TOKENS + estimateTextTokens(rule.content) + tagsTokens
}

function estimateSkillFileTokens(skillFile: SkillFileRecord): number {
  return SKILL_OVERHEAD_TOKENS + estimateTextTokens(skillFile.path) + estimateTextTokens(skillFile.content)
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function estimateContextTokens(args: {
  rules: MemoryRecord[]
  memories: MemoryRecord[]
  skillFiles?: SkillFileRecord[]
}): number {
  const skillFiles = args.skillFiles ?? []
  let total = CONTEXT_BASE_TOKENS

  for (const rule of args.rules) {
    total += estimateRuleTokens(rule)
  }
  for (const memory of args.memories) {
    total += estimateMemoryTokens(memory)
  }
  for (const skillFile of skillFiles) {
    total += estimateSkillFileTokens(skillFile)
  }

  return total
}

export function hasCompactionSignals(input: {
  sessionId?: string
  budgetTokens?: number
  turnCount?: number
  turnBudget?: number
  lastActivityAt?: string
  inactivityThresholdMinutes?: number
  taskCompleted?: boolean
}): boolean {
  return Boolean(
    input.sessionId ||
      input.budgetTokens !== undefined ||
      input.turnCount !== undefined ||
      input.turnBudget !== undefined ||
      input.lastActivityAt ||
      input.inactivityThresholdMinutes !== undefined ||
      input.taskCompleted !== undefined
  )
}

export function evaluateCompactionTrigger(input: {
  sessionId?: string
  rules: MemoryRecord[]
  memories: MemoryRecord[]
  skillFiles?: SkillFileRecord[]
  budgetTokens?: number
  turnCount?: number
  turnBudget?: number
  lastActivityAt?: string
  inactivityThresholdMinutes?: number
  taskCompleted?: boolean
  now?: string | Date
}): ContextSessionState {
  const estimatedTokens = estimateContextTokens({
    rules: input.rules,
    memories: input.memories,
    skillFiles: input.skillFiles,
  })
  const budgetTokens = normalizePositiveInteger(input.budgetTokens)
  const turnCount = normalizeNonNegativeInteger(input.turnCount)
  const turnBudget = normalizePositiveInteger(input.turnBudget)
  const inactivityThresholdMinutes = normalizePositiveInteger(input.inactivityThresholdMinutes)
  const now = input.now instanceof Date ? input.now : parseIsoDate(typeof input.now === "string" ? input.now : null) ?? new Date()
  const lastActivityAt = parseIsoDate(input.lastActivityAt)

  const tokenExceeded = budgetTokens !== null && estimatedTokens > budgetTokens
  const turnExceeded = turnBudget !== null && turnCount !== null && turnCount > turnBudget
  const countTriggered = tokenExceeded || turnExceeded

  const inactiveForMs = lastActivityAt ? now.getTime() - lastActivityAt.getTime() : 0
  const inactivityThresholdMs = inactivityThresholdMinutes !== null ? inactivityThresholdMinutes * 60_000 : null
  const timeTriggered = inactivityThresholdMs !== null && lastActivityAt !== null && inactiveForMs >= inactivityThresholdMs

  const semanticTriggered = input.taskCompleted === true

  let triggerHint: ContextSessionState["triggerHint"] = null
  let reason = "No compaction trigger."
  if (countTriggered) {
    triggerHint = "count"
    if (tokenExceeded && budgetTokens !== null) {
      reason = `Estimated context tokens ${estimatedTokens} exceed budget ${budgetTokens}.`
    } else if (turnExceeded && turnCount !== null && turnBudget !== null) {
      reason = `Turn count ${turnCount} exceeds budget ${turnBudget}.`
    } else {
      reason = "Count-based compaction trigger fired."
    }
  } else if (timeTriggered && inactivityThresholdMinutes !== null) {
    triggerHint = "time"
    reason = `Session inactive beyond ${inactivityThresholdMinutes} minute threshold.`
  } else if (semanticTriggered) {
    triggerHint = "semantic"
    reason = "Task marked complete; semantic compaction trigger fired."
  }

  return {
    sessionId: input.sessionId?.trim() || null,
    estimatedTokens,
    budgetTokens,
    turnCount,
    turnBudget,
    compactionRequired: triggerHint !== null,
    triggerHint,
    reason,
  }
}
