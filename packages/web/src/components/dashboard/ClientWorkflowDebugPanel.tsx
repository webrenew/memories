"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  CLIENT_WORKFLOW_EVENT_NAME,
  clearClientWorkflowEvents,
  listClientWorkflowEvents,
  type ClientWorkflowEvent,
} from "@/lib/client-workflow-debug"

function formatDuration(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a"
  return `${Math.max(0, Math.round(value))}ms`
}

function formatDetails(details?: Record<string, unknown>): string | null {
  if (!details) return null
  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return null
  }
}

export function ClientWorkflowDebugPanel(): React.JSX.Element | null {
  const [enabled, setEnabled] = useState(false)
  const [events, setEvents] = useState<ClientWorkflowEvent[]>([])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const isEnabled = params.get("debug") === "1"
    setEnabled(isEnabled)
    if (!isEnabled) return

    setEvents(listClientWorkflowEvents())
    const onEvent = () => {
      setEvents(listClientWorkflowEvents())
    }

    window.addEventListener(CLIENT_WORKFLOW_EVENT_NAME, onEvent as EventListener)
    return () => {
      window.removeEventListener(CLIENT_WORKFLOW_EVENT_NAME, onEvent as EventListener)
    }
  }, [])

  const latest = useMemo(() => events.slice(-8).reverse(), [events])

  if (!enabled) return null

  return (
    <aside
      aria-label="Client workflow debug panel"
      className="fixed bottom-4 right-4 z-[70] w-[min(28rem,calc(100vw-2rem))] border border-border bg-background/95 backdrop-blur-md shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Debug: Client Workflows
        </p>
        <button
          type="button"
          onClick={() => {
            clearClientWorkflowEvents()
            setEvents([])
          }}
          className="text-[10px] uppercase tracking-[0.14em] text-primary hover:text-primary/80"
        >
          Clear
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto p-3 space-y-2">
        {latest.length === 0 ? (
          <p className="text-xs text-muted-foreground">No client workflow events captured yet.</p>
        ) : (
          latest.map((event) => {
            const details = formatDetails(event.details)
            return (
              <div key={event.id} className="border border-border bg-card/20 p-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium">{event.workflow}</p>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{event.phase}</p>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  duration {formatDuration(event.durationMs)} | {new Date(event.ts).toLocaleTimeString()}
                </p>
                {event.message ? <p className="mt-1 text-xs text-foreground/90">{event.message}</p> : null}
                {details ? (
                  <pre className="mt-2 max-h-24 overflow-auto bg-background/60 p-1.5 text-[10px] leading-4 text-muted-foreground">
                    {details}
                  </pre>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
