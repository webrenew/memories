import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, createMemorySchema, updateMemorySchema, deleteMemorySchema } from "@/lib/validations"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const { data: profile } = await supabase
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", user.id)
    .single()

  if (!profile?.turso_db_url || !profile?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: profile.turso_db_url,
      authToken: profile.turso_db_token,
    })

    const result = await turso.execute(
      "SELECT id, content, tags, type, scope, project_id, created_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100"
    )

    return NextResponse.json({ memories: result.rows })
  } catch {
    return NextResponse.json({ error: "Failed to connect to Turso" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(createMemorySchema, await request.json())
  if (!parsed.success) return parsed.response
  const { content, type, scope, tags } = parsed.data

  const { data: profile } = await supabase
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", user.id)
    .single()

  if (!profile?.turso_db_url || !profile?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: profile.turso_db_url,
      authToken: profile.turso_db_token,
    })

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    const now = new Date().toISOString()

    await turso.execute({
      sql: `INSERT INTO memories (id, content, type, scope, tags, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, content, type, scope, tags ?? null, now, now],
    })

    return NextResponse.json({ 
      id, 
      content, 
      type, 
      scope, 
      project_id: null, // Web-created memories don't have project context
      tags, 
      created_at: now 
    })
  } catch (err) {
    console.error("Failed to add memory:", err)
    return NextResponse.json({ error: "Failed to add memory" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(updateMemorySchema, await request.json())
  if (!parsed.success) return parsed.response
  const { id, content, tags } = parsed.data

  const { data: profile } = await supabase
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", user.id)
    .single()

  if (!profile?.turso_db_url || !profile?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: profile.turso_db_url,
      authToken: profile.turso_db_token,
    })

    await turso.execute({
      sql: `UPDATE memories SET content = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [content, tags ?? null, id],
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to update memory" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(deleteMemorySchema, await request.json())
  if (!parsed.success) return parsed.response
  const { id } = parsed.data

  const { data: profile } = await supabase
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", user.id)
    .single()

  if (!profile?.turso_db_url || !profile?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: profile.turso_db_url,
      authToken: profile.turso_db_token,
    })

    // Soft delete by setting deleted_at
    await turso.execute({
      sql: "UPDATE memories SET deleted_at = datetime('now') WHERE id = ?",
      args: [id],
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 })
  }
}
