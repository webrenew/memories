import {
  apiError,
  defaultLayerForType,
  type MemoryRow,
  MCP_WORKING_MEMORY_MAX_ITEMS_PER_USER,
  toStructuredMemory,
  ToolExecutionError,
  type TursoClient,
  VALID_TYPES,
} from "./types"
import { buildNotExpiredFilter, parseMemoryLayer, workingMemoryExpiresAt } from "./scope"

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

  if (args.content !== undefined) {
    updates.push("content = ?")
    updateArgs.push(args.content as string)
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

  await turso.execute({
    sql: `UPDATE memories SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL${
      userId ? " AND user_id = ?" : " AND user_id IS NULL"
    }`,
    args: [...updateArgs, ...whereArgs],
  })

  if (requestedLayer === "working") {
    await compactWorkingMemoriesForUser(turso, userId, nowIso)
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
}): Promise<{ text: string; data: { id: string; deleted: true; message: string } }> {
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

  await turso.execute({
    sql: `UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL${
      userId ? " AND user_id = ?" : " AND user_id IS NULL"
    }`,
    args: userId ? [nowIso, id, userId] : [nowIso, id],
  })

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
