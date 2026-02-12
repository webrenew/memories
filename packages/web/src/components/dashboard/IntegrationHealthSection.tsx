"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { IntegrationHealthPayload } from "@/lib/integration-health"

interface IntegrationHealthSectionProps {
  initialHealth: IntegrationHealthPayload | null
}

function statusClass(status: IntegrationHealthPayload["status"]): string {
  if (status === "ok") return "text-emerald-500"
  if (status === "degraded") return "text-amber-500"
  return "text-red-500"
}

function percent(value: number | null): string {
  if (value === null) return "n/a"
  return `${(value * 100).toFixed(1)}%`
}

export function IntegrationHealthSection({ initialHealth }: IntegrationHealthSectionProps) {
  const [health, setHealth] = useState<IntegrationHealthPayload | null>(initialHealth)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHealth = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/integration/health", {
        method: "GET",
        cache: "no-store",
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error ?? `HTTP ${response.status}`)
      }
      setHealth((body?.health as IntegrationHealthPayload) ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load integration health.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialHealth) return
    void loadHealth()
  }, [initialHealth, loadHealth])

  const summary = useMemo(() => {
    if (!health) return null
    return [
      {
        label: "Workspace",
        value: health.workspace.label,
      },
      {
        label: "Database Latency",
        value: health.database.latencyMs !== null ? `${health.database.latencyMs}ms` : "n/a",
      },
      {
        label: "Graph",
        value: `${health.graph.nodes} nodes / ${health.graph.edges} edges`,
      },
      {
        label: "Fallback (24h)",
        value: percent(health.graph.fallbackRate24h),
      },
    ]
  }, [health])

  return (
    <section className="border border-border bg-card/20 p-4 md:p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground/70">
            Integration Health
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Live diagnostics for auth, workspace, database, and graph wiring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {health && (
            <span className={`text-xs uppercase tracking-[0.12em] font-bold ${statusClass(health.status)}`}>
              {health.status}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadHealth()}
            disabled={loading}
            className="px-2.5 py-1 text-[11px] border border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
          >
            {loading ? "Checking..." : "Recheck"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-500">Health check failed: {error}</p>}

      {!health ? (
        <p className="mt-3 text-sm text-muted-foreground">No integration health data yet.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {summary?.map((item) => (
              <div key={item.label} className="border border-border bg-card/10 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">{item.label}</p>
                <p className="text-sm font-medium mt-1">{item.value}</p>
              </div>
            ))}
          </div>

          {health.issues.length > 0 ? (
            <div className="mt-4 border border-amber-500/30 bg-amber-500/10 px-3 py-3">
              <p className="text-xs uppercase tracking-[0.14em] font-bold text-amber-400">Issues Detected</p>
              <ul className="mt-2 space-y-1.5 text-xs text-amber-100/90">
                {health.issues.map((issue) => (
                  <li key={issue}>- {issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-xs text-emerald-400">All integration checks are healthy.</p>
          )}
        </>
      )}
    </section>
  )
}
