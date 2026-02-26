import { buildUserScopeFilter } from "./scope"
import { apiError, type TursoClient, ToolExecutionError } from "./types"

type SkillFileScope = "global" | "project"

interface SkillFileRow {
  id: string
  path: string
  content: string
  scope: SkillFileScope
  project_id: string | null
  user_id: string | null
  usage_count: number | null
  last_used_at: string | null
  procedure_key: string | null
  created_at: string
  updated_at: string
}

function normalizeScope(projectId?: string | null): SkillFileScope {
  return projectId ? "project" : "global"
}

function exactUserScopeFilter(userId: string | null): { clause: string; args: string[] } {
  if (userId) {
    return { clause: "user_id = ?", args: [userId] }
  }
  return { clause: "user_id IS NULL", args: [] }
}

function normalizeProcedureKey(value: string | null | undefined): string | null {
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

function deriveProcedureKeyFromPath(path: string): string | null {
  const parts = path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
  const fileName = parts[parts.length - 1]
  if (!fileName) return null
  const withoutExt = fileName.replace(/\.[a-z0-9]+$/i, "")
  return normalizeProcedureKey(withoutExt)
}

function deriveProcedureKeyFromQuery(query: string | null | undefined): string | null {
  if (!query) return null
  const firstLine = query
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return null

  const seed = firstLine.includes(":")
    ? firstLine.split(":")[0]
    : firstLine.split(/\s+/).slice(0, 6).join(" ")
  return normalizeProcedureKey(seed)
}

function toStructuredSkillFile(row: SkillFileRow) {
  return {
    id: row.id,
    path: row.path,
    content: row.content,
    scope: row.scope,
    projectId: row.project_id,
    userId: row.user_id,
    usageCount: typeof row.usage_count === "number" ? row.usage_count : 0,
    lastUsedAt: row.last_used_at ?? null,
    procedureKey: row.procedure_key ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function upsertSkillFilePayload(params: {
  turso: TursoClient
  path: string
  content: string
  procedureKey?: string | null
  projectId?: string | null
  userId: string | null
  nowIso: string
}): Promise<{
  text: string
  data: {
    skillFile: ReturnType<typeof toStructuredSkillFile>
    created: boolean
    message: string
  }
}> {
  const { turso, path, content, projectId, userId, nowIso } = params
  const normalizedPath = path.trim()
  const normalizedContent = content.trim()
  const normalizedProcedureKey = normalizeProcedureKey(params.procedureKey) ?? deriveProcedureKeyFromPath(normalizedPath)

  if (!normalizedPath) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "SKILL_FILE_PATH_REQUIRED",
        message: "skill file path is required",
        status: 400,
        retryable: false,
        details: { field: "path" },
      }),
      { rpcCode: -32602 }
    )
  }

  if (!normalizedContent) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "SKILL_FILE_CONTENT_REQUIRED",
        message: "skill file content is required",
        status: 400,
        retryable: false,
        details: { field: "content" },
      }),
      { rpcCode: -32602 }
    )
  }

  const scope = normalizeScope(projectId)
  const userFilter = exactUserScopeFilter(userId)
  const existingResult = await turso.execute({
    sql: `SELECT id
          FROM skill_files
          WHERE path = ?
            AND scope = ?
            AND ${scope === "project" ? "project_id = ?" : "project_id IS NULL"}
            AND ${userFilter.clause}
          ORDER BY deleted_at IS NULL DESC, updated_at DESC
          LIMIT 1`,
    args: [
      normalizedPath,
      scope,
      ...(scope === "project" ? [projectId as string] : []),
      ...userFilter.args,
    ],
  })

  const existingId = String(existingResult.rows[0]?.id ?? "")
  const id = existingId || crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  const created = existingId.length === 0

  if (created) {
    await turso.execute({
      sql: `INSERT INTO skill_files (
              id, path, content, scope, project_id, user_id, usage_count, last_used_at, procedure_key, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, NULL)`,
      args: [id, normalizedPath, normalizedContent, scope, projectId || null, userId, normalizedProcedureKey, nowIso, nowIso],
    })
  } else {
    await turso.execute({
      sql: `UPDATE skill_files
            SET content = ?, procedure_key = ?, updated_at = ?, deleted_at = NULL
            WHERE id = ?`,
      args: [normalizedContent, normalizedProcedureKey, nowIso, id],
    })
  }

  const skillFileResult = await turso.execute({
    sql: `SELECT id, path, content, scope, project_id, user_id, usage_count, last_used_at, procedure_key, created_at, updated_at
          FROM skill_files
          WHERE id = ?
          LIMIT 1`,
    args: [id],
  })

  const row = skillFileResult.rows[0] as unknown as SkillFileRow | undefined
  if (!row) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "SKILL_FILE_UPSERT_READBACK_FAILED",
        message: "Failed to read back skill file after upsert",
        status: 500,
        retryable: true,
      }),
      { rpcCode: -32000 }
    )
  }

  const scopeLabel = scope === "project" && projectId ? `project:${projectId}` : "global"
  const message = `${created ? "Created" : "Updated"} skill file ${normalizedPath} (${scopeLabel})`

  return {
    text: message,
    data: {
      skillFile: toStructuredSkillFile(row),
      created,
      message,
    },
  }
}

export async function listSkillFilesPayload(params: {
  turso: TursoClient
  projectId?: string | null
  userId: string | null
  limit: number
  query?: string | null
  procedureKey?: string | null
}): Promise<{
  text: string
  data: {
    skillFiles: Array<ReturnType<typeof toStructuredSkillFile>>
    count: number
  }
}> {
  const { turso, projectId, userId, limit } = params
  const normalizedLimit = Math.max(1, Math.min(Math.floor(limit || 50), 500))
  const rankingProcedureKey = normalizeProcedureKey(params.procedureKey) ?? deriveProcedureKeyFromQuery(params.query)
  const userFilter = buildUserScopeFilter(userId)

  let sql = `SELECT id, path, content, scope, project_id, user_id, usage_count, last_used_at, procedure_key, created_at, updated_at
             FROM skill_files
             WHERE deleted_at IS NULL
               AND ${userFilter.clause}
               AND (scope = 'global'`
  const args: (string | number)[] = [...userFilter.args]

  if (projectId) {
    sql += " OR (scope = 'project' AND project_id = ?)"
    args.push(projectId)
  }

  sql += `)`

  const orderByParts = [
    "CASE scope WHEN 'project' THEN 0 ELSE 1 END",
  ]
  if (rankingProcedureKey) {
    orderByParts.push("CASE WHEN procedure_key = ? THEN 0 WHEN procedure_key LIKE ? THEN 1 ELSE 2 END")
    args.push(rankingProcedureKey, `${rankingProcedureKey}:%`)
  }
  orderByParts.push("COALESCE(usage_count, 0) DESC")
  orderByParts.push("COALESCE(last_used_at, '') DESC")
  orderByParts.push("updated_at DESC")
  orderByParts.push("created_at DESC")

  sql += ` ORDER BY ${orderByParts.join(", ")} LIMIT ?`
  args.push(normalizedLimit)

  const result = await turso.execute({ sql, args })
  const rows = (result.rows ?? []) as unknown as SkillFileRow[]
  const skillFiles = rows.map((row) => toStructuredSkillFile(row))

  return {
    text: `Found ${skillFiles.length} skill file${skillFiles.length === 1 ? "" : "s"}`,
    data: {
      skillFiles,
      count: skillFiles.length,
    },
  }
}

export async function markSkillFilesUsedPayload(params: {
  turso: TursoClient
  ids: string[]
  userId: string | null
  nowIso: string
}): Promise<number> {
  const { turso, ids, userId, nowIso } = params
  const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (normalizedIds.length === 0) return 0

  const userFilter = exactUserScopeFilter(userId)
  const placeholders = normalizedIds.map(() => "?").join(", ")
  const result = await turso.execute({
    sql: `UPDATE skill_files
          SET usage_count = COALESCE(usage_count, 0) + 1,
              last_used_at = ?,
              updated_at = ?
          WHERE deleted_at IS NULL
            AND ${userFilter.clause}
            AND id IN (${placeholders})`,
    args: [nowIso, nowIso, ...userFilter.args, ...normalizedIds],
  })

  return Number(result.rowsAffected ?? 0)
}

export async function deleteSkillFilePayload(params: {
  turso: TursoClient
  path: string
  projectId?: string | null
  userId: string | null
  nowIso: string
}): Promise<{
  text: string
  data: {
    path: string
    deleted: true
    message: string
  }
}> {
  const { turso, path, projectId, userId, nowIso } = params
  const normalizedPath = path.trim()
  if (!normalizedPath) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "SKILL_FILE_PATH_REQUIRED",
        message: "skill file path is required",
        status: 400,
        retryable: false,
        details: { field: "path" },
      }),
      { rpcCode: -32602 }
    )
  }

  const scope = normalizeScope(projectId)
  const userFilter = exactUserScopeFilter(userId)

  const result = await turso.execute({
    sql: `UPDATE skill_files
          SET deleted_at = ?, updated_at = ?
          WHERE path = ?
            AND scope = ?
            AND ${scope === "project" ? "project_id = ?" : "project_id IS NULL"}
            AND ${userFilter.clause}
            AND deleted_at IS NULL`,
    args: [
      nowIso,
      nowIso,
      normalizedPath,
      scope,
      ...(scope === "project" ? [projectId as string] : []),
      ...userFilter.args,
    ],
  })

  if ((result.rowsAffected ?? 0) === 0) {
    throw new ToolExecutionError(
      apiError({
        type: "not_found_error",
        code: "SKILL_FILE_NOT_FOUND",
        message: "Skill file not found for this scope",
        status: 404,
        retryable: false,
        details: {
          path: normalizedPath,
          scope,
          projectId: projectId || null,
          userId,
        },
      }),
      { rpcCode: -32004 }
    )
  }

  const message = `Deleted skill file ${normalizedPath}`
  return {
    text: message,
    data: {
      path: normalizedPath,
      deleted: true,
      message,
    },
  }
}
