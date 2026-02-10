import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"

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

    const [totalResult, typeResult, dailyResult] = await Promise.all([
      turso.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL"),
      turso.execute(
        "SELECT type, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY type ORDER BY count DESC"
      ),
      turso.execute(
        "SELECT DATE(created_at) as date, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30"
      ),
    ])

    const byType = typeResult.rows.map((r) => ({
      type: String(r.type ?? "note"),
      count: Number(r.count),
    }))

    return NextResponse.json({
      total: Number(totalResult.rows[0]?.count ?? 0),
      // Legacy key kept for compatibility with older clients.
      byAgent: byType.map((r) => ({
        agent: r.type,
        count: r.count,
      })),
      byType,
      byDay: dailyResult.rows.map((r) => ({
        date: String(r.date),
        count: Number(r.count),
      })),
    })
  } catch {
    return NextResponse.json({ error: "Failed to connect to Turso" }, { status: 500 })
  }
}
