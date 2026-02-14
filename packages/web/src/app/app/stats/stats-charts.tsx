"use client"
import React from "react"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"

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

const TYPE_COLORS: Record<string, string> = {
  rule: "oklch(0.658 0.288 302.321)", // primary purple
  fact: "oklch(0.6 0.15 200)",        // cyan
  decision: "oklch(0.7 0.18 80)",     // amber
  note: "oklch(0.65 0.12 260)",       // muted purple
}

const TYPE_LABELS: Record<string, string> = {
  rule: "Rules",
  fact: "Facts", 
  decision: "Decisions",
  note: "Notes",
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  const dateOnly = new Date(dateStr + "T00:00:00")
  dateOnly.setHours(0, 0, 0, 0)
  
  if (dateOnly.getTime() === today.getTime()) return "Today"
  if (dateOnly.getTime() === yesterday.getTime()) return "Yesterday"
  
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatProjectName(projectId: string | null, scope: string): string {
  if (scope === "global" || !projectId) return "Global"
  return projectId.replace(/^github\.com\//, "")
}

function truncateContent(content: string, maxLength: number = 60): string {
  if (content.length <= maxLength) return content
  return content.slice(0, maxLength).trim() + "..."
}

export function StatsCharts({
  byType,
  byDayAndType,
  byProject,
  recent,
  globalVsProject,
}: {
  byType: TypeCount[]
  byDayAndType: DayTypeCount[]
  byProject: ProjectCount[]
  recent: RecentMemory[]
  globalVsProject: { global: number; project: number }
}): React.JSX.Element {
  // Transform daily data for stacked bar chart
  const dailyData = byDayAndType.reduce((acc, item) => {
    const existing = acc.find(d => d.date === item.date)
    if (existing) {
      existing[item.type] = item.count
      existing.total = (existing.total as number) + item.count
    } else {
      acc.push({
        date: item.date,
        [item.type]: item.count,
        total: item.count,
      })
    }
    return acc
  }, [] as Array<{ date: string; total: number; [key: string]: string | number }>)
  
  // Sort by date ascending and take last 14 days
  const sortedDaily = dailyData
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-14)

  // Get unique types for the chart
  const types = [...new Set(byDayAndType.map(d => d.type))]

  return (
    <div className="space-y-6">
      {/* Activity by Day and Type */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 border border-border bg-card/20 p-6">
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-6">
            Activity (Last 14 Days)
          </h3>
          {sortedDaily.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={sortedDaily}>
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    fontSize: 12,
                  }}
                  labelFormatter={(dateStr) => formatDate(String(dateStr))}
                  formatter={(value, name) => [value, TYPE_LABELS[String(name)] || name]}
                />
                <Legend 
                  formatter={(value: string) => TYPE_LABELS[value] || value}
                  wrapperStyle={{ fontSize: 11 }}
                />
                {types.map((type) => (
                  <Bar
                    key={type}
                    dataKey={type}
                    stackId="a"
                    fill={TYPE_COLORS[type] || "var(--muted)"}
                    radius={type === types[types.length - 1] ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px]">
              <p className="text-sm text-muted-foreground">No activity in the last 14 days</p>
            </div>
          )}
        </div>

        {/* Type Distribution */}
        <div className="border border-border bg-card/20 p-6">
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-6">
            By Type
          </h3>
          {byType.length > 0 ? (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={byType}
                    dataKey="count"
                    nameKey="type"
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={65}
                    strokeWidth={0}
                  >
                    {byType.map((entry) => (
                      <Cell 
                        key={entry.type} 
                        fill={TYPE_COLORS[entry.type] || "var(--muted)"} 
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value, _name, item) => {
                      const typeName = (item as { payload?: { type?: string } })?.payload?.type || "";
                      return [value, TYPE_LABELS[typeName] || typeName];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                {byType.map((item) => (
                  <div key={item.type} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: TYPE_COLORS[item.type] || "var(--muted)" }}
                    />
                    <span className="text-[11px] font-medium">
                      {TYPE_LABELS[item.type] || item.type}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono ml-auto">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px]">
              <p className="text-sm text-muted-foreground">No data</p>
            </div>
          )}
        </div>
      </div>

      {/* Projects and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Project */}
        <div className="border border-border bg-card/20 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60">
              By Source
            </h3>
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span>
                <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 mr-1.5" />
                Global: {globalVsProject.global}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-sm bg-amber-500 mr-1.5" />
                Project: {globalVsProject.project}
              </span>
            </div>
          </div>
          {byProject.length > 0 ? (
            <div className="space-y-3">
              {byProject.map((project, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span 
                        className={`w-2 h-2 rounded-sm shrink-0 ${
                          project.scope === "global" ? "bg-blue-500" : "bg-amber-500"
                        }`} 
                      />
                      <span className="text-sm font-medium truncate">
                        {formatProjectName(project.project_id, project.scope)}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono ml-auto shrink-0">
                        {project.count}
                      </span>
                    </div>
                    {/* Type breakdown bar */}
                    <div className="flex h-1.5 mt-1.5 ml-4 rounded-full overflow-hidden bg-muted/30">
                      {project.rule_count > 0 && (
                        <div 
                          className="h-full" 
                          style={{ 
                            width: `${(project.rule_count / project.count) * 100}%`,
                            backgroundColor: TYPE_COLORS.rule 
                          }} 
                          title={`${project.rule_count} rules`}
                        />
                      )}
                      {project.fact_count > 0 && (
                        <div 
                          className="h-full" 
                          style={{ 
                            width: `${(project.fact_count / project.count) * 100}%`,
                            backgroundColor: TYPE_COLORS.fact 
                          }} 
                          title={`${project.fact_count} facts`}
                        />
                      )}
                      {project.decision_count > 0 && (
                        <div 
                          className="h-full" 
                          style={{ 
                            width: `${(project.decision_count / project.count) * 100}%`,
                            backgroundColor: TYPE_COLORS.decision 
                          }} 
                          title={`${project.decision_count} decisions`}
                        />
                      )}
                      {project.note_count > 0 && (
                        <div 
                          className="h-full" 
                          style={{ 
                            width: `${(project.note_count / project.count) * 100}%`,
                            backgroundColor: TYPE_COLORS.note 
                          }} 
                          title={`${project.note_count} notes`}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px]">
              <p className="text-sm text-muted-foreground">No projects yet</p>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="border border-border bg-card/20 p-6">
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-6">
            Recent Activity
          </h3>
          {recent.length > 0 ? (
            <div className="space-y-3">
              {recent.map((memory) => (
                <div key={memory.id} className="flex items-start gap-3 group">
                  <div 
                    className="w-2 h-2 rounded-sm shrink-0 mt-1.5" 
                    style={{ backgroundColor: TYPE_COLORS[memory.type] || "var(--muted)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground/80 leading-snug">
                      {truncateContent(memory.content)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground/60">
                        {formatTimeAgo(memory.created_at)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40">•</span>
                      <span className="text-[10px] text-muted-foreground/60 truncate">
                        {formatProjectName(memory.project_id, memory.scope)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px]">
              <p className="text-sm text-muted-foreground">No recent activity</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
