import type { GraphStatusPayload } from "@/lib/memory-service/graph/status"

interface MemoryGraphSectionProps {
  status: GraphStatusPayload | null
}

function metricCard(label: string, value: number, tone?: "neutral" | "danger" | "success") {
  const valueClass =
    tone === "danger" ? "text-red-500" : tone === "success" ? "text-emerald-500" : "text-foreground"
  return (
    <div className="border border-border bg-card/10 p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/70 mb-2">{label}</p>
      <p className={`text-2xl font-mono font-bold ${valueClass}`}>{value.toLocaleString()}</p>
    </div>
  )
}

export function MemoryGraphSection({ status }: MemoryGraphSectionProps) {
  return (
    <section className="border border-border bg-card/10 p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Memory Graph</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Node and edge health for this workspace memory graph.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
            Status
          </p>
          <p className="text-xs font-mono mt-1">
            {status?.health === "ok" ? "Healthy" : status?.health === "schema_missing" ? "Schema Missing" : "Unavailable"}
          </p>
        </div>
      </div>

      {!status ? (
        <div className="border border-border bg-card/20 p-6 text-sm text-muted-foreground">
          Graph metrics are currently unavailable.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {metricCard("Nodes", status.counts.nodes)}
            {metricCard("Edges", status.counts.edges)}
            {metricCard("Memory Links", status.counts.memoryLinks)}
            {metricCard("Active Edges", status.counts.activeEdges, "success")}
            {metricCard("Expired Edges", status.counts.expiredEdges, status.counts.expiredEdges > 0 ? "danger" : "neutral")}
            {metricCard("Orphan Nodes", status.counts.orphanNodes, status.counts.orphanNodes > 0 ? "danger" : "neutral")}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="border border-border bg-card/5 p-4">
              <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground mb-4">Top Nodes</h3>
              {status.topConnectedNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No connected nodes yet.</p>
              ) : (
                <div className="space-y-2">
                  {status.topConnectedNodes.slice(0, 6).map((node) => (
                    <div key={`${node.nodeType}:${node.nodeKey}`} className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{node.label}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {node.nodeType}:{node.nodeKey}
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="font-mono font-bold">{node.degree}</p>
                        <p className="text-[11px] text-muted-foreground">degree</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-border bg-card/5 p-4">
              <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground mb-4">Recent Errors</h3>
              {status.recentErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent graph errors.</p>
              ) : (
                <div className="space-y-3">
                  {status.recentErrors.slice(0, 5).map((error) => (
                    <div key={`${error.code}:${error.timestamp}`} className="border border-border bg-card/20 p-3">
                      <p className="text-xs font-mono font-bold">{error.code}</p>
                      <p className="text-sm mt-1">{error.message}</p>
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                        {error.source} • {new Date(error.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
