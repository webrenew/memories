import { GRAPH_MAPPING_ENABLED, type MemoryLayer, type TursoClient } from "@/lib/memory-service/types"
import { removeMemoryGraphMapping, syncMemoryGraphMapping } from "@/lib/memory-service/graph/upsert"
import type { InsightAction } from "@/lib/memory-insights"
import { isMissingDeletedAtColumnError } from "@/lib/sqlite-errors"

interface MemoryActionRow {
  id: string
  content: string
  type: string
  memory_layer: string | null
  expires_at: string | null
  scope: string
  project_id: string | null
  user_id: string | null
  tags: string | null
  category: string | null
  created_at: string
  updated_at: string
}

export interface ApplyMemoryInsightActionInput {
  kind: InsightAction["kind"]
  memoryIds: string[]
  proposedTags?: string[]
  nowIso?: string
}

export interface MemoryTagUpdate {
  id: string
  tags: string | null
}

export interface ApplyMemoryInsightActionResult {
  kind: InsightAction["kind"]
  appliedCount: number
  archivedIds: string[]
  updatedTags: MemoryTagUpdate[]
  canonicalId: string | null
  message: string
}

function parseIsoMs(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) return parsed
  return 0
}

function normalizeMemoryIds(memoryIds: string[]): string[] {
  const unique = new Set<string>()
  for (const id of memoryIds) {
    const normalized = id.trim()
    if (!normalized) continue
    unique.add(normalized)
  }
  return Array.from(unique)
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return []

  const unique = new Set<string>()
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase()
    if (!normalized) continue
    unique.add(normalized)
  }

  return Array.from(unique)
}

function parseTagsCsv(tags: string | null | undefined): string[] {
  if (!tags) return []

  const unique = new Set<string>()
  for (const entry of tags.split(",")) {
    const normalized = entry.trim().toLowerCase()
    if (!normalized) continue
    unique.add(normalized)
  }

  return Array.from(unique)
}

function tagsToCsv(tags: string[]): string | null {
  if (tags.length === 0) return null
  return tags.join(",")
}

function effectiveLayer(row: MemoryActionRow): MemoryLayer {
  if (row.memory_layer === "rule" || row.memory_layer === "working" || row.memory_layer === "long_term") {
    return row.memory_layer
  }

  return row.type === "rule" ? "rule" : "long_term"
}

function toGraphTags(tags: string | null): string[] {
  return parseTagsCsv(tags)
}

function byRecencyAndSizeDescending(a: MemoryActionRow, b: MemoryActionRow): number {
  const updatedDelta = parseIsoMs(b.updated_at) - parseIsoMs(a.updated_at)
  if (updatedDelta !== 0) return updatedDelta

  const createdDelta = parseIsoMs(b.created_at) - parseIsoMs(a.created_at)
  if (createdDelta !== 0) return createdDelta

  const contentDelta = b.content.trim().length - a.content.trim().length
  if (contentDelta !== 0) return contentDelta

  return a.id.localeCompare(b.id)
}

async function listActionRows(turso: TursoClient, ids: string[]): Promise<MemoryActionRow[]> {
  if (ids.length === 0) return []

  const placeholders = ids.map(() => "?").join(", ")
  const baseSelect = `SELECT id, content, type, memory_layer, expires_at, scope, project_id, user_id, tags, category, created_at, updated_at
                      FROM memories
                      WHERE id IN (${placeholders})`

  try {
    const result = await turso.execute({
      sql: `${baseSelect} AND deleted_at IS NULL`,
      args: ids,
    })

    return result.rows as unknown as MemoryActionRow[]
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) {
      throw error
    }

    const fallback = await turso.execute({
      sql: baseSelect,
      args: ids,
    })

    return fallback.rows as unknown as MemoryActionRow[]
  }
}

async function softDeleteMemory(turso: TursoClient, id: string, nowIso: string): Promise<void> {
  try {
    await turso.execute({
      sql: "UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      args: [nowIso, nowIso, id],
    })
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) {
      throw error
    }

    await turso.execute({
      sql: "DELETE FROM memories WHERE id = ?",
      args: [id],
    })
  }
}

async function updateMemoryTags(
  turso: TursoClient,
  row: MemoryActionRow,
  nextTags: string | null,
  nowIso: string,
): Promise<MemoryTagUpdate> {
  try {
    await turso.execute({
      sql: "UPDATE memories SET tags = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      args: [nextTags, nowIso, row.id],
    })
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) {
      throw error
    }

    await turso.execute({
      sql: "UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?",
      args: [nextTags, nowIso, row.id],
    })
  }

  if (GRAPH_MAPPING_ENABLED) {
    try {
      await syncMemoryGraphMapping(turso, {
        id: row.id,
        content: row.content,
        type: row.type,
        layer: effectiveLayer(row),
        expiresAt: row.expires_at,
        projectId: row.project_id,
        userId: row.user_id,
        tags: toGraphTags(nextTags),
        category: row.category,
      })
    } catch (error) {
      console.error("Graph mapping sync failed for memory insight tag update:", error)
    }
  }

  return {
    id: row.id,
    tags: nextTags,
  }
}

async function removeGraphMappingBestEffort(turso: TursoClient, memoryId: string): Promise<void> {
  if (!GRAPH_MAPPING_ENABLED) return

  try {
    await removeMemoryGraphMapping(turso, memoryId)
  } catch (error) {
    console.error("Graph mapping cleanup failed for memory insight action:", error)
  }
}

function formatActionMessage(kind: InsightAction["kind"], result: ApplyMemoryInsightActionResult): string {
  if (kind === "archive") {
    return `Archived ${result.archivedIds.length} stale memory${result.archivedIds.length === 1 ? "" : "ies"}.`
  }

  if (kind === "relabel") {
    return `Updated tags for ${result.updatedTags.length} memory${result.updatedTags.length === 1 ? "" : "ies"}.`
  }

  if (result.canonicalId) {
    return `Merged ${result.archivedIds.length + 1} memories into ${result.canonicalId}.`
  }

  return "Merged duplicate memories."
}

export async function applyMemoryInsightAction(
  turso: TursoClient,
  input: ApplyMemoryInsightActionInput,
): Promise<ApplyMemoryInsightActionResult> {
  const kind = input.kind
  const nowIso = input.nowIso ?? new Date().toISOString()
  const memoryIds = normalizeMemoryIds(input.memoryIds)

  if (memoryIds.length === 0) {
    throw new Error("Select at least one memory to apply this action")
  }

  if (kind === "merge" && memoryIds.length < 2) {
    throw new Error("Merge actions require at least two memories")
  }

  const proposedTags = normalizeTags(input.proposedTags)
  if (kind === "relabel" && proposedTags.length === 0) {
    throw new Error("Relabel actions require at least one proposed tag")
  }

  const rows = await listActionRows(turso, memoryIds)
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const targetRows = memoryIds.map((id) => rowById.get(id)).filter((row): row is MemoryActionRow => Boolean(row))

  if (targetRows.length === 0) {
    return {
      kind,
      appliedCount: 0,
      archivedIds: [],
      updatedTags: [],
      canonicalId: null,
      message: "No matching active memories found for this action.",
    }
  }

  const archivedIds: string[] = []
  const updatedTags: MemoryTagUpdate[] = []
  let canonicalId: string | null = null

  if (kind === "archive") {
    for (const row of targetRows) {
      await softDeleteMemory(turso, row.id, nowIso)
      await removeGraphMappingBestEffort(turso, row.id)
      archivedIds.push(row.id)
    }
  } else if (kind === "relabel") {
    for (const row of targetRows) {
      const next = Array.from(new Set([...parseTagsCsv(row.tags), ...proposedTags]))
      const nextCsv = tagsToCsv(next)
      const tagUpdate = await updateMemoryTags(turso, row, nextCsv, nowIso)
      updatedTags.push(tagUpdate)
    }
  } else {
    if (targetRows.length < 2) {
      throw new Error("Merge action requires at least two active memories")
    }

    const sorted = [...targetRows].sort(byRecencyAndSizeDescending)
    const canonical = sorted[0]
    canonicalId = canonical.id

    const mergedTagSet = new Set<string>()
    for (const row of sorted) {
      for (const tag of parseTagsCsv(row.tags)) {
        mergedTagSet.add(tag)
      }
    }

    const canonicalTagsCsv = tagsToCsv(Array.from(mergedTagSet))
    const canonicalTagUpdate = await updateMemoryTags(turso, canonical, canonicalTagsCsv, nowIso)
    updatedTags.push(canonicalTagUpdate)

    for (const duplicate of sorted.slice(1)) {
      await softDeleteMemory(turso, duplicate.id, nowIso)
      await removeGraphMappingBestEffort(turso, duplicate.id)
      archivedIds.push(duplicate.id)
    }
  }

  const result: ApplyMemoryInsightActionResult = {
    kind,
    appliedCount: archivedIds.length + updatedTags.length,
    archivedIds,
    updatedTags,
    canonicalId,
    message: "",
  }

  result.message = formatActionMessage(kind, result)
  return result
}
