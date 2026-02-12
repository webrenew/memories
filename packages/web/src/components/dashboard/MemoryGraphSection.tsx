"use client"

import { useEffect, useState, useTransition } from "react"
import type { GraphStatusPayload } from "@/lib/memory-service/graph/status"

interface MemoryGraphSectionProps {
  status: GraphStatusPayload | null
}

type GraphRolloutMode = GraphStatusPayload["rollout"]["mode"]

const ROLLOUT_MODES: Array<{ value: GraphRolloutMode; label: string; description: string }> = [
  { value: "off", label: "Off", description: "Always serve baseline retrieval." },
  { value: "shadow", label: "Shadow", description: "Run graph retrieval without applying it." },
  { value: "canary", label: "Canary", description: "Apply graph retrieval for hybrid requests." },
]

function metricCard(
  label: string,
  value: number | string,
  tone?: "neutral" | "danger" | "success"
) {
  const valueClass =
    tone === "danger" ? "text-red-500" : tone === "success" ? "text-emerald-500" : "text-foreground"
  return (
    <div className="border border-border bg-card/10 p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/70 mb-2">{label}</p>
      <p className={`text-2xl font-mono font-bold ${valueClass}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  )
}

function severityClass(severity: "info" | "warning" | "critical"): string {
  if (severity === "critical") return "text-red-500"
  if (severity === "warning") return "text-amber-500"
  return "text-sky-500"
}

export function MemoryGraphSection({ status }: MemoryGraphSectionProps) {
  const [localStatus, setLocalStatus] = useState(status)
  const [modeError, setModeError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setLocalStatus(status)
  }, [status])

  const activeStatus = localStatus
  const fallbackRate = activeStatus?.shadowMetrics.fallbackRate ?? 0
  const fallbackTone = fallbackRate >= 0.15 ? "danger" : fallbackRate === 0 ? "success" : "neutral"

  const updateRolloutMode = (mode: GraphRolloutMode) => {
    if (!activeStatus || activeStatus.rollout.mode === mode) {
      return
    }

    setModeError(null)
    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/graph/rollout", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode }),
          })
          const body = await response.json().catch(() => ({} as { error?: string }))
          if (!response.ok) {
            setModeError(body.error ?? "Failed to update graph rollout mode.")
            return
          }

          const nextStatus = body.status as GraphStatusPayload | undefined
          if (nextStatus) {
            setLocalStatus(nextStatus)
          } else {
            setModeError("Rollout update returned an invalid payload.")
          }
        } catch {
          setModeError("Network error while updating rollout mode.")
        }
      })()
    })
  }

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
            {activeStatus?.health === "ok"
              ? "Healthy"
              : activeStatus?.health === "schema_missing"
              ? "Schema Missing"
              : "Unavailable"}
          </p>
        </div>
      </div>

      {!activeStatus ? (
        <div className="border border-border bg-card/20 p-6 text-sm text-muted-foreground">
          Graph metrics are currently unavailable.
        </div>
      ) : (
        <>
          <div className="border border-border bg-card/5 p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground">Rollout Controls</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Workspace-level gating for hybrid graph retrieval.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                Updated:{" "}
                <span className="font-mono text-foreground">
                  {new Date(activeStatus.rollout.updatedAt).toLocaleString()}
                </span>
                {activeStatus.rollout.updatedBy ? (
                  <>
                    {" "}
                    by <span className="font-mono text-foreground">{activeStatus.rollout.updatedBy}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {ROLLOUT_MODES.map((mode) => {
                const isActive = activeStatus.rollout.mode === mode.value
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => updateRolloutMode(mode.value)}
                    disabled={isPending || isActive}
                    className={`border p-3 text-left transition-colors ${
                      isActive
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-card/10 hover:bg-card/30"
                    } ${isPending ? "cursor-not-allowed opacity-70" : ""}`}
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.18em]">{mode.label}</p>
                    <p className="text-xs text-muted-foreground mt-2">{mode.description}</p>
                  </button>
                )
              })}
            </div>

            {isPending ? (
              <p className="text-xs text-muted-foreground">Updating rollout mode...</p>
            ) : null}
            {modeError ? (
              <p className="text-xs text-red-500">{modeError}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {metricCard("Requests (24h)", activeStatus.shadowMetrics.totalRequests)}
            {metricCard("Hybrid Requested", activeStatus.shadowMetrics.hybridRequested)}
            {metricCard("Canary Applied", activeStatus.shadowMetrics.canaryApplied, "success")}
            {metricCard("Shadow Executed", activeStatus.shadowMetrics.shadowExecutions)}
            {metricCard(
              "Fallback Rate",
              `${(activeStatus.shadowMetrics.fallbackRate * 100).toFixed(1)}%`,
              fallbackTone
            )}
            {metricCard(
              "Graph Error Fallbacks",
              activeStatus.shadowMetrics.graphErrorFallbacks,
              activeStatus.shadowMetrics.graphErrorFallbacks > 0 ? "danger" : "neutral"
            )}
          </div>

          <div className="border border-border bg-card/5 p-4">
            <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground mb-4">Fallback Alarms</h3>
            {activeStatus.alarms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active fallback alarms.</p>
            ) : (
              <div className="space-y-3">
                {activeStatus.alarms.map((alarm) => (
                  <div key={`${alarm.code}:${alarm.triggeredAt}`} className="border border-border bg-card/20 p-3">
                    <p className={`text-xs font-mono font-bold ${severityClass(alarm.severity)}`}>
                      {alarm.severity.toUpperCase()}
                    </p>
                    <p className="text-sm mt-1">{alarm.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                      {alarm.code} • {new Date(alarm.triggeredAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {metricCard("Nodes", activeStatus.counts.nodes)}
            {metricCard("Edges", activeStatus.counts.edges)}
            {metricCard("Memory Links", activeStatus.counts.memoryLinks)}
            {metricCard("Active Edges", activeStatus.counts.activeEdges, "success")}
            {metricCard(
              "Expired Edges",
              activeStatus.counts.expiredEdges,
              activeStatus.counts.expiredEdges > 0 ? "danger" : "neutral"
            )}
            {metricCard(
              "Orphan Nodes",
              activeStatus.counts.orphanNodes,
              activeStatus.counts.orphanNodes > 0 ? "danger" : "neutral"
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="border border-border bg-card/5 p-4">
              <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground mb-4">Top Nodes</h3>
              {activeStatus.topConnectedNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No connected nodes yet.</p>
              ) : (
                <div className="space-y-2">
                  {activeStatus.topConnectedNodes.slice(0, 6).map((node) => (
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
              {activeStatus.recentErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent graph errors.</p>
              ) : (
                <div className="space-y-3">
                  {activeStatus.recentErrors.slice(0, 5).map((error) => (
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
