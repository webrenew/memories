"use client"

import React, { useState, useRef, useEffect, useId } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Check, Crown, Shield, User, Loader2 } from "lucide-react"
import { extractErrorMessage } from "@/lib/client-errors"
import { recordClientWorkflowEvent } from "@/lib/client-workflow-debug"

export interface OrgMembership {
  role: "owner" | "admin" | "member"
  organization: {
    id: string
    name: string
    slug: string
  }
}

interface WorkspaceSwitcherProps {
  currentOrgId: string | null
  memberships: OrgMembership[]
}

interface WorkspaceSummary {
  ownerType: "user" | "organization"
  orgId: string | null
  orgRole: "owner" | "admin" | "member" | null
  plan: "free" | "pro" | "past_due"
  hasDatabase: boolean
  canProvision: boolean
  canManageBilling: boolean
}

interface WorkspaceSummariesResponse {
  summaries?: {
    currentOrgId: string | null
    personal: WorkspaceSummary
    organizations: Array<{
      id: string
      name: string
      slug: string
      role: "owner" | "admin" | "member"
      workspace: WorkspaceSummary
    }>
  }
}

interface WorkspacePrefetchMetrics {
  totalMs: number
  queryMs: number | null
  orgCount: number | null
  workspaceCount: number | null
  responseBytes: number
  cacheMode: "force-cache" | "default" | "no-store"
  includeSummaries: boolean
}

const PERSONAL_KEY = "__personal_workspace__"

function workspaceSummaryKey(orgId: string | null): string {
  return orgId ?? PERSONAL_KEY
}

function parseHeaderNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const roleIcon = (role: string) => {
  switch (role) {
    case "owner":
      return <Crown className="h-3 w-3 text-amber-400" />
    case "admin":
      return <Shield className="h-3 w-3 text-blue-400" />
    default:
      return <User className="h-3 w-3 text-muted-foreground" />
  }
}

export function WorkspaceSwitcher({ currentOrgId, memberships }: WorkspaceSwitcherProps): React.JSX.Element {
  const router = useRouter()
  const menuId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspaceSummaryById, setWorkspaceSummaryById] = useState<
    Record<string, WorkspaceSummary>
  >({})
  const [isPrefetching, setIsPrefetching] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isSwitchingRef = useRef(false)
  const prefetchRequestIdRef = useRef(0)
  const prefetchInFlightCountRef = useRef(0)

  const activeOrg = currentOrgId
    ? memberships.find((m) => m.organization.id === currentOrgId)
    : null

  const displayName = activeOrg ? activeOrg.organization.name : "Personal"

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && e.target instanceof Node && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen])

  async function prefetchWorkspaceSummaries(options?: {
    force?: boolean
    cacheBustKey?: string | null
  }): Promise<WorkspacePrefetchMetrics | null> {
    const requestId = ++prefetchRequestIdRef.current
    prefetchInFlightCountRef.current += 1
    setIsPrefetching(true)
    const cacheMode: WorkspacePrefetchMetrics["cacheMode"] = options?.force
      ? "default"
      : "force-cache"
    const url = new URL("/api/workspace", window.location.origin)
    url.searchParams.set("includeSummaries", "1")
    url.searchParams.set("profile", "1")
    if (options?.cacheBustKey) {
      url.searchParams.set("cacheBust", options.cacheBustKey)
    }

    const startedAt = performance.now()
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        cache: cacheMode,
      })
      if (!response.ok) return null

      const rawPayload = await response.text()
      const payload = (JSON.parse(rawPayload || "{}") ?? {}) as WorkspaceSummariesResponse
      const summaries = payload.summaries
      if (!summaries) return null

      const nextMap: Record<string, WorkspaceSummary> = {
        [PERSONAL_KEY]: summaries.personal,
      }
      for (const item of summaries.organizations) {
        nextMap[item.id] = item.workspace
      }
      if (requestId === prefetchRequestIdRef.current) {
        setWorkspaceSummaryById(nextMap)
      }

      const queryMs = parseHeaderNumber(response.headers.get("X-Workspace-Profile-Summary-Query-Ms"))
      const orgCountHeader = parseHeaderNumber(response.headers.get("X-Workspace-Profile-Org-Count"))
      const workspaceCountHeader = parseHeaderNumber(
        response.headers.get("X-Workspace-Profile-Workspace-Count"),
      )

      return {
        totalMs: Math.max(0, Math.round(performance.now() - startedAt)),
        queryMs,
        orgCount: orgCountHeader ?? summaries.organizations.length,
        workspaceCount: workspaceCountHeader ?? summaries.organizations.length + 1,
        responseBytes: new TextEncoder().encode(rawPayload).length,
        cacheMode,
        includeSummaries: true,
      }
    } catch {
      // Best-effort prefetch only.
      return null
    } finally {
      prefetchInFlightCountRef.current = Math.max(0, prefetchInFlightCountRef.current - 1)
      setIsPrefetching(prefetchInFlightCountRef.current > 0)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    void prefetchWorkspaceSummaries()
  }, [isOpen])

  async function recordWorkspaceSwitchProfile(payload: {
    fromOrgId: string | null
    toOrgId: string | null
    success: boolean
    errorCode?: string | null
    clientTotalMs?: number
    userPatchMs?: number
    workspacePrefetchMs?: number
    integrationHealthPrefetchMs?: number
    workspaceSummaryTotalMs?: number
    workspaceSummaryQueryMs?: number | null
    workspaceSummaryOrgCount?: number | null
    workspaceSummaryWorkspaceCount?: number | null
    workspaceSummaryResponseBytes?: number
    includeSummaries?: boolean
    cacheMode?: WorkspacePrefetchMetrics["cacheMode"]
  }) {
    try {
      await fetch("/api/workspace/switch-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_org_id: payload.fromOrgId,
          to_org_id: payload.toOrgId,
          success: payload.success,
          error_code: payload.errorCode ?? null,
          source: "dashboard",
          client_total_ms: payload.clientTotalMs,
          user_patch_ms: payload.userPatchMs,
          workspace_prefetch_ms: payload.workspacePrefetchMs,
          integration_health_prefetch_ms: payload.integrationHealthPrefetchMs,
          workspace_summary_total_ms: payload.workspaceSummaryTotalMs,
          workspace_summary_query_ms: payload.workspaceSummaryQueryMs,
          workspace_summary_org_count: payload.workspaceSummaryOrgCount,
          workspace_summary_workspace_count: payload.workspaceSummaryWorkspaceCount,
          workspace_summary_response_bytes: payload.workspaceSummaryResponseBytes,
          include_summaries: payload.includeSummaries,
          cache_mode: payload.cacheMode,
        }),
      })
    } catch {
      // Best-effort telemetry only.
    }
  }

  async function switchWorkspace(nextOrgId: string | null) {
    if (nextOrgId === currentOrgId) {
      setIsOpen(false)
      return
    }

    if (isSwitchingRef.current) {
      return
    }

    isSwitchingRef.current = true
    setIsSwitching(true)
    setError(null)
    const switchStartedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "workspace_switch",
      phase: "start",
      details: {
        fromOrgId: currentOrgId,
        toOrgId: nextOrgId,
      },
    })
    let userPatchMs: number | null = null
    let workspacePrefetchMs: number | null = null
    let integrationHealthPrefetchMs: number | null = null

    try {
      const userPatchStartedAt = performance.now()
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_org_id: nextOrgId }),
      })
      userPatchMs = Math.max(0, Math.round(performance.now() - userPatchStartedAt))

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(extractErrorMessage(data, `Failed to switch workspace (HTTP ${res.status})`))
      }

      const cacheBustKey =
        data &&
        typeof data === "object" &&
        "workspace_cache_bust_key" in data &&
        typeof data.workspace_cache_bust_key === "string"
          ? data.workspace_cache_bust_key
          : null

      // Warm short-lived workspace summaries + health payload for the next render.
      const [resolvedPrefetchMetrics] = await Promise.all([
        (async () => {
          const startedAt = performance.now()
          const metrics = await prefetchWorkspaceSummaries({
            force: true,
            cacheBustKey,
          })
          workspacePrefetchMs = Math.max(0, Math.round(performance.now() - startedAt))
          return metrics
        })(),
        (async () => {
          const startedAt = performance.now()
          await fetch("/api/integration/health", { method: "GET", cache: "force-cache" }).catch(
            () => undefined,
          )
          integrationHealthPrefetchMs = Math.max(0, Math.round(performance.now() - startedAt))
          return null
        })(),
      ])

      void recordWorkspaceSwitchProfile({
        fromOrgId: currentOrgId,
        toOrgId: nextOrgId,
        success: true,
        clientTotalMs: Math.max(0, Math.round(performance.now() - switchStartedAt)),
        userPatchMs: userPatchMs ?? undefined,
        workspacePrefetchMs: workspacePrefetchMs ?? undefined,
        integrationHealthPrefetchMs: integrationHealthPrefetchMs ?? undefined,
        workspaceSummaryTotalMs: resolvedPrefetchMetrics?.totalMs,
        workspaceSummaryQueryMs: resolvedPrefetchMetrics?.queryMs,
        workspaceSummaryOrgCount: resolvedPrefetchMetrics?.orgCount,
        workspaceSummaryWorkspaceCount: resolvedPrefetchMetrics?.workspaceCount,
        workspaceSummaryResponseBytes: resolvedPrefetchMetrics?.responseBytes,
        includeSummaries: resolvedPrefetchMetrics?.includeSummaries,
        cacheMode: resolvedPrefetchMetrics?.cacheMode,
      })

      setIsOpen(false)
      router.refresh()
      recordClientWorkflowEvent({
        workflow: "workspace_switch",
        phase: "success",
        durationMs: performance.now() - switchStartedAt,
        details: {
          fromOrgId: currentOrgId,
          toOrgId: nextOrgId,
          userPatchMs,
          workspacePrefetchMs,
          integrationHealthPrefetchMs,
        },
      })
    } catch (err) {
      console.error("Workspace switch failed:", err)
      const message = err instanceof Error ? err.message : "Failed to switch workspace"
      setError(message)

      const normalizedErrorCode =
        message.toLowerCase().includes("not a member") || message.toLowerCase().includes("member")
          ? "membership_denied"
          : "switch_failed"

      void recordWorkspaceSwitchProfile({
        fromOrgId: currentOrgId,
        toOrgId: nextOrgId,
        success: false,
        errorCode: normalizedErrorCode,
        clientTotalMs: Math.max(0, Math.round(performance.now() - switchStartedAt)),
        userPatchMs: userPatchMs ?? undefined,
        workspacePrefetchMs: workspacePrefetchMs ?? undefined,
        integrationHealthPrefetchMs: integrationHealthPrefetchMs ?? undefined,
      })
      recordClientWorkflowEvent({
        workflow: "workspace_switch",
        phase: "failure",
        durationMs: performance.now() - switchStartedAt,
        message,
        details: {
          fromOrgId: currentOrgId,
          toOrgId: nextOrgId,
          errorCode: normalizedErrorCode,
        },
      })
    } finally {
      isSwitchingRef.current = false
      setIsSwitching(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        className="flex items-center gap-2 px-3 py-1.5 border border-border bg-muted/30 hover:bg-muted/50 transition-colors disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-label="Switch workspace"
      >
        {isSwitching ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : activeOrg ? (
          roleIcon(activeOrg.role)
        ) : (
          <User className="h-3 w-3 text-primary" />
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] font-bold max-w-[140px] truncate">
          {displayName}
        </span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setIsOpen(false)} />
          <div
            id={menuId}
            role="listbox"
            aria-label="Workspace options"
            className="absolute top-full left-0 mt-1.5 z-50 min-w-[220px] bg-background border border-border shadow-lg"
          >
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-muted-foreground flex items-center gap-2">
                Workspace
                {(isSwitching || isPrefetching) && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
              </span>
            </div>

            {/* Personal workspace */}
            <button
              type="button"
              onClick={() => switchWorkspace(null)}
              disabled={isSwitching}
              role="option"
              aria-selected={currentOrgId === null}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-60"
            >
              <User className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">Personal</p>
                <p className="text-[10px] text-muted-foreground">Your private workspace</p>
              </div>
              {workspaceSummaryById[PERSONAL_KEY] && (
                <span
                  className={`text-[9px] uppercase tracking-[0.14em] ${
                    workspaceSummaryById[PERSONAL_KEY].hasDatabase
                      ? "text-emerald-400"
                      : "text-amber-400"
                  }`}
                >
                  {workspaceSummaryById[PERSONAL_KEY].hasDatabase ? "DB ready" : "No DB"}
                </span>
              )}
              {currentOrgId === null && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>

            {memberships.length > 0 && (
              <div className="border-t border-border">
                <div className="px-3 py-1.5">
                  <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-muted-foreground">
                    Organizations
                  </span>
                </div>
                {memberships.map((m) => (
                  <button
                    type="button"
                    key={m.organization.id}
                    onClick={() => switchWorkspace(m.organization.id)}
                    disabled={isSwitching}
                    role="option"
                    aria-selected={currentOrgId === m.organization.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-60"
                  >
                    <div className="w-5 h-5 bg-primary/10 border border-primary/20 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                      {m.organization.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{m.organization.name}</p>
                      <div className="flex items-center gap-1.5">
                        {roleIcon(m.role)}
                        <span className="text-[10px] text-muted-foreground capitalize">{m.role}</span>
                      </div>
                    </div>
                    {workspaceSummaryById[workspaceSummaryKey(m.organization.id)] && (
                      <span
                        className={`text-[9px] uppercase tracking-[0.14em] ${
                          workspaceSummaryById[workspaceSummaryKey(m.organization.id)].hasDatabase
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }`}
                      >
                        {workspaceSummaryById[workspaceSummaryKey(m.organization.id)].hasDatabase
                          ? "DB ready"
                          : "No DB"}
                      </span>
                    )}
                    {currentOrgId === m.organization.id && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div className="px-3 py-2 border-t border-border">
                <p className="text-[10px] text-red-400">{error}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
