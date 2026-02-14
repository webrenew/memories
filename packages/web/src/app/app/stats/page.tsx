import React from "react"
import { createClient } from "@/lib/supabase/server"
import { StatsCharts } from "./stats-charts"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"

export const metadata = {
  title: "Stats",
}

interface TypeCount {
  type: string
  count: number
}

interface DayTypeCount {
  date: string
  type: string
  count: number
}

interface ProjectCount {
  project_id: string | null
  scope: string
  count: number
  rule_count: number
  fact_count: number
  decision_count: number
  note_count: number
}

interface RecentMemory {
  id: string
  content: string
  type: string
  scope: string
  project_id: string | null
  created_at: string
}

interface Stats {
  total: number
  ruleCount: number
  projectCount: number
  thisWeek: number
  today: number
  byType: TypeCount[]
  byDayAndType: DayTypeCount[]
  byProject: ProjectCount[]
  recent: RecentMemory[]
  globalVsProject: { global: number; project: number }
}

export default async function StatsPage(): Promise<React.JSX.Element | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const context = await resolveActiveMemoryContext(supabase, user.id)
  const hasTurso = context?.turso_db_url && context?.turso_db_token

  if (!hasTurso) {
    return <ProvisioningScreen />
  }

  let stats: Stats = {
    total: 0,
    ruleCount: 0,
    projectCount: 0,
    thisWeek: 0,
    today: 0,
    byType: [],
    byDayAndType: [],
    byProject: [],
    recent: [],
    globalVsProject: { global: 0, project: 0 },
  }

  try {
    const { createClient: createTurso } = await import("@libsql/client")
    const turso = createTurso({ url: context.turso_db_url!, authToken: context.turso_db_token! })
    const withStatsFallback = async (
      queryName: string,
      query: ReturnType<typeof turso.execute>
    ): Promise<Awaited<ReturnType<typeof turso.execute>> | null> => {
      try {
        return await query
      } catch (error) {
        console.error(`Stats query failed (${queryName}):`, error)
        return null
      }
    }

    const [
      totalResult,
      ruleCountResult,
      projectCountResult,
      thisWeekResult,
      todayResult,
      typeResult,
      dailyTypeResult,
      projectResult,
      recentResult,
      scopeResult,
    ] = await Promise.all([
      // Total memories
      withStatsFallback("total", turso.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL")),
      // Rule count
      withStatsFallback("rule_count", turso.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND type = 'rule'")),
      // Unique projects
      withStatsFallback("project_count", turso.execute("SELECT COUNT(DISTINCT project_id) as count FROM memories WHERE deleted_at IS NULL AND project_id IS NOT NULL")),
      // This week
      withStatsFallback("this_week", turso.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND created_at >= datetime('now', '-7 days')")),
      // Today
      withStatsFallback("today", turso.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND DATE(created_at) = DATE('now')")),
      // By type
      withStatsFallback("by_type", turso.execute("SELECT type, COUNT(*) as count FROM memories WHERE deleted_at IS NULL GROUP BY type ORDER BY count DESC")),
      // By day and type (last 14 days)
      withStatsFallback("by_day_and_type", turso.execute(`
        SELECT DATE(created_at) as date, type, COUNT(*) as count 
        FROM memories 
        WHERE deleted_at IS NULL AND created_at >= datetime('now', '-14 days')
        GROUP BY DATE(created_at), type 
        ORDER BY date DESC, type
      `)),
      // By project (top 10)
      withStatsFallback("by_project", turso.execute(`
        SELECT 
          project_id,
          scope,
          COUNT(*) as count,
          SUM(CASE WHEN type = 'rule' THEN 1 ELSE 0 END) as rule_count,
          SUM(CASE WHEN type = 'fact' THEN 1 ELSE 0 END) as fact_count,
          SUM(CASE WHEN type = 'decision' THEN 1 ELSE 0 END) as decision_count,
          SUM(CASE WHEN type = 'note' THEN 1 ELSE 0 END) as note_count
        FROM memories 
        WHERE deleted_at IS NULL
        GROUP BY COALESCE(project_id, 'global'), scope
        ORDER BY count DESC
        LIMIT 10
      `)),
      // Recent memories (last 10)
      withStatsFallback("recent", turso.execute(`
        SELECT id, content, type, scope, project_id, created_at 
        FROM memories 
        WHERE deleted_at IS NULL 
        ORDER BY created_at DESC 
        LIMIT 10
      `)),
      // Global vs Project breakdown
      withStatsFallback("global_vs_project", turso.execute(`
        SELECT scope, COUNT(*) as count 
        FROM memories 
        WHERE deleted_at IS NULL 
        GROUP BY scope
      `)),
    ])

    const scopeCounts = (scopeResult?.rows ?? []).reduce((acc, r) => {
      acc[String(r.scope)] = Number(r.count)
      return acc
    }, {} as Record<string, number>)

    stats = {
      total: Number(totalResult?.rows[0]?.count ?? 0),
      ruleCount: Number(ruleCountResult?.rows[0]?.count ?? 0),
      projectCount: Number(projectCountResult?.rows[0]?.count ?? 0),
      thisWeek: Number(thisWeekResult?.rows[0]?.count ?? 0),
      today: Number(todayResult?.rows[0]?.count ?? 0),
      byType: (typeResult?.rows ?? []).map((r) => ({
        type: String(r.type ?? "note"),
        count: Number(r.count),
      })),
      byDayAndType: (dailyTypeResult?.rows ?? []).map((r) => ({
        date: String(r.date),
        type: String(r.type ?? "note"),
        count: Number(r.count),
      })),
      byProject: (projectResult?.rows ?? []).map((r) => ({
        project_id: r.project_id ? String(r.project_id) : null,
        scope: String(r.scope),
        count: Number(r.count),
        rule_count: Number(r.rule_count ?? 0),
        fact_count: Number(r.fact_count ?? 0),
        decision_count: Number(r.decision_count ?? 0),
        note_count: Number(r.note_count ?? 0),
      })),
      recent: (recentResult?.rows ?? []).map((r) => ({
        id: String(r.id),
        content: String(r.content),
        type: String(r.type ?? "note"),
        scope: String(r.scope),
        project_id: r.project_id ? String(r.project_id) : null,
        created_at: String(r.created_at),
      })),
      globalVsProject: {
        global: scopeCounts["global"] ?? 0,
        project: scopeCounts["project"] ?? 0,
      },
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="border border-border bg-card/20 p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-2">
            Total Memories
          </p>
          <p className="text-3xl font-mono font-bold">{stats.total.toLocaleString()}</p>
        </div>
        <div className="border border-border bg-card/20 p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-2">
            Active Rules
          </p>
          <p className="text-3xl font-mono font-bold text-primary">{stats.ruleCount.toLocaleString()}</p>
        </div>
        <div className="border border-border bg-card/20 p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-2">
            Projects
          </p>
          <p className="text-3xl font-mono font-bold">{stats.projectCount.toLocaleString()}</p>
        </div>
        <div className="border border-border bg-card/20 p-6">
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-2">
            This Week
          </p>
          <p className="text-3xl font-mono font-bold">
            {stats.thisWeek > 0 ? `+${stats.thisWeek}` : "0"}
          </p>
          {stats.today > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {stats.today} today
            </p>
          )}
        </div>
      </div>

      <StatsCharts 
        byType={stats.byType} 
        byDayAndType={stats.byDayAndType}
        byProject={stats.byProject}
        recent={stats.recent}
        globalVsProject={stats.globalVsProject}
      />
    </div>
  )
}
