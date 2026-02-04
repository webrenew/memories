import { createClient } from "@/lib/supabase/server"
import { StatsCharts } from "./stats-charts"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"

export const metadata = {
  title: "Stats",
}

export default async function StatsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", user.id)
    .single()

  const hasTurso = profile?.turso_db_url && profile?.turso_db_token

  if (!hasTurso) {
    return <ProvisioningScreen />
  }

  // Fetch stats from Turso
  let stats = { total: 0, byType: [] as Array<{ type: string; count: number }>, byDay: [] as Array<{ date: string; count: number }> }

  try {
    const { createClient: createTurso } = await import("@libsql/client")
    const turso = createTurso({ url: profile.turso_db_url!, authToken: profile.turso_db_token! })

    const [totalResult, typeResult, dailyResult] = await Promise.all([
      turso.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL"),
      turso.execute("SELECT type, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY type ORDER BY count DESC"),
      turso.execute(
        "SELECT DATE(created_at) as date, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30"
      ),
    ])

    stats = {
      total: Number(totalResult.rows[0]?.count ?? 0),
      byType: typeResult.rows.map((r) => ({
        type: String(r.type ?? "note"),
        count: Number(r.count),
      })),
      byDay: dailyResult.rows
        .map((r) => ({
          date: String(r.date),
          count: Number(r.count),
        }))
        .reverse(),
    }
  } catch (err) {
    console.error("Stats query error:", err)
    return (
      <div className="border border-border bg-card/20 p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Could not connect to your memory database. Please try again later.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Stats</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Memory activity and usage metrics
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="border border-border bg-card/20 p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-2">
            Total Memories
          </p>
          <p className="text-3xl font-mono font-bold">{stats.total.toLocaleString()}</p>
        </div>
        <div className="border border-border bg-card/20 p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-2">
            Memory Types
          </p>
          <p className="text-3xl font-mono font-bold">{stats.byType.length}</p>
        </div>
        <div className="border border-border bg-card/20 p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-2">
            Today
          </p>
          <p className="text-3xl font-mono font-bold">
            {stats.byDay.find((d) => d.date === new Date().toISOString().split("T")[0])?.count ?? 0}
          </p>
        </div>
      </div>

      <StatsCharts byDay={stats.byDay} byType={stats.byType} />
    </div>
  )
}
