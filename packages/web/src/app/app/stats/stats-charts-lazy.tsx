"use client"

import React from "react"
import dynamic from "next/dynamic"
import type { StatsChartsProps } from "./stats-charts"

const StatsCharts = dynamic(
  () => import("./stats-charts").then((mod) => mod.StatsCharts),
  {
    ssr: false,
    loading: () => <StatsChartsSkeleton />,
  },
)

function StatsChartsSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 border border-border bg-card/20 p-6">
          <div className="h-3 w-40 rounded bg-muted/60 animate-pulse mb-6" />
          <div className="h-[250px] rounded bg-muted/40 animate-pulse" />
        </div>
        <div className="border border-border bg-card/20 p-6">
          <div className="h-3 w-24 rounded bg-muted/60 animate-pulse mb-6" />
          <div className="h-[200px] rounded bg-muted/40 animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border bg-card/20 p-6">
          <div className="h-3 w-24 rounded bg-muted/60 animate-pulse mb-4" />
          <div className="space-y-3">
            <div className="h-8 rounded bg-muted/40 animate-pulse" />
            <div className="h-8 rounded bg-muted/40 animate-pulse" />
            <div className="h-8 rounded bg-muted/40 animate-pulse" />
          </div>
        </div>
        <div className="border border-border bg-card/20 p-6">
          <div className="h-3 w-32 rounded bg-muted/60 animate-pulse mb-4" />
          <div className="space-y-2">
            <div className="h-12 rounded bg-muted/40 animate-pulse" />
            <div className="h-12 rounded bg-muted/40 animate-pulse" />
            <div className="h-12 rounded bg-muted/40 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function LazyStatsCharts(props: StatsChartsProps): React.JSX.Element {
  return <StatsCharts {...props} />
}
