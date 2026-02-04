"use client"

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
} from "recharts"

const COLORS = [
  "oklch(0.65 0.18 285)",
  "oklch(0.6 0.15 200)",
  "oklch(0.7 0.15 150)",
  "oklch(0.65 0.2 30)",
  "oklch(0.6 0.15 320)",
]

export function StatsCharts({
  byDay,
  byType,
}: {
  byDay: Array<{ date: string; count: number }>
  byType: Array<{ type: string; count: number }>
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Daily activity */}
      <div className="border border-border bg-card/20 p-6">
        <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-6">
          Daily Activity (Last 30 Days)
        </h3>
        {byDay.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byDay}>
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "2px",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" fill="var(--primary)" radius={[1, 1, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">No activity data</p>
        )}
      </div>

      {/* By type */}
      <div className="border border-border bg-card/20 p-6">
        <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/60 mb-6">
          Memories by Type
        </h3>
        {byType.length > 0 ? (
          <div className="flex items-center gap-6">
            <ResponsiveContainer width="50%" height={200}>
              <PieChart>
                <Pie
                  data={byType}
                  dataKey="count"
                  nameKey="type"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  strokeWidth={0}
                >
                  {byType.map((_entry, index) => (
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              {byType.map((item, index) => (
                <div key={item.type} className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {item.type}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {item.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">No type data</p>
        )}
      </div>
    </div>
  )
}
