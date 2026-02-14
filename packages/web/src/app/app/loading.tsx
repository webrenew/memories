import React from "react"
export default function AppLoading(): React.JSX.Element {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse bg-muted/30" />
        <div className="h-4 w-80 animate-pulse bg-muted/20" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={`stats-skeleton-${idx}`} className="border border-border bg-card/20 p-4">
            <div className="h-3 w-28 animate-pulse bg-muted/25" />
            <div className="mt-3 h-6 w-20 animate-pulse bg-muted/30" />
          </div>
        ))}
      </div>

      <div className="border border-border bg-card/20 p-4">
        <div className="h-4 w-40 animate-pulse bg-muted/25" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={`row-skeleton-${idx}`} className="h-10 animate-pulse bg-muted/20" />
          ))}
        </div>
      </div>
    </div>
  )
}
