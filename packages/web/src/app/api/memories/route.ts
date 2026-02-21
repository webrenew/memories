import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, createMemorySchema, updateMemorySchema, deleteMemorySchema } from "@/lib/validations"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { isMissingDeletedAtColumnError } from "@/lib/sqlite-errors"

const DEFAULT_GET_LIMIT = 100
const MAX_GET_LIMIT = 200

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_GET_LIMIT
  return Math.min(parsed, MAX_GET_LIMIT)
}

async function queryMemories(
  turso: ReturnType<typeof createTurso>,
  {
    limit,
    beforeCreatedAt,
    beforeId,
  }: {
    limit: number
    beforeCreatedAt: string | null
    beforeId: string | null
  },
) {
  const hasCursor = Boolean(beforeCreatedAt && beforeId)
  const withDeletedAtSql = hasCursor
    ? `SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at
       FROM memories
       WHERE deleted_at IS NULL AND (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    : `SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at
       FROM memories
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ?`

  const withoutDeletedAtSql = hasCursor
    ? `SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at
       FROM memories
       WHERE (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    : `SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at
       FROM memories
       ORDER BY created_at DESC, id DESC
       LIMIT ?`

  const args = hasCursor
    ? [beforeCreatedAt!, beforeCreatedAt!, beforeId!, limit + 1]
    : [limit + 1]

  try {
    return await turso.execute({ sql: withDeletedAtSql, args })
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) {
      throw error
    }
    return turso.execute({ sql: withoutDeletedAtSql, args })
  }
}

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const context = await resolveActiveMemoryContext(supabase, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: context.turso_db_url,
      authToken: context.turso_db_token,
    })

    const searchParams = new URL(request.url).searchParams
    const limit = parseLimit(searchParams.get("limit"))
    const beforeCreatedAt = searchParams.get("beforeCreatedAt")
    const beforeId = searchParams.get("beforeId")
    const result = await queryMemories(turso, {
      limit,
      beforeCreatedAt,
      beforeId,
    })
    const hasMore = result.rows.length > limit
    const memories = hasMore ? result.rows.slice(0, limit) : result.rows

    return NextResponse.json({ memories, hasMore })
  } catch (err) {
    console.error("Failed to list memories:", err)
    return NextResponse.json({ error: "Failed to connect to Turso" }, { status: 500 })
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(createMemorySchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { content, type, scope, tags, project_id, paths, category, metadata } = parsed.data

  const context = await resolveActiveMemoryContext(supabase, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: context.turso_db_url,
      authToken: context.turso_db_token,
    })

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    const now = new Date().toISOString()

    await turso.execute({
      sql: `INSERT INTO memories (id, content, type, scope, project_id, tags, paths, category, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, content, type, scope, project_id ?? null, tags ?? null, paths ?? null, category ?? null, metadata ?? null, now, now],
    })

    return NextResponse.json({
      id,
      content,
      type,
      scope,
      project_id: project_id ?? null,
      tags: tags ?? null,
      paths: paths ?? null,
      category: category ?? null,
      metadata: metadata ?? null,
      created_at: now,
      updated_at: now,
    })
  } catch (err) {
    console.error("Failed to add memory:", err)
    return NextResponse.json({ error: "Failed to add memory" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(updateMemorySchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { id, content, tags, type, paths, category, metadata } = parsed.data

  const context = await resolveActiveMemoryContext(supabase, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: context.turso_db_url,
      authToken: context.turso_db_token,
    })

    const now = new Date().toISOString()
    const updates: string[] = ["updated_at = ?"]
    const updateArgs: (string | null)[] = [now]

    if (content !== undefined) {
      updates.push("content = ?")
      updateArgs.push(content)
    }
    if (tags !== undefined) {
      updates.push("tags = ?")
      updateArgs.push(tags ?? null)
    }
    if (type !== undefined) {
      updates.push("type = ?")
      updateArgs.push(type)
    }
    if (paths !== undefined) {
      updates.push("paths = ?")
      updateArgs.push(paths ?? null)
    }
    if (category !== undefined) {
      updates.push("category = ?")
      updateArgs.push(category ?? null)
    }
    if (metadata !== undefined) {
      updates.push("metadata = ?")
      updateArgs.push(metadata ?? null)
    }

    updateArgs.push(id)
    await turso.execute({
      sql: `UPDATE memories SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      args: updateArgs,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Failed to update memory:", err)
    return NextResponse.json({ error: "Failed to update memory" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(deleteMemorySchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { id } = parsed.data

  const context = await resolveActiveMemoryContext(supabase, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: context.turso_db_url,
      authToken: context.turso_db_token,
    })

    // Soft delete by setting deleted_at
    const now = new Date().toISOString()
    await turso.execute({
      sql: "UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
      args: [now, id],
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Failed to delete memory:", err)
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 })
  }
}
