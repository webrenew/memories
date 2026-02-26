import {
  apiError,
  defaultLayerForType,
  GRAPH_MAPPING_ENABLED,
  type MemoryRow,
  MCP_WORKING_MEMORY_MAX_ITEMS_PER_USER,
  toStructuredMemory,
  ToolExecutionError,
  type TursoClient,
  VALID_TYPES,
} from "./types"
import { buildNotExpiredFilter, parseMemoryLayer, workingMemoryExpiresAt } from "./scope"
import { bulkRemoveMemoryGraphMappings, removeMemoryGraphMapping, syncMemoryGraphMapping } from "./graph/upsert"
import { enqueueEmbeddingJob, triggerEmbeddingQueueProcessing } from "@/lib/sdk-embeddings/jobs"

function getRowsAffected(result: unknown): number | null {
  if (!result || typeof result !== "object") {
    return null
  }

  const rowsAffected = (result as { rowsAffected?: unknown }).rowsAffected
  if (typeof rowsAffected === "number" && Number.isFinite(rowsAffected)) {
    return rowsAffected
  }

  return null
}

function notFoundError(id: string): ToolExecutionError {
  return new ToolExecutionError(
    apiError({
      type: "not_found_error",
      code: "MEMORY_NOT_FOUND",
      message: `Memory not found: ${id}`,
      status: 404,
      retryable: false,
      details: { id },
    }),
    { rpcCode: -32004 }
  )
}

async function compactWorkingMemoriesForUser(
  turso: TursoClient,
  userId: string | null,
  nowIso: string
): Promise<void> {
  await turso.execute({
    sql: `UPDATE memories
          SET deleted_at = ?, updated_at = ?
          WHERE deleted_at IS NULL
            AND memory_layer = 'working'
            AND expires_at IS NOT NULL
            AND expires_at <= ?`,
    args: [nowIso, nowIso, nowIso],
  })

  const activeFilter = buildNotExpiredFilter(nowIso)
  let sql = `UPDATE memories
             SET deleted_at = ?, updated_at = ?
             WHERE id IN (
               SELECT id FROM memories
               WHERE deleted_at IS NULL
                 AND memory_layer = 'working'
                 AND ${activeFilter.clause}`
  const args: (string | number)[] = [nowIso, nowIso, ...activeFilter.args]

  if (userId) {
    sql += " AND user_id = ?"
    args.push(userId)
  } else {
    sql += " AND user_id IS NULL"
  }

  sql += " ORDER BY updated_at DESC, created_at DESC LIMIT -1 OFFSET ?)"
  args.push(MCP_WORKING_MEMORY_MAX_ITEMS_PER_USER)

  await turso.execute({ sql, args })
}

interface ConsolidationCandidateRow {
  id: string
  content: string
  type: string
  scope: "global" | "project"
  project_id: string | null
  user_id: string | null
  category: string | null
  upsert_key: string | null
  updated_at: string
  created_at: string
}

interface ConsolidationRunRow {
  id: string
  scope: "global" | "project"
  project_id: string | null
  user_id: string | null
  input_count: number
  merged_count: number
  superseded_count: number
  conflicted_count: number
  model: string | null
  created_at: string
  metadata: string | null
}

function parseRunMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed metadata for backward compatibility
  }
  return null
}

function toStructuredConsolidationRun(row: ConsolidationRunRow) {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    userId: row.user_id,
    inputCount: row.input_count,
    mergedCount: row.merged_count,
    supersededCount: row.superseded_count,
    conflictedCount: row.conflicted_count,
    model: row.model,
    createdAt: row.created_at,
    metadata: parseRunMetadata(row.metadata),
  }
}

function normalizeUpsertKey(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
  return normalized || null
}

function deriveUpsertKey(memory: Pick<ConsolidationCandidateRow, "type" | "content" | "category">): string | null {
  const fromCategory = normalizeUpsertKey(memory.category ?? undefined)
  if (fromCategory) {
    return `${memory.type}:${fromCategory}`
  }

  const sourceLine = memory.content
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
  if (!sourceLine) return null

  const prefix = sourceLine.includes(":")
    ? sourceLine.split(":")[0]
    : sourceLine.split(/\s+/).slice(0, 6).join(" ")
  const normalizedPrefix = normalizeUpsertKey(prefix)
  if (!normalizedPrefix) return null
  return `${memory.type}:${normalizedPrefix}`
}

function normalizeComparableContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase()
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

async function ensureMemoryLinksTable(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id)")
}

async function ensureMemoryLink(
  turso: TursoClient,
  sourceId: string,
  targetId: string,
  linkType: "supersedes" | "contradicts",
  nowIso: string
): Promise<void> {
  const existing = await turso.execute({
    sql: `SELECT id FROM memory_links WHERE source_id = ? AND target_id = ? AND link_type = ? LIMIT 1`,
    args: [sourceId, targetId, linkType],
  })

  if (existing.rows.length > 0) return

  await turso.execute({
    sql: `INSERT INTO memory_links (id, source_id, target_id, link_type, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID().replace(/-/g, "").slice(0, 12), sourceId, targetId, linkType, nowIso],
  })
}

export async function consolidateMemoriesPayload(params: {
  turso: TursoClient
  args: Record<string, unknown>
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{
  text: string
  data: {
    runId: string
    message: string
    run: ReturnType<typeof toStructuredConsolidationRun>
    winnerMemoryIds: string[]
    supersededMemoryIds: string[]
  }
}> {
  const { turso, args, projectId, userId, nowIso } = params

  const includeGlobalRaw = args.includeGlobal ?? args.include_global
  const includeGlobal = typeof includeGlobalRaw === "boolean" ? includeGlobalRaw : true
  const globalOnlyRaw = args.globalOnly ?? args.global_only
  const globalOnly = globalOnlyRaw === true
  const dryRunRaw = args.dryRun ?? args.dry_run
  const dryRun = dryRunRaw === true
  const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : null

  const requestedTypes = Array.isArray(args.types)
    ? (args.types as string[]).filter((candidate) => VALID_TYPES.has(candidate))
    : []
  const types = requestedTypes.length > 0 ? requestedTypes : ["rule", "decision", "fact", "note"]
  const typePlaceholders = types.map(() => "?").join(", ")

  const scopeClauses: string[] = []
  const scopeArgs: (string | number)[] = []
  if (globalOnly || !projectId) {
    scopeClauses.push("scope = 'global'")
  } else if (includeGlobal) {
    scopeClauses.push("scope = 'global'")
    scopeClauses.push("(scope = 'project' AND project_id = ?)")
    scopeArgs.push(projectId)
  } else {
    scopeClauses.push("(scope = 'project' AND project_id = ?)")
    scopeArgs.push(projectId)
  }

  const userClause = userId ? "user_id = ?" : "user_id IS NULL"
  const userArgs = userId ? [userId] : []

  const candidatesResult = await turso.execute({
    sql: `SELECT id, content, type, scope, project_id, user_id, category, upsert_key, updated_at, created_at
          FROM memories
          WHERE deleted_at IS NULL
            AND superseded_at IS NULL
            AND ${userClause}
            AND (${scopeClauses.join(" OR ")})
            AND type IN (${typePlaceholders})`,
    args: [...userArgs, ...scopeArgs, ...types],
  })

  const candidates = candidatesResult.rows as unknown as ConsolidationCandidateRow[]
  const groups = new Map<string, ConsolidationCandidateRow[]>()
  const winnerMemoryIds: string[] = []
  const supersededMemoryIds: string[] = []

  for (const candidate of candidates) {
    const upsertKey = normalizeUpsertKey(candidate.upsert_key ?? undefined) ?? deriveUpsertKey(candidate)
    if (!upsertKey) continue

    const groupKey = `${candidate.scope}|${candidate.project_id ?? "global"}|${candidate.user_id ?? "anon"}|${candidate.type}|${upsertKey}`
    const bucket = groups.get(groupKey) ?? []
    bucket.push(candidate)
    groups.set(groupKey, bucket)

    if (!dryRun && !candidate.upsert_key) {
      await turso.execute({
        sql: "UPDATE memories SET upsert_key = ?, updated_at = ? WHERE id = ?",
        args: [upsertKey, nowIso, candidate.id],
      })
    }
  }

  let mergedCount = 0
  let conflictedCount = 0

  if (!dryRun) {
    await ensureMemoryLinksTable(turso)
  }

  for (const [groupKey, bucket] of groups) {
    if (bucket.length <= 1) continue

    const groupParts = groupKey.split("|")
    const upsertKey = groupParts[groupParts.length - 1] ?? ""
    const sorted = [...bucket].sort((a, b) => {
      const updatedDiff = parseTimestamp(b.updated_at) - parseTimestamp(a.updated_at)
      if (updatedDiff !== 0) return updatedDiff
      return parseTimestamp(b.created_at) - parseTimestamp(a.created_at)
    })

    const winner = sorted[0]
    const losers = sorted.slice(1)
    mergedCount += 1
    winnerMemoryIds.push(winner.id)

    if (!dryRun) {
      await turso.execute({
        sql: `UPDATE memories
              SET upsert_key = ?,
                  confidence = COALESCE(confidence, 1.0),
                  last_confirmed_at = COALESCE(last_confirmed_at, ?),
                  updated_at = ?
              WHERE id = ?`,
        args: [upsertKey, nowIso, nowIso, winner.id],
      })
    }

    for (const loser of losers) {
      const conflicting = normalizeComparableContent(loser.content) !== normalizeComparableContent(winner.content)
      if (conflicting) {
        conflictedCount += 1
      }
      supersededMemoryIds.push(loser.id)

      if (dryRun) continue

      await turso.execute({
        sql: `UPDATE memories
              SET superseded_by = ?, superseded_at = ?, upsert_key = ?, updated_at = ?
              WHERE id = ?`,
        args: [winner.id, nowIso, upsertKey, nowIso, loser.id],
      })
      await ensureMemoryLink(turso, winner.id, loser.id, "supersedes", nowIso)
      if (conflicting) {
        await ensureMemoryLink(turso, winner.id, loser.id, "contradicts", nowIso)
      }
    }
  }

  const run: ConsolidationRunRow = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    scope: !globalOnly && projectId ? "project" : "global",
    project_id: !globalOnly ? projectId ?? null : null,
    user_id: userId,
    input_count: candidates.length,
    merged_count: mergedCount,
    superseded_count: supersededMemoryIds.length,
    conflicted_count: conflictedCount,
    model,
    created_at: nowIso,
    metadata: JSON.stringify({
      dryRun,
      includeGlobal,
      globalOnly,
      types,
      candidateGroups: groups.size,
    }),
  }

  await turso.execute({
    sql: `INSERT INTO memory_consolidation_runs
          (id, scope, project_id, user_id, input_count, merged_count, superseded_count, conflicted_count, model, created_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.scope,
      run.project_id,
      run.user_id,
      run.input_count,
      run.merged_count,
      run.superseded_count,
      run.conflicted_count,
      run.model,
      run.created_at,
      run.metadata,
    ],
  })

  const message = `${dryRun ? "Dry-run " : ""}consolidation run ${run.id} completed`
  return {
    text: message,
    data: {
      runId: run.id,
      message,
      run: toStructuredConsolidationRun(run),
      winnerMemoryIds,
      supersededMemoryIds,
    },
  }
}

export async function addMemoryPayload(params: {
  turso: TursoClient
  args: Record<string, unknown>
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { memory: ReturnType<typeof toStructuredMemory>; id: string; message: string } }> {
  const { turso, args, projectId, userId, nowIso } = params

  const content = typeof args.content === "string" ? args.content.trim() : ""
  if (!content) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "MEMORY_CONTENT_REQUIRED",
        message: "Memory content is required",
        status: 400,
        retryable: false,
        details: { field: "content" },
      }),
      { rpcCode: -32602 }
    )
  }

  const memoryId = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  const rawType = (args.type as string) || "note"
  const type = VALID_TYPES.has(rawType) ? rawType : "note"
  const requestedLayer = parseMemoryLayer(args)
  const layer = requestedLayer ?? defaultLayerForType(type)
  const expiresAt = layer === "working" ? workingMemoryExpiresAt(nowIso) : null
  const tags = Array.isArray(args.tags) ? args.tags.join(",") : null
  const scope = projectId ? "project" : "global"
  const paths = Array.isArray(args.paths) ? args.paths.join(",") : null
  const category = (args.category as string) || null
  const metadata = args.metadata ? JSON.stringify(args.metadata) : null

  await turso.execute({
    sql: `INSERT INTO memories (id, content, type, memory_layer, expires_at, scope, project_id, user_id, tags, paths, category, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      memoryId,
      content,
      type,
      layer,
      expiresAt,
      scope,
      projectId || null,
      userId,
      tags,
      paths,
      category,
      metadata,
      nowIso,
      nowIso,
    ],
  })

  if (layer === "working") {
    await compactWorkingMemoriesForUser(turso, userId, nowIso)
  }

  if (GRAPH_MAPPING_ENABLED) {
    try {
      await syncMemoryGraphMapping(turso, {
        id: memoryId,
        content,
        type,
        layer,
        expiresAt,
        projectId: projectId || null,
        userId,
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
        category,
      })
    } catch (err) {
      console.error("Graph mapping sync failed on add_memory:", err)
    }
  }

  const embeddingModel = typeof args.embeddingModel === "string" ? args.embeddingModel.trim() : ""
  if (embeddingModel) {
    try {
      await enqueueEmbeddingJob({
        turso,
        memoryId,
        content,
        modelId: embeddingModel,
        operation: "add",
        nowIso,
      })
      triggerEmbeddingQueueProcessing(turso)
    } catch (err) {
      console.error("Embedding queue enqueue failed on add_memory:", err)
    }
  }

  const scopeLabel = projectId ? `project:${projectId.split("/").pop()}` : "global"
  const message = `Stored ${type} (${scopeLabel}): ${content.length > 80 ? `${content.slice(0, 80).trim()}...` : content}`

  const memory = toStructuredMemory({
    id: memoryId,
    content,
    type,
    memory_layer: layer,
    expires_at: expiresAt,
    scope,
    project_id: projectId || null,
    user_id: userId,
    tags,
    paths,
    category,
    metadata,
    created_at: nowIso,
    updated_at: nowIso,
  } satisfies Partial<MemoryRow>)

  return {
    text: message,
    data: {
      memory,
      id: memoryId,
      message,
    },
  }
}

export async function editMemoryPayload(params: {
  turso: TursoClient
  args: Record<string, unknown>
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { id: string; updated: true; message: string } }> {
  const { turso, args, userId, nowIso } = params

  const id = args.id as string
  if (!id) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "MEMORY_ID_REQUIRED",
        message: "Memory id is required",
        status: 400,
        retryable: false,
        details: { field: "id" },
      }),
      { rpcCode: -32602 }
    )
  }

  const updates: string[] = ["updated_at = ?"]
  const updateArgs: (string | null)[] = [nowIso]
  const requestedLayer = parseMemoryLayer(args)
  let updatedContent: string | null = null

  if (args.content !== undefined) {
    const nextContent = typeof args.content === "string" ? args.content.trim() : ""
    if (!nextContent) {
      throw new ToolExecutionError(
        apiError({
          type: "validation_error",
          code: "MEMORY_CONTENT_REQUIRED",
          message: "Memory content is required",
          status: 400,
          retryable: false,
          details: { field: "content" },
        }),
        { rpcCode: -32602 }
      )
    }
    updates.push("content = ?")
    updateArgs.push(nextContent)
    updatedContent = nextContent
  }
  if (args.type !== undefined && VALID_TYPES.has(args.type as string)) {
    updates.push("type = ?")
    updateArgs.push(args.type as string)
    if (args.layer === undefined && args.type === "rule") {
      updates.push("memory_layer = ?")
      updateArgs.push("rule")
      updates.push("expires_at = ?")
      updateArgs.push(null)
    }
  }
  if (args.tags !== undefined) {
    updates.push("tags = ?")
    updateArgs.push(Array.isArray(args.tags) ? args.tags.join(",") : null)
  }
  if (args.paths !== undefined) {
    updates.push("paths = ?")
    updateArgs.push(Array.isArray(args.paths) ? args.paths.join(",") : null)
  }
  if (args.category !== undefined) {
    updates.push("category = ?")
    updateArgs.push((args.category as string) || null)
  }
  if (args.metadata !== undefined) {
    updates.push("metadata = ?")
    updateArgs.push(args.metadata ? JSON.stringify(args.metadata) : null)
  }
  if (requestedLayer !== null) {
    updates.push("memory_layer = ?")
    updateArgs.push(requestedLayer)
    updates.push("expires_at = ?")
    updateArgs.push(requestedLayer === "working" ? workingMemoryExpiresAt(nowIso) : null)
  }

  const whereArgs: (string | null)[] = [id]
  if (userId) {
    whereArgs.push(userId)
  }

  const updateResult = await turso.execute({
    sql: `UPDATE memories SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL${
      userId ? " AND user_id = ?" : " AND user_id IS NULL"
    }`,
    args: [...updateArgs, ...whereArgs],
  })
  const rowsAffected = getRowsAffected(updateResult)
  if (rowsAffected === 0) {
    throw notFoundError(id)
  }

  if (requestedLayer === "working") {
    await compactWorkingMemoriesForUser(turso, userId, nowIso)
  }

  if (GRAPH_MAPPING_ENABLED) {
    try {
      const memoryResult = await turso.execute({
        sql: `SELECT id, content, type, memory_layer, expires_at, project_id, user_id, tags, category
              FROM memories
              WHERE id = ? AND deleted_at IS NULL
              LIMIT 1`,
        args: [id],
      })

      const row = memoryResult.rows[0] as unknown as
        | {
            id: string
            content: string
            type: string
            memory_layer: string | null
            expires_at: string | null
            project_id: string | null
            user_id: string | null
            tags: string | null
            category: string | null
          }
        | undefined

      if (row) {
        const layer = row.memory_layer === "rule" || row.memory_layer === "working" || row.memory_layer === "long_term"
          ? row.memory_layer
          : row.type === "rule"
            ? "rule"
            : "long_term"

        const tags = row.tags
          ? row.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : []

        await syncMemoryGraphMapping(turso, {
          id: row.id,
          content: row.content,
          type: row.type,
          layer,
          expiresAt: row.expires_at,
          projectId: row.project_id,
          userId: row.user_id,
          tags,
          category: row.category,
        })
      } else {
        await removeMemoryGraphMapping(turso, id)
      }
    } catch (err) {
      console.error("Graph mapping sync failed on edit_memory:", err)
    }
  }

  const embeddingModel = typeof args.embeddingModel === "string" ? args.embeddingModel.trim() : ""
  if (embeddingModel && updatedContent) {
    try {
      await enqueueEmbeddingJob({
        turso,
        memoryId: id,
        content: updatedContent,
        modelId: embeddingModel,
        operation: "edit",
        nowIso,
      })
      triggerEmbeddingQueueProcessing(turso)
    } catch (err) {
      console.error("Embedding queue enqueue failed on edit_memory:", err)
    }
  }

  const message = `Updated memory ${id}`
  return {
    text: message,
    data: {
      id,
      updated: true,
      message,
    },
  }
}

export async function forgetMemoryPayload(params: {
  turso: TursoClient
  args: Record<string, unknown>
  userId: string | null
  nowIso: string
  onlyWorkingLayer?: boolean
}): Promise<{ text: string; data: { id: string; deleted: true; message: string } }> {
  const { turso, args, userId, nowIso, onlyWorkingLayer } = params

  const id = args.id as string
  if (!id) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "MEMORY_ID_REQUIRED",
        message: "Memory id is required",
        status: 400,
        retryable: false,
        details: { field: "id" },
      }),
      { rpcCode: -32602 }
    )
  }

  const forgetResult = await turso.execute({
    sql: `UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL${
      userId ? " AND user_id = ?" : " AND user_id IS NULL"
    }${onlyWorkingLayer ? " AND memory_layer = 'working'" : ""}`,
    args: userId ? [nowIso, nowIso, id, userId] : [nowIso, nowIso, id],
  })
  const rowsAffected = getRowsAffected(forgetResult)
  if (rowsAffected === 0 && !onlyWorkingLayer) {
    throw notFoundError(id)
  }

  if (GRAPH_MAPPING_ENABLED) {
    try {
      await removeMemoryGraphMapping(turso, id)
    } catch (err) {
      console.error("Graph mapping cleanup failed on forget_memory:", err)
    }
  }

  const message = `Deleted memory ${id}`
  return {
    text: message,
    data: {
      id,
      deleted: true,
      message,
    },
  }
}

const BULK_FORGET_BATCH_SIZE = 500

export async function bulkForgetMemoriesPayload(params: {
  turso: TursoClient
  args: Record<string, unknown>
  userId: string | null
  nowIso: string
  onlyWorkingLayer?: boolean
}): Promise<{
  text: string
  data: {
    count: number
    ids?: string[]
    memories?: { id: string; type: string; contentPreview: string }[]
    message: string
  }
}> {
  const { turso, args, userId, nowIso, onlyWorkingLayer } = params

  const typesRaw = Array.isArray(args.types) ? (args.types as string[]).filter((t) => VALID_TYPES.has(t)) : undefined
  const types = typesRaw && typesRaw.length > 0 ? typesRaw : undefined
  const tagsRaw = Array.isArray(args.tags) ? (args.tags as string[]).filter(Boolean) : undefined
  const tags = tagsRaw && tagsRaw.length > 0 ? tagsRaw : undefined
  const olderThanDays = typeof args.older_than_days === "number" && Number.isFinite(args.older_than_days) && args.older_than_days > 0 ? Math.max(1, Math.ceil(args.older_than_days)) : undefined
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : undefined
  const projectId = typeof args.project_id === "string" ? args.project_id.trim() : undefined
  const all = args.all === true
  const dryRun = args.dry_run === true

  if (all && (types || tags || olderThanDays || pattern)) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "BULK_FORGET_INVALID_FILTERS",
        message: "Cannot combine all:true with other filters",
        status: 400,
        retryable: false,
      }),
      { rpcCode: -32602 }
    )
  }

  if (!all && !types && !tags && !olderThanDays && !pattern) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "BULK_FORGET_NO_FILTERS",
        message: "Provide at least one filter (types, tags, older_than_days, pattern), or use all:true. project_id alone is not a sufficient filter.",
        status: 400,
        retryable: false,
      }),
      { rpcCode: -32602 }
    )
  }

  const whereClauses: string[] = ["deleted_at IS NULL"]
  const whereArgs: (string | number)[] = []

  if (userId) {
    whereClauses.push("user_id = ?")
    whereArgs.push(userId)
  } else {
    whereClauses.push("user_id IS NULL")
  }

  if (onlyWorkingLayer) {
    whereClauses.push("memory_layer = 'working'")
  }

  if (types && types.length > 0) {
    whereClauses.push(`type IN (${types.map(() => "?").join(", ")})`)
    whereArgs.push(...types)
  }

  if (tags && tags.length > 0) {
    const tagClauses = tags.map(() => "tags LIKE ? ESCAPE '\\'")
    whereClauses.push(`(${tagClauses.join(" OR ")})`)
    for (const tag of tags) {
      const escaped = tag.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
      whereArgs.push(`%${escaped}%`)
    }
  }

  if (olderThanDays) {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
    whereClauses.push("created_at < ?")
    whereArgs.push(cutoff)
  }

  if (pattern) {
    const escaped = pattern.replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/\*/g, "%").replace(/\?/g, "_")
    whereClauses.push("content LIKE ? ESCAPE '\\'")
    whereArgs.push(`%${escaped}%`)
  }

  if (projectId) {
    whereClauses.push("project_id = ?")
    whereArgs.push(projectId)
  }

  const whereSQL = whereClauses.join(" AND ")

  if (dryRun) {
    // Fetch up to 1001 rows to detect overflow without an unbounded COUNT(*)
    const DRY_RUN_LIMIT = 1000
    const result = await turso.execute({
      sql: `SELECT id, type, content FROM memories WHERE ${whereSQL} ORDER BY created_at DESC LIMIT ?`,
      args: [...whereArgs, DRY_RUN_LIMIT + 1],
    })

    const rows = result.rows as unknown as { id: string; type: string; content: string }[]
    const hasMore = rows.length > DRY_RUN_LIMIT
    const displayRows = hasMore ? rows.slice(0, DRY_RUN_LIMIT) : rows

    const memories = displayRows.map((row) => ({
      id: row.id,
      type: row.type,
      contentPreview: row.content.length > 80 ? `${row.content.slice(0, 80).trim()}...` : row.content,
    }))

    const message = hasMore
      ? `Dry run: more than ${DRY_RUN_LIMIT} memories would be deleted (showing first ${DRY_RUN_LIMIT})`
      : `Dry run: ${rows.length} memories would be deleted`
    return {
      text: message,
      data: { count: hasMore ? DRY_RUN_LIMIT : rows.length, memories, message },
    }
  }

  // Fetch IDs to delete in batches
  const selectResult = await turso.execute({
    sql: `SELECT id FROM memories WHERE ${whereSQL}`,
    args: whereArgs,
  })

  const ids = (selectResult.rows as unknown as { id: string }[]).map((row) => row.id)

  if (ids.length === 0) {
    const message = "No memories matched the filters"
    return {
      text: message,
      data: { count: 0, ids: [], message },
    }
  }

  // Batch soft-delete
  for (let i = 0; i < ids.length; i += BULK_FORGET_BATCH_SIZE) {
    const batch = ids.slice(i, i + BULK_FORGET_BATCH_SIZE)
    const placeholders = batch.map(() => "?").join(", ")
    await turso.execute({
      sql: `UPDATE memories SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`,
      args: [nowIso, nowIso, ...batch],
    })
  }

  // Clean up graph mappings (batched)
  if (GRAPH_MAPPING_ENABLED) {
    try {
      await bulkRemoveMemoryGraphMappings(turso, ids)
    } catch (err) {
      console.error("Graph mapping cleanup failed on bulk_forget:", err)
    }
  }

  const message = `Bulk deleted ${ids.length} memories`
  return {
    text: message,
    data: { count: ids.length, ids, message },
  }
}

export async function vacuumMemoriesPayload(params: {
  turso: TursoClient
  userId: string | null
  onlyWorkingLayer?: boolean
}): Promise<{ text: string; data: { purged: number; message: string } }> {
  const { turso, userId, onlyWorkingLayer } = params

  const whereClauses: string[] = ["deleted_at IS NOT NULL"]
  const whereArgs: (string | number)[] = []

  if (userId) {
    whereClauses.push("user_id = ?")
    whereArgs.push(userId)
  } else {
    whereClauses.push("user_id IS NULL")
  }

  if (onlyWorkingLayer) {
    whereClauses.push("memory_layer = 'working'")
  }

  const whereSQL = whereClauses.join(" AND ")
  let candidateIds: string[] = []

  if (GRAPH_MAPPING_ENABLED) {
    try {
      const result = await turso.execute({
        sql: `SELECT id FROM memories WHERE ${whereSQL}`,
        args: whereArgs,
      })

      candidateIds = result.rows
        .map((row) => row.id as string | null)
        .filter((id): id is string => Boolean(id))
    } catch (err) {
      console.error("Graph mapping pre-vacuum lookup failed:", err)
    }
  }

  const [, changesResult] = await turso.batch([
    { sql: `DELETE FROM memories WHERE ${whereSQL}`, args: whereArgs },
    { sql: `SELECT changes() as cnt`, args: [] },
  ])

  const purged = Number((changesResult.rows[0] as unknown as { cnt: number }).cnt) || 0

  if (GRAPH_MAPPING_ENABLED && candidateIds.length > 0) {
    try {
      await bulkRemoveMemoryGraphMappings(turso, candidateIds)
    } catch (err) {
      console.error("Graph mapping cleanup failed on vacuum_memories:", err)
    }
  }

  const message = purged > 0
    ? `Vacuumed ${purged} soft-deleted memories`
    : "No soft-deleted memories to vacuum"

  return {
    text: message,
    data: { purged, message },
  }
}
