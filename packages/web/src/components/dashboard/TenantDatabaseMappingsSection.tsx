"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Database, Link2, RefreshCw, Server, Trash2 } from "lucide-react"
import { extractErrorMessage } from "@/lib/client-errors"
import { recordClientWorkflowEvent } from "@/lib/client-workflow-debug"
import type { WorkspacePlan } from "@/lib/workspace"

type ProvisionMode = "provision" | "attach"
type SpendControlMode = "attach_only" | "allow_provision"

type TenantStatus = "provisioning" | "ready" | "disabled" | "error"

interface TenantDatabase {
  tenantId: string
  tursoDbUrl: string
  tursoDbName: string | null
  status: TenantStatus | string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastVerifiedAt: string | null
}

interface TenantListResponse {
  tenantDatabases?: TenantDatabase[]
}

interface TenantDatabaseMappingsSectionProps {
  hasApiKey: boolean
  apiKeyExpired: boolean
  workspacePlan: WorkspacePlan
}

const SPEND_CONTROL_STORAGE_KEY = "memories.tenant-db.spend-control"
const PROVISION_ACK_STORAGE_KEY = "memories.tenant-db.provision-ack"

function formatDateTime(value: string | null): string {
  if (!value) return "Not set"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Not set"
  return parsed.toLocaleString()
}

function hostFromLibsql(url: string): string {
  return url.replace(/^libsql:\/\//, "")
}

function parseMetadataInput(input: string): Record<string, unknown> | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined

  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object")
  }

  return parsed as Record<string, unknown>
}

function statusClass(status: string): string {
  if (status === "ready") return "text-green-400 border-green-500/30 bg-green-500/10"
  if (status === "disabled") return "text-amber-400 border-amber-500/30 bg-amber-500/10"
  if (status === "error") return "text-red-400 border-red-500/30 bg-red-500/10"
  return "text-blue-400 border-blue-500/30 bg-blue-500/10"
}

export function TenantDatabaseMappingsSection({
  hasApiKey,
  apiKeyExpired,
  workspacePlan,
}: TenantDatabaseMappingsSectionProps): React.JSX.Element {
  const [tenantId, setTenantId] = useState("")
  const [mode, setMode] = useState<ProvisionMode>("provision")
  const [spendControl, setSpendControl] = useState<SpendControlMode>("attach_only")
  const [provisionAcknowledged, setProvisionAcknowledged] = useState(false)
  const [tursoDbUrl, setTursoDbUrl] = useState("")
  const [tursoDbToken, setTursoDbToken] = useState("")
  const [tursoDbName, setTursoDbName] = useState("")
  const [metadataInput, setMetadataInput] = useState("")

  const [mappings, setMappings] = useState<TenantDatabase[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [disablingTenantId, setDisablingTenantId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const isGrowthPlan = workspacePlan === "growth"

  const sortedMappings = useMemo(
    () => [...mappings].sort((a, b) => a.tenantId.localeCompare(b.tenantId)),
    [mappings]
  )

  const fetchMappings = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!isGrowthPlan || !hasApiKey || apiKeyExpired) {
        setMappings([])
        setError(null)
        return
      }

      if (opts?.silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      try {
        setError(null)
        const res = await fetch("/api/mcp/tenants")
        const payload = await res.json().catch(() => null)

        if (!res.ok) {
          throw new Error(extractErrorMessage(payload, `Failed to load AI SDK projects (HTTP ${res.status})`))
        }

        const data = (payload ?? {}) as TenantListResponse
        setMappings(Array.isArray(data.tenantDatabases) ? data.tenantDatabases : [])
      } catch (err) {
        console.error("Failed to fetch tenant mappings:", err)
        setError(err instanceof Error ? err.message : "Failed to load AI SDK projects")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [apiKeyExpired, hasApiKey, isGrowthPlan]
  )

  useEffect(() => {
    void fetchMappings()
  }, [fetchMappings])

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const storedControl = window.localStorage.getItem(SPEND_CONTROL_STORAGE_KEY)
      if (storedControl === "attach_only" || storedControl === "allow_provision") {
        setSpendControl(storedControl)
      }

      setProvisionAcknowledged(window.localStorage.getItem(PROVISION_ACK_STORAGE_KEY) === "true")
    } catch {
      // Ignore storage failures in strict browser contexts.
    }
  }, [])

  useEffect(() => {
    if (spendControl === "attach_only" && mode === "provision") {
      setMode("attach")
    }
  }, [mode, spendControl])

  function handleSpendControlChange(next: SpendControlMode) {
    setSpendControl(next)
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(SPEND_CONTROL_STORAGE_KEY, next)
    } catch {
      // Ignore storage failures in strict browser contexts.
    }
  }

  function handleProvisionAcknowledgedChange(checked: boolean) {
    setProvisionAcknowledged(checked)
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(PROVISION_ACK_STORAGE_KEY, checked ? "true" : "false")
    } catch {
      // Ignore storage failures in strict browser contexts.
    }
  }

  async function handleCreateOrAttach() {
    if (!isGrowthPlan) {
      setError("AI SDK project routing requires the Growth plan.")
      return
    }

    const trimmedTenantId = tenantId.trim()
    if (!trimmedTenantId) {
      setError("Project ID (`tenantId`) is required")
      return
    }

    if (mode === "provision") {
      if (spendControl !== "allow_provision") {
        setError("Provisioning is disabled by spend control. Switch to “Allow provisioning”.")
        return
      }

      if (!provisionAcknowledged) {
        setError("Acknowledge the provisioning warning before creating project databases.")
        return
      }
    }

    setSaving(true)
    setStatusMessage(null)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "tenant_mapping_create",
      phase: "start",
      details: {
        tenantId: trimmedTenantId,
        mode,
      },
    })
    try {
      setError(null)

      const metadata = parseMetadataInput(metadataInput)
      const payload: Record<string, unknown> = {
        tenantId: trimmedTenantId,
        mode,
      }

      if (metadata) payload.metadata = metadata

      if (mode === "attach") {
        if (!tursoDbUrl.trim()) {
          throw new Error("tursoDbUrl is required for attach mode")
        }
        if (!tursoDbToken.trim()) {
          throw new Error("tursoDbToken is required for attach mode")
        }

        payload.tursoDbUrl = tursoDbUrl.trim()
        payload.tursoDbToken = tursoDbToken.trim()
        if (tursoDbName.trim()) {
          payload.tursoDbName = tursoDbName.trim()
        }
      }

      const res = await fetch("/api/mcp/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(extractErrorMessage(data, `Failed to save AI SDK project (HTTP ${res.status})`))
      }

      setStatusMessage(mode === "provision" ? "Project database provisioned" : "Project database attached")
      setTenantId("")
      if (mode === "attach") {
        setTursoDbUrl("")
        setTursoDbToken("")
        setTursoDbName("")
      }
      setMetadataInput("")
      await fetchMappings({ silent: true })
      recordClientWorkflowEvent({
        workflow: "tenant_mapping_create",
        phase: "success",
        durationMs: performance.now() - startedAt,
        details: {
          tenantId: trimmedTenantId,
          mode,
        },
      })
    } catch (err) {
      console.error("Failed to create tenant mapping:", err)
      const message = err instanceof Error ? err.message : "Failed to save AI SDK project"
      setError(message)
      recordClientWorkflowEvent({
        workflow: "tenant_mapping_create",
        phase: "failure",
        durationMs: performance.now() - startedAt,
        message,
        details: {
          tenantId: trimmedTenantId,
          mode,
        },
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable(tenantToDisable: string) {
    if (!confirm(`Disable AI SDK project ${tenantToDisable}?`)) {
      return
    }

    setDisablingTenantId(tenantToDisable)
    setStatusMessage(null)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "tenant_mapping_disable",
      phase: "start",
      details: {
        tenantId: tenantToDisable,
      },
    })
    try {
      setError(null)
      const res = await fetch(`/api/mcp/tenants?tenantId=${encodeURIComponent(tenantToDisable)}`, {
        method: "DELETE",
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(extractErrorMessage(data, `Failed to disable AI SDK project (HTTP ${res.status})`))
      }

      setStatusMessage(`Disabled project ${tenantToDisable}`)
      await fetchMappings({ silent: true })
      recordClientWorkflowEvent({
        workflow: "tenant_mapping_disable",
        phase: "success",
        durationMs: performance.now() - startedAt,
        details: {
          tenantId: tenantToDisable,
        },
      })
    } catch (err) {
      console.error("Failed to disable tenant mapping:", err)
      const message = err instanceof Error ? err.message : "Failed to disable AI SDK project"
      setError(message)
      recordClientWorkflowEvent({
        workflow: "tenant_mapping_disable",
        phase: "failure",
        durationMs: performance.now() - startedAt,
        message,
        details: {
          tenantId: tenantToDisable,
        },
      })
    } finally {
      setDisablingTenantId(null)
    }
  }

  return (
    <div className="border border-border bg-card/20 rounded-lg">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Step 2: AI SDK Projects</h3>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Map `tenantId` to isolated Turso databases for SaaS customer workspaces.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {!hasApiKey ? (
          <p className="text-sm text-muted-foreground">
            Generate an API key first, then create your first AI SDK project.
          </p>
        ) : apiKeyExpired ? (
          <p className="text-sm text-muted-foreground">
            Your API key is expired. Regenerate it before managing AI SDK projects.
          </p>
        ) : !isGrowthPlan ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
            <p className="text-sm text-amber-200 font-medium">
              Growth plan required
            </p>
            <p className="text-sm text-amber-100/90">
              AI SDK project routing is a Growth feature. Your current workspace plan is{" "}
              <span className="font-semibold uppercase">{workspacePlan.replace("_", " ")}</span>.
            </p>
            <a
              href="/app/upgrade?plan=growth&source=sdk-projects"
              className="inline-flex items-center px-3 py-2 text-xs font-semibold rounded border border-primary bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
            >
              Upgrade to Growth
            </a>
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                `tenantId` here is your SaaS project/customer boundary. It is separate from git repo scope
                (`projectId`) used by coding agents. `userId` is optional end-user scope inside the same `tenantId`.
              </p>
            </div>

            <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-3 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-200">Project provisioning can increase infrastructure spend</p>
                  <p className="text-sm text-amber-100/80 mt-1">
                    Provisioning creates a new Turso database per project. Use spend controls to prevent accidental database creation.
                  </p>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleSpendControlChange("attach_only")}
                  className={`text-left rounded border p-2 transition-colors ${
                    spendControl === "attach_only"
                      ? "border-primary bg-primary/15"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <p className="text-xs font-semibold">Attach Existing DBs (Recommended)</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Prevent one-click creation; only map existing project DBs.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleSpendControlChange("allow_provision")}
                  className={`text-left rounded border p-2 transition-colors ${
                    spendControl === "allow_provision"
                      ? "border-primary bg-primary/15"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <p className="text-xs font-semibold">Allow One-Click Provisioning</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Enable one-click project DB provisioning from this dashboard.
                  </p>
                </button>
              </div>

              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={provisionAcknowledged}
                  onChange={(event) => handleProvisionAcknowledgedChange(event.target.checked)}
                  className="mt-0.5"
                />
                I understand that provisioning project databases may create billable infrastructure costs.
              </label>
            </div>

            <div className="border border-border bg-muted/20 rounded-md p-3 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("provision")}
                  disabled={spendControl !== "allow_provision"}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    mode === "provision"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted/30"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Server className="h-3 w-3 inline mr-1.5" />
                  Provision New Project DB
                </button>
                <button
                  type="button"
                  onClick={() => setMode("attach")}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    mode === "attach"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <Link2 className="h-3 w-3 inline mr-1.5" />
                  Attach Existing DB
                </button>
              </div>

              {spendControl === "attach_only" && (
                <p className="text-sm text-muted-foreground">
                  Spend control is set to Attach Existing DBs. Switch to Allow One-Click Provisioning to create project databases from this page.
                </p>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Project ID (`tenantId`)</span>
                  <input
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="acme-prod"
                    className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Project Metadata (JSON)</span>
                  <input
                    value={metadataInput}
                    onChange={(event) => setMetadataInput(event.target.value)}
                    placeholder='{"environment":"production"}'
                    className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                  />
                </label>
              </div>

              {mode === "attach" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs text-muted-foreground">Database URL (`tursoDbUrl`)</span>
                    <input
                      value={tursoDbUrl}
                      onChange={(event) => setTursoDbUrl(event.target.value)}
                      placeholder="libsql://tenant-db.turso.io"
                      className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Database Token (`tursoDbToken`)</span>
                    <input
                      type="password"
                      value={tursoDbToken}
                      onChange={(event) => setTursoDbToken(event.target.value)}
                      placeholder="token"
                      className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Database Name (`tursoDbName`, optional)</span>
                    <input
                      value={tursoDbName}
                      onChange={(event) => setTursoDbName(event.target.value)}
                      placeholder="tenant-db"
                      className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                    />
                  </label>
                </div>
              )}

              <button
                type="button"
                onClick={handleCreateOrAttach}
                disabled={saving}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving
                  ? mode === "provision"
                    ? "Provisioning Project..."
                    : "Attaching Project..."
                  : mode === "provision"
                    ? "Provision Project Database"
                    : "Attach Project Database"}
              </button>

              <p className="text-sm text-muted-foreground">
                Existing project mappings move automatically when you rotate your API key.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Current AI SDK Projects</p>
                <button
                  type="button"
                  onClick={() => void fetchMappings({ silent: true })}
                  disabled={refreshing || loading}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs border border-border rounded hover:bg-muted/30 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="animate-pulse h-20 bg-muted/20 rounded" />
              ) : sortedMappings.length === 0 ? (
                <div className="border border-dashed border-border rounded p-4 text-sm text-muted-foreground">
                  No AI SDK projects yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedMappings.map((mapping) => (
                    <div key={mapping.tenantId} className="border border-border rounded p-3 bg-muted/10 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{mapping.tenantId}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {mapping.tursoDbName || hostFromLibsql(mapping.tursoDbUrl)}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] uppercase tracking-wide border rounded ${statusClass(mapping.status)}`}>
                          {mapping.status}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground break-all">
                        Host: {hostFromLibsql(mapping.tursoDbUrl)}
                      </p>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                        <p>Updated: {formatDateTime(mapping.updatedAt)}</p>
                        <p>Verified: {formatDateTime(mapping.lastVerifiedAt)}</p>
                      </div>

                      {Object.keys(mapping.metadata || {}).length > 0 && (
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">Metadata</summary>
                          <pre className="mt-1 bg-background/70 border border-border rounded p-2 overflow-x-auto">
                            {JSON.stringify(mapping.metadata, null, 2)}
                          </pre>
                        </details>
                      )}

                      {mapping.status !== "disabled" && (
                        <button
                          type="button"
                          onClick={() => void handleDisable(mapping.tenantId)}
                          disabled={disablingTenantId === mapping.tenantId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 border border-red-500/30 rounded hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          {disablingTenantId === mapping.tenantId ? "Disabling..." : "Disable"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {statusMessage && <p className="text-xs text-green-400">{statusMessage}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  )
}
