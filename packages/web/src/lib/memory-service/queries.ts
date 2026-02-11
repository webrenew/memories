import {
  apiError,
  formatMemory,
  MEMORY_COLUMNS,
  MEMORY_COLUMNS_ALIASED,
  type MemoryLayer,
  type MemoryRow,
  toStructuredMemory,
  ToolExecutionError,
  type TursoClient,
  VALID_TYPES,
} from "./types"
import {
  buildLayerFilterClause,
  buildNotExpiredFilter,
  buildUserScopeFilter,
  parseMemoryLayer,
} from "./scope"

function dedupeMemories(rows: MemoryRow[]): MemoryRow[] {
  const seen = new Set<string>()
  const deduped: MemoryRow[] = []
  for (const row of rows) {
    const key = row.id || `${row.type}:${row.scope}:${row.content}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(row)
  }
  return deduped
}

async function searchWithFts(
  turso: TursoClient,
  query: string,
  projectId: string | undefined,
  userId: string | null,
  nowIso: string,
  limit: number,
  options?: { excludeType?: string; includeType?: string; includeLayer?: MemoryLayer }
): Promise<MemoryRow[]> {
  const { excludeType, includeType, includeLayer } = options ?? {}
  const userFilter = buildUserScopeFilter(userId, "m.")
  const layerFilter = buildLayerFilterClause(includeLayer ?? null, "m.")
  const activeFilter = buildNotExpiredFilter(nowIso, "m.")

  try {
    let typeFilter = ""
    const ftsArgs: (string | number)[] = [query]

    if (excludeType && VALID_TYPES.has(excludeType)) {
      typeFilter = "AND m.type != ?"
      ftsArgs.push(excludeType)
    } else if (includeType && VALID_TYPES.has(includeType)) {
      typeFilter = "AND m.type = ?"
      ftsArgs.push(includeType)
    }

    const projectFilter = projectId
      ? `AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))`
      : `AND m.scope = 'global'`
    if (projectId) ftsArgs.push(projectId)
    ftsArgs.push(...userFilter.args)
    ftsArgs.push(...activeFilter.args)
    ftsArgs.push(limit)

    const ftsResult = await turso.execute({
      sql: `SELECT ${MEMORY_COLUMNS_ALIASED}
            FROM memories_fts fts
            JOIN memories m ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ? AND m.deleted_at IS NULL
            ${typeFilter} ${projectFilter} AND ${userFilter.clause} AND ${layerFilter.clause} AND ${activeFilter.clause}
            ORDER BY bm25(memories_fts) LIMIT ?`,
      args: ftsArgs,
    })

    if (ftsResult.rows.length > 0) {
      return ftsResult.rows as unknown as MemoryRow[]
    }
  } catch {
    // FTS table may not exist for older DBs — fall through to LIKE.
  }

  let sql = `SELECT ${MEMORY_COLUMNS} FROM memories
             WHERE deleted_at IS NULL AND content LIKE ?`
  const sqlArgs: (string | number)[] = [`%${query}%`]

  if (excludeType && VALID_TYPES.has(excludeType)) {
    sql += " AND type != ?"
    sqlArgs.push(excludeType)
  } else if (includeType && VALID_TYPES.has(includeType)) {
    sql += " AND type = ?"
    sqlArgs.push(includeType)
  }

  const fallbackUserFilter = buildUserScopeFilter(userId)
  sql += ` AND ${fallbackUserFilter.clause}`
  sqlArgs.push(...fallbackUserFilter.args)
  const fallbackLayerFilter = buildLayerFilterClause(includeLayer ?? null)
  sql += ` AND ${fallbackLayerFilter.clause}`
  const fallbackActiveFilter = buildNotExpiredFilter(nowIso)
  sql += ` AND ${fallbackActiveFilter.clause}`
  sqlArgs.push(...fallbackActiveFilter.args)

  sql += " AND (scope = 'global'"
  if (projectId) {
    sql += " OR (scope = 'project' AND project_id = ?)"
    sqlArgs.push(projectId)
  }
  sql += ") ORDER BY created_at DESC LIMIT ?"
  sqlArgs.push(limit)

  const result = await turso.execute({ sql, args: sqlArgs })
  return result.rows as unknown as MemoryRow[]
}

async function listRecentMemoriesByLayer(
  turso: TursoClient,
  projectId: string | undefined,
  userId: string | null,
  layer: MemoryLayer,
  nowIso: string,
  limit: number,
  options?: { excludeType?: string }
): Promise<MemoryRow[]> {
  const userFilter = buildUserScopeFilter(userId)
  const layerFilter = buildLayerFilterClause(layer)
  const activeFilter = buildNotExpiredFilter(nowIso)
  let sql = `SELECT ${MEMORY_COLUMNS} FROM memories
             WHERE deleted_at IS NULL
             AND ${userFilter.clause}
             AND ${layerFilter.clause}
             AND ${activeFilter.clause}
             AND (scope = 'global'`
  const args: (string | number)[] = [...userFilter.args, ...activeFilter.args]

  if (projectId) {
    sql += " OR (scope = 'project' AND project_id = ?)"
    args.push(projectId)
  }
  sql += ")"

  if (options?.excludeType && VALID_TYPES.has(options.excludeType)) {
    sql += " AND type != ?"
    args.push(options.excludeType)
  }

  sql += " ORDER BY updated_at DESC LIMIT ?"
  args.push(limit)

  const result = await turso.execute({ sql, args })
  return result.rows as unknown as MemoryRow[]
}

export async function getContextPayload(params: {
  turso: TursoClient
  projectId?: string
  userId: string | null
  nowIso: string
  query: string
  limit: number
}): Promise<{
  text: string
  data: {
    rules: ReturnType<typeof toStructuredMemory>[]
    workingMemories: ReturnType<typeof toStructuredMemory>[]
    longTermMemories: ReturnType<typeof toStructuredMemory>[]
    memories: ReturnType<typeof toStructuredMemory>[]
  }
}> {
  const { turso, projectId, userId, nowIso, query, limit } = params
  const workingLimit = Math.max(1, Math.min(limit, 3))

  let rulesSql = `SELECT ${MEMORY_COLUMNS} FROM memories
                  WHERE deleted_at IS NULL AND ${buildLayerFilterClause("rule").clause}
                  AND (scope = 'global'`
  const rulesArgs: (string | number)[] = []

  if (projectId) {
    rulesSql += " OR (scope = 'project' AND project_id = ?)"
    rulesArgs.push(projectId)
  }

  const userFilter = buildUserScopeFilter(userId)
  const activeFilter = buildNotExpiredFilter(nowIso)
  rulesSql += `) AND ${userFilter.clause} AND ${activeFilter.clause} ORDER BY scope DESC, created_at DESC`
  rulesArgs.push(...userFilter.args)
  rulesArgs.push(...activeFilter.args)

  const rulesResult = await turso.execute({ sql: rulesSql, args: rulesArgs })

  const globalRules = rulesResult.rows.filter((row) => row.scope === "global")
  const projectRules = rulesResult.rows.filter((row) => row.scope === "project")

  let text = ""
  if (projectRules.length > 0) {
    text += `## Project Rules\n${projectRules.map((row) => `- ${row.content}`).join("\n")}\n\n`
  }
  if (globalRules.length > 0) {
    text += `## Global Rules\n${globalRules.map((row) => `- ${row.content}`).join("\n")}`
  }

  let workingMemories: MemoryRow[] = []
  let longTermMemories: MemoryRow[] = []

  if (query) {
    workingMemories = await searchWithFts(turso, query, projectId, userId, nowIso, workingLimit, {
      includeLayer: "working",
    })
    const remaining = Math.max(1, limit - workingMemories.length)
    longTermMemories = await searchWithFts(turso, query, projectId, userId, nowIso, remaining, {
      includeLayer: "long_term",
      excludeType: "rule",
    })
  } else {
    workingMemories = await listRecentMemoriesByLayer(turso, projectId, userId, "working", nowIso, workingLimit)
    const remaining = Math.max(1, limit - workingMemories.length)
    longTermMemories = await listRecentMemoriesByLayer(turso, projectId, userId, "long_term", nowIso, remaining, {
      excludeType: "rule",
    })
  }

  const relevantMemories = dedupeMemories([...workingMemories, ...longTermMemories])
  if (relevantMemories.length > 0) {
    if (text.length > 0) {
      text += "\n\n"
    }
    text += `## Relevant Memories\n${relevantMemories.map((row) => `- ${formatMemory(row)}`).join("\n")}`
  }

  return {
    text: text || "No rules or memories found.",
    data: {
      rules: (rulesResult.rows as unknown as MemoryRow[]).map(toStructuredMemory),
      workingMemories: workingMemories.map(toStructuredMemory),
      longTermMemories: longTermMemories.map(toStructuredMemory),
      memories: relevantMemories.map(toStructuredMemory),
    },
  }
}

export async function getRulesPayload(params: {
  turso: TursoClient
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { rules: ReturnType<typeof toStructuredMemory>[] } }> {
  const { turso, projectId, userId, nowIso } = params

  let sql = `SELECT ${MEMORY_COLUMNS} FROM memories
             WHERE deleted_at IS NULL AND ${buildLayerFilterClause("rule").clause} AND (scope = 'global'`
  const sqlArgs: (string | number)[] = []

  if (projectId) {
    sql += " OR (scope = 'project' AND project_id = ?)"
    sqlArgs.push(projectId)
  }

  const userFilter = buildUserScopeFilter(userId)
  const activeFilter = buildNotExpiredFilter(nowIso)
  sql += `) AND ${userFilter.clause} AND ${activeFilter.clause} ORDER BY scope DESC, created_at DESC`
  sqlArgs.push(...userFilter.args)
  sqlArgs.push(...activeFilter.args)

  const result = await turso.execute({ sql, args: sqlArgs })

  if (result.rows.length === 0) {
    return { text: "No rules found.", data: { rules: [] } }
  }

  const globalRules = result.rows.filter((row) => row.scope === "global")
  const projectRules = result.rows.filter((row) => row.scope === "project")

  let text = ""
  if (projectRules.length > 0) {
    text += `## Project Rules\n${projectRules.map((row) => `- ${row.content}`).join("\n")}\n\n`
  }
  if (globalRules.length > 0) {
    text += `## Global Rules\n${globalRules.map((row) => `- ${row.content}`).join("\n")}`
  }

  return {
    text,
    data: {
      rules: (result.rows as unknown as MemoryRow[]).map(toStructuredMemory),
    },
  }
}

export async function searchMemoriesPayload(params: {
  turso: TursoClient
  args: Record<string, unknown>
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { memories: ReturnType<typeof toStructuredMemory>[]; count: number } }> {
  const { turso, args, projectId, userId, nowIso } = params

  const limit = (args.limit as number) || 10
  const query = typeof args.query === "string" ? args.query.trim() : ""
  if (!query) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "QUERY_REQUIRED",
        message: "Search query is required",
        status: 400,
        retryable: false,
        details: { field: "query" },
      }),
      { rpcCode: -32602 }
    )
  }

  const includeType = args.type && VALID_TYPES.has(args.type as string) ? (args.type as string) : undefined
  const layer = parseMemoryLayer(args) ?? undefined

  const results = await searchWithFts(turso, query, projectId, userId, nowIso, limit, {
    includeType,
    includeLayer: layer,
  })

  if (results.length === 0) {
    return { text: "No memories found.", data: { memories: [], count: 0 } }
  }

  const text = `Found ${results.length} memories:\n\n${results.map((row) => formatMemory(row)).join("\n")}`
  return {
    text,
    data: {
      memories: results.map(toStructuredMemory),
      count: results.length,
    },
  }
}

export async function listMemoriesPayload(params: {
  turso: TursoClient
  args: Record<string, unknown>
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { memories: ReturnType<typeof toStructuredMemory>[]; count: number } }> {
  const { turso, args, projectId, userId, nowIso } = params

  const limit = (args.limit as number) || 20
  const requestedLayer = parseMemoryLayer(args)
  let sql = `SELECT ${MEMORY_COLUMNS} FROM memories WHERE deleted_at IS NULL`
  const sqlArgs: (string | number)[] = []

  const userFilter = buildUserScopeFilter(userId)
  sql += ` AND ${userFilter.clause}`
  sqlArgs.push(...userFilter.args)

  const layerFilter = buildLayerFilterClause(requestedLayer)
  sql += ` AND ${layerFilter.clause}`

  const activeFilter = buildNotExpiredFilter(nowIso)
  sql += ` AND ${activeFilter.clause}`
  sqlArgs.push(...activeFilter.args)

  sql += " AND (scope = 'global'"
  if (projectId) {
    sql += " OR (scope = 'project' AND project_id = ?)"
    sqlArgs.push(projectId)
  }
  sql += ")"

  if (args.type) {
    sql += " AND type = ?"
    sqlArgs.push(args.type as string)
  }

  if (args.tags) {
    sql += " AND tags LIKE ? ESCAPE '\\\\'"
    const escaped = (args.tags as string).replace(/[%_\\]/g, "\\$&")
    sqlArgs.push(`%${escaped}%`)
  }

  sql += " ORDER BY created_at DESC LIMIT ?"
  sqlArgs.push(limit)

  const result = await turso.execute({ sql, args: sqlArgs })
  if (result.rows.length === 0) {
    return { text: "No memories found.", data: { memories: [], count: 0 } }
  }

  const memories = (result.rows as unknown as MemoryRow[]).map(toStructuredMemory)
  const text = `${result.rows.length} memories:\n\n${(result.rows as unknown as MemoryRow[])
    .map((row) => formatMemory(row))
    .join("\n")}`

  return {
    text,
    data: {
      memories,
      count: result.rows.length,
    },
  }
}
