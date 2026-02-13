import type { Memory, MemoryType } from "@/types/memory"

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_STALE_RULE_DAYS = 45
const DEFAULT_WEEKLY_WINDOW_DAYS = 7
const PREVIEW_MAX_LENGTH = 120

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "will",
  "with",
  "you",
  "your",
])

type Polarity = "positive" | "negative" | "neutral"
type Trend = "up" | "down" | "stable"

interface PreparedMemory {
  memory: Memory
  createdAtMs: number
  updatedAtMs: number
  projectKey: string
  tags: string[]
  tokens: string[]
  topicTokens: string[]
  polarity: Polarity
}

interface DuplicatePair {
  memoryA: Memory
  memoryB: Memory
  similarity: number
}

export interface StaleRuleInsight {
  id: string
  ageDays: number
  project: string
  lastUpdatedAt: string
  tags: string[]
  preview: string
}

export interface ConflictInsight {
  id: string
  score: number
  sharedTags: string[]
  sharedTopics: string[]
  similarity: number
  memoryA: {
    id: string
    type: MemoryType
    project: string
    preview: string
  }
  memoryB: {
    id: string
    type: MemoryType
    project: string
    preview: string
  }
}

export interface InsightAction {
  id: string
  kind: "archive" | "merge" | "relabel"
  title: string
  reason: string
  memoryIds: string[]
  proposedTags?: string[]
}

export interface MemoryInsights {
  generatedAt: string
  staleRules: {
    thresholdDays: number
    count: number
    items: StaleRuleInsight[]
  }
  conflicts: {
    count: number
    items: ConflictInsight[]
  }
  weekly: {
    windowDays: number
    changedCount: number
    previousChangedCount: number
    newCount: number
    updatedCount: number
    trend: Trend
    deltaPercent: number | null
    byType: Array<{ type: MemoryType; count: number }>
    topProjects: Array<{ project: string; count: number }>
    topTags: Array<{ tag: string; count: number }>
  }
  actions: {
    total: number
    archive: InsightAction[]
    merge: InsightAction[]
    relabel: InsightAction[]
  }
}

interface BuildMemoryInsightsOptions {
  now?: Date
  staleRuleDays?: number
  weeklyWindowDays?: number
}

function safeTimestamp(value: string): number {
  const parsed = new Date(value).getTime()
  if (Number.isFinite(parsed)) return parsed
  return 0
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

function shortPreview(value: string, limit = PREVIEW_MAX_LENGTH): string {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  return Array.from(
    new Set(
      tags
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function textTokens(content: string): string[] {
  const normalized = normalizeText(content)
  if (!normalized) return []
  return Array.from(
    new Set(
      normalized
        .split(" ")
        .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
    ),
  )
}

function determinePolarity(content: string): Polarity {
  const normalized = normalizeText(content)
  if (!normalized) return "neutral"

  const hasNegative = /\b(do not|dont|never|must not|should not|avoid|forbid|forbidden|cannot|cant|no longer)\b/.test(
    normalized,
  )
  const hasPositive = /\b(always|must|should|require|required|enable|enforce|use|preferred)\b/.test(
    normalized,
  )

  // "do not require ..." contains a positive token as well, so explicit negatives take precedence.
  if (hasNegative) return "negative"
  if (hasPositive) return "positive"
  return "neutral"
}

function projectLabel(memory: Memory): string {
  if (memory.scope === "project" && memory.project_id) return memory.project_id
  return "global"
}

function sharedValues(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return []
  const bSet = new Set(b)
  return a.filter((value) => bSet.has(value))
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0

  const aSet = new Set(a)
  const bSet = new Set(b)
  let intersection = 0

  for (const value of aSet) {
    if (bSet.has(value)) intersection += 1
  }

  const union = new Set([...aSet, ...bSet]).size
  if (union === 0) return 0
  return intersection / union
}

function sortCountEntries<T extends string>(
  values: T[],
  limit: number,
): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))
}

function buildPreparedMemories(memories: Memory[]): PreparedMemory[] {
  return memories.map((memory) => {
    const createdAtMs = safeTimestamp(memory.created_at)
    const updatedAtMs = safeTimestamp(memory.updated_at || memory.created_at)
    const tags = parseTags(memory.tags)
    const tokens = textTokens(memory.content)
    const topicTokens = Array.from(new Set([...tags, ...tokens.slice(0, 10)]))
    const polarity = determinePolarity(memory.content)

    return {
      memory,
      createdAtMs,
      updatedAtMs: Math.max(updatedAtMs, createdAtMs),
      projectKey: projectLabel(memory),
      tags,
      tokens,
      topicTokens,
      polarity,
    }
  })
}

function buildStaleRules(
  prepared: PreparedMemory[],
  nowMs: number,
  staleRuleDays: number,
): StaleRuleInsight[] {
  return prepared
    .filter((item) => item.memory.type === "rule")
    .map((item) => ({
      item,
      ageDays: Math.floor((nowMs - item.updatedAtMs) / DAY_MS),
    }))
    .filter((item) => item.ageDays >= staleRuleDays)
    .sort((a, b) => b.ageDays - a.ageDays)
    .map(({ item, ageDays }) => ({
      id: item.memory.id,
      ageDays,
      project: item.projectKey,
      lastUpdatedAt: item.memory.updated_at,
      tags: item.tags,
      preview: shortPreview(item.memory.content),
    }))
}

function buildConflictInsights(prepared: PreparedMemory[]): ConflictInsight[] {
  const candidates = prepared.filter(
    (item) =>
      (item.memory.type === "rule" || item.memory.type === "decision") &&
      item.polarity !== "neutral",
  )

  const conflicts: ConflictInsight[] = []

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]
      const b = candidates[j]

      if (a.projectKey !== b.projectKey) continue
      if (a.polarity === b.polarity) continue

      const sharedTags = sharedValues(a.tags, b.tags)
      const sharedTopics = sharedValues(a.topicTokens, b.topicTokens)
      if (sharedTags.length === 0 && sharedTopics.length < 2) continue

      const similarity = jaccardSimilarity(a.tokens, b.tokens)
      if (sharedTags.length === 0 && similarity < 0.2) continue

      const score =
        sharedTags.length * 3 +
        sharedTopics.length * 2 +
        Math.round(similarity * 10)

      conflicts.push({
        id: `${a.memory.id}:${b.memory.id}`,
        score,
        sharedTags: sharedTags.slice(0, 5),
        sharedTopics: sharedTopics.slice(0, 5),
        similarity: Number(similarity.toFixed(2)),
        memoryA: {
          id: a.memory.id,
          type: a.memory.type,
          project: a.projectKey,
          preview: shortPreview(a.memory.content, 90),
        },
        memoryB: {
          id: b.memory.id,
          type: b.memory.type,
          project: b.projectKey,
          preview: shortPreview(b.memory.content, 90),
        },
      })
    }
  }

  return conflicts
    .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
    .slice(0, 8)
}

function changedInWindow(
  item: PreparedMemory,
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  const createdInWindow = item.createdAtMs >= windowStartMs && item.createdAtMs < windowEndMs
  const updatedInWindow = item.updatedAtMs >= windowStartMs && item.updatedAtMs < windowEndMs
  return createdInWindow || updatedInWindow
}

function buildWeeklySummary(
  prepared: PreparedMemory[],
  nowMs: number,
  weeklyWindowDays: number,
): MemoryInsights["weekly"] {
  const windowMs = weeklyWindowDays * DAY_MS
  const currentWindowStart = nowMs - windowMs
  const previousWindowStart = currentWindowStart - windowMs

  const currentChanged = prepared.filter((item) =>
    changedInWindow(item, currentWindowStart, nowMs),
  )
  const previousChanged = prepared.filter((item) =>
    changedInWindow(item, previousWindowStart, currentWindowStart),
  )

  const newCount = currentChanged.filter((item) => item.createdAtMs >= currentWindowStart).length
  const updatedCount = currentChanged.filter(
    (item) => item.createdAtMs < currentWindowStart && item.updatedAtMs >= currentWindowStart,
  ).length

  const byTypeCounts = sortCountEntries(
    currentChanged.map((item) => item.memory.type),
    5,
  ).map((entry) => ({
    type: entry.value,
    count: entry.count,
  }))

  const topProjects = sortCountEntries(
    currentChanged.map((item) => item.projectKey),
    5,
  ).map((entry) => ({
    project: entry.value,
    count: entry.count,
  }))

  const topTags = sortCountEntries(
    currentChanged.flatMap((item) => item.tags),
    8,
  ).map((entry) => ({
    tag: entry.value,
    count: entry.count,
  }))

  const currentCount = currentChanged.length
  const previousCount = previousChanged.length
  let trend: Trend = "stable"
  let deltaPercent: number | null = null

  if (previousCount === 0) {
    if (currentCount > 0) trend = "up"
  } else {
    const delta = ((currentCount - previousCount) / previousCount) * 100
    deltaPercent = Number(delta.toFixed(1))
    if (delta > 10) trend = "up"
    else if (delta < -10) trend = "down"
  }

  return {
    windowDays: weeklyWindowDays,
    changedCount: currentCount,
    previousChangedCount: previousCount,
    newCount,
    updatedCount,
    trend,
    deltaPercent,
    byType: byTypeCounts,
    topProjects,
    topTags,
  }
}

function buildDuplicatePairs(prepared: PreparedMemory[]): DuplicatePair[] {
  const duplicates: DuplicatePair[] = []

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i]
      const b = prepared[j]

      if (a.projectKey !== b.projectKey) continue
      if (a.memory.type !== b.memory.type) continue
      if (a.memory.id === b.memory.id) continue

      const similarity = jaccardSimilarity(a.tokens, b.tokens)
      if (similarity < 0.82) continue

      duplicates.push({
        memoryA: a.memory,
        memoryB: b.memory,
        similarity,
      })
    }
  }

  return duplicates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 4)
}

function suggestedTags(item: PreparedMemory): string[] {
  if (item.tags.length > 0) return []
  const tokens = item.topicTokens.filter((token) => token.length >= 4).slice(0, 3)
  return tokens
}

function buildActions(
  staleRules: StaleRuleInsight[],
  duplicates: DuplicatePair[],
  conflicts: ConflictInsight[],
  prepared: PreparedMemory[],
): MemoryInsights["actions"] {
  const preparedById = new Map(prepared.map((item) => [item.memory.id, item]))
  const archiveCandidates: InsightAction[] = []

  const staleArchiveCandidates = staleRules.slice(0, 4).map((item) => ({
    id: `archive:${item.id}`,
    kind: "archive" as const,
    title: `Archive stale rule ${item.id}`,
    reason: `Rule is ${item.ageDays} days old with no recent update signal.`,
    memoryIds: [item.id],
  }))
  archiveCandidates.push(...staleArchiveCandidates)

  const conflictArchiveCandidates = conflicts.slice(0, 3).map((conflict) => {
    const memoryA = preparedById.get(conflict.memoryA.id)
    const memoryB = preparedById.get(conflict.memoryB.id)
    const older =
      !memoryA || !memoryB
        ? conflict.memoryA.id
        : memoryA.updatedAtMs <= memoryB.updatedAtMs
          ? memoryA.memory.id
          : memoryB.memory.id

    return {
      id: `archive-conflict:${conflict.id}:${older}`,
      kind: "archive" as const,
      title: `Resolve conflict by archiving ${older}`,
      reason: "Conflicting directives detected in the same project scope.",
      memoryIds: [older],
    }
  })
  archiveCandidates.push(...conflictArchiveCandidates)

  const seenArchiveIds = new Set<string>()
  const archive = archiveCandidates
    .filter((candidate) => {
      const memoryId = candidate.memoryIds[0]
      if (!memoryId) return false
      if (seenArchiveIds.has(memoryId)) return false
      seenArchiveIds.add(memoryId)
      return true
    })
    .slice(0, 6)

  const merge = duplicates.slice(0, 3).map((pair) => ({
    id: `merge:${pair.memoryA.id}:${pair.memoryB.id}`,
    kind: "merge" as const,
    title: `Merge duplicate ${pair.memoryA.type} memories`,
    reason: `Content similarity ${Math.round(pair.similarity * 100)}%. Consolidate into a single canonical memory.`,
    memoryIds: [pair.memoryA.id, pair.memoryB.id],
  }))

  const relabelCandidates = prepared
    .filter((item) => item.tags.length === 0)
    .sort(
      (a, b) =>
        b.memory.content.trim().length - a.memory.content.trim().length ||
        b.updatedAtMs - a.updatedAtMs,
    )
    .slice(0, 4)

  const relabel = relabelCandidates
    .map((item) => {
      const tags = suggestedTags(item)
      if (tags.length === 0) return null
      return {
        id: `relabel:${item.memory.id}`,
        kind: "relabel" as const,
        title: `Relabel memory ${item.memory.id}`,
        reason: "Memory has no tags; add tags to improve retrieval precision.",
        memoryIds: [item.memory.id],
        proposedTags: tags,
      }
    })
    .filter(Boolean) as InsightAction[]

  return {
    total: archive.length + merge.length + relabel.length,
    archive,
    merge,
    relabel,
  }
}

export function buildMemoryInsights(
  memories: Memory[],
  options?: BuildMemoryInsightsOptions,
): MemoryInsights {
  const nowMs = options?.now ? options.now.getTime() : Date.now()
  const staleRuleDays = options?.staleRuleDays ?? DEFAULT_STALE_RULE_DAYS
  const weeklyWindowDays = options?.weeklyWindowDays ?? DEFAULT_WEEKLY_WINDOW_DAYS

  const prepared = buildPreparedMemories(memories)
  const staleRules = buildStaleRules(prepared, nowMs, staleRuleDays)
  const conflicts = buildConflictInsights(prepared)
  const weekly = buildWeeklySummary(prepared, nowMs, weeklyWindowDays)
  const duplicates = buildDuplicatePairs(prepared)
  const actions = buildActions(staleRules, duplicates, conflicts, prepared)

  return {
    generatedAt: new Date(nowMs).toISOString(),
    staleRules: {
      thresholdDays: staleRuleDays,
      count: staleRules.length,
      items: staleRules.slice(0, 6),
    },
    conflicts: {
      count: conflicts.length,
      items: conflicts.slice(0, 6),
    },
    weekly,
    actions,
  }
}
