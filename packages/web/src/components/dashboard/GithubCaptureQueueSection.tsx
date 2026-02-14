"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { extractErrorMessage } from "@/lib/client-errors"

type QueueStatus = "pending" | "approved" | "rejected"
type QueueEvent = "all" | "pull_request" | "issues" | "push" | "release"

interface GithubCaptureQueueItem {
  id: string
  status: QueueStatus
  source_event: "pull_request" | "issues" | "push" | "release"
  source_action: string | null
  repo_full_name: string
  project_id: string
  actor_login: string | null
  source_id: string
  title: string | null
  content: string
  source_url: string | null
  created_at: string
  reviewed_at: string | null
  can_approve: boolean
  workspace: string
}

function badgeClass(event: GithubCaptureQueueItem["source_event"]): string {
  if (event === "pull_request") return "text-sky-300 border-sky-500/40 bg-sky-500/10"
  if (event === "issues") return "text-amber-300 border-amber-500/40 bg-amber-500/10"
  if (event === "release") return "text-violet-300 border-violet-500/40 bg-violet-500/10"
  return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
}

function statusClass(status: QueueStatus): string {
  if (status === "approved") return "text-emerald-400"
  if (status === "rejected") return "text-red-400"
  return "text-amber-400"
}

function formatRelativeDate(iso: string): string {
  const now = Date.now()
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return "unknown"

  const diffMs = Math.max(0, now - then)
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function trim(value: string, max = 280): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

export function GithubCaptureQueueSection(): React.JSX.Element {
  const [status, setStatus] = useState<QueueStatus | "all">("pending")
  const [event, setEvent] = useState<QueueEvent>("all")
  const [search, setSearch] = useState("")
  const [items, setItems] = useState<GithubCaptureQueueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const isMountedRef = useRef(true)
  const loadRequestIdRef = useRef(0)
  const pendingDecisionIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const loadQueue = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current
    const shouldIgnore = () =>
      !isMountedRef.current || requestId !== loadRequestIdRef.current

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        status,
        event,
        limit: "50",
      })
      if (search.trim()) {
        params.set("q", search.trim())
      }

      const response = await fetch(`/api/github/capture/queue?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, `Failed to load capture queue (HTTP ${response.status})`))
      }

      if (shouldIgnore()) {
        return
      }
      setItems(Array.isArray(body?.queue) ? body.queue : [])
    } catch (loadError) {
      if (shouldIgnore()) {
        return
      }
      setError(loadError instanceof Error ? loadError.message : "Failed to load capture queue")
    } finally {
      if (!shouldIgnore()) {
        setLoading(false)
      }
    }
  }, [event, search, status])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  const summary = useMemo(() => {
    const counts = {
      pending: 0,
      approved: 0,
      rejected: 0,
    }

    for (const item of items) {
      if (item.status === "pending") counts.pending += 1
      if (item.status === "approved") counts.approved += 1
      if (item.status === "rejected") counts.rejected += 1
    }

    return counts
  }, [items])

  async function handleDecision(itemId: string, action: "approve" | "reject") {
    if (pendingDecisionIdsRef.current.has(itemId)) {
      return
    }
    pendingDecisionIdsRef.current.add(itemId)
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.add(itemId)
      return next
    })

    try {
      const response = await fetch(`/api/github/capture/queue/${itemId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ action }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, `Failed to ${action} item (HTTP ${response.status})`))
      }

      if (status === "pending") {
        if (isMountedRef.current) {
          setItems((prev) => prev.filter((item) => item.id !== itemId))
        }
      } else {
        await loadQueue()
      }
    } catch (decisionError) {
      if (isMountedRef.current) {
        setError(decisionError instanceof Error ? decisionError.message : `Failed to ${action} item`)
      }
    } finally {
      pendingDecisionIdsRef.current.delete(itemId)
      if (isMountedRef.current) {
        setPendingIds((prev) => {
          const next = new Set(prev)
          next.delete(itemId)
          return next
        })
      }
    }
  }

  return (
    <section className="border border-border bg-card/20 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground/70">
            GitHub Capture Queue
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PRs, issues, commits, and releases captured for review before memory insertion.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadQueue()}
          disabled={loading}
          className="px-2.5 py-1 text-[11px] border border-border bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((option) => {
          const active = status === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => setStatus(option)}
              className={`px-2 py-1 text-[10px] uppercase tracking-[0.14em] border transition-colors ${
                active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {option}
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Pending {summary.pending}</span>
          <span>Approved {summary.approved}</span>
          <span>Rejected {summary.rejected}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(["all", "pull_request", "issues", "push", "release"] as const).map((option) => {
          const active = event === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => setEvent(option)}
              className={`px-2 py-1 text-[10px] uppercase tracking-[0.14em] border transition-colors ${
                active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {option === "all" ? "all events" : option}
            </button>
          )
        })}

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search repo, actor, title, source id"
          className="ml-auto w-full md:w-[300px] px-2.5 py-1.5 text-xs bg-muted/20 border border-border focus:outline-none focus:border-primary/40"
        />
      </div>

      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}

      {items.length === 0 ? (
        <div className="mt-4 border border-border bg-card/10 px-3 py-4 text-sm text-muted-foreground">
          No capture items for this filter.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => {
            const isBusy = pendingIds.has(item.id)

            return (
              <article key={item.id} className="border border-border bg-card/10 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-0.5 border text-[10px] uppercase tracking-[0.14em] ${badgeClass(item.source_event)}`}>
                    {item.source_event}
                  </span>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
                    {item.repo_full_name}
                  </span>
                  <span className={`ml-auto text-[10px] uppercase tracking-[0.12em] ${statusClass(item.status)}`}>
                    {item.status}
                  </span>
                </div>

                <div>
                  <p className="text-sm font-medium leading-relaxed">{item.title ?? item.source_id}</p>
                  <p className="text-xs text-muted-foreground mt-1">{trim(item.content)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span>workspace {item.workspace}</span>
                  <span>actor {item.actor_login ?? "unknown"}</span>
                  <span>{formatRelativeDate(item.created_at)}</span>
                  {item.source_url ? (
                    <a
                      className="text-primary hover:underline"
                      href={item.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      source
                    </a>
                  ) : null}
                </div>

                {item.status === "pending" && item.can_approve ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDecision(item.id, "approve")}
                      disabled={isBusy}
                      className="px-2.5 py-1 text-[11px] border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-60"
                    >
                      {isBusy ? "Working..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDecision(item.id, "reject")}
                      disabled={isBusy}
                      className="px-2.5 py-1 text-[11px] border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
