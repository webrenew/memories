"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Database, Link2, RefreshCw, Server, Trash2 } from "lucide-react"

type ProvisionMode = "provision" | "attach"

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
}

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
}: TenantDatabaseMappingsSectionProps) {
  const [tenantId, setTenantId] = useState("")
  const [mode, setMode] = useState<ProvisionMode>("provision")
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

  const sortedMappings = useMemo(
    () => [...mappings].sort((a, b) => a.tenantId.localeCompare(b.tenantId)),
    [mappings]
  )

  const fetchMappings = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!hasApiKey || apiKeyExpired) {
        setMappings([])
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
        const data = (await res.json().catch(() => ({}))) as TenantListResponse & {
          error?: string
        }

        if (!res.ok) {
          throw new Error(data.error || "Failed to load tenant mappings")
        }

        setMappings(Array.isArray(data.tenantDatabases) ? data.tenantDatabases : [])
      } catch (err) {
        console.error("Failed to fetch tenant mappings:", err)
        setError(err instanceof Error ? err.message : "Failed to load tenant mappings")
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [apiKeyExpired, hasApiKey]
  )

  useEffect(() => {
    void fetchMappings()
  }, [fetchMappings])

  async function handleCreateOrAttach() {
    const trimmedTenantId = tenantId.trim()
    if (!trimmedTenantId) {
      setError("tenantId is required")
      return
    }

    setSaving(true)
    setStatusMessage(null)
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
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to save tenant mapping")
      }

      setStatusMessage(mode === "provision" ? "Tenant database provisioned" : "Tenant database attached")
      setTenantId("")
      if (mode === "attach") {
        setTursoDbUrl("")
        setTursoDbToken("")
        setTursoDbName("")
      }
      setMetadataInput("")
      await fetchMappings({ silent: true })
    } catch (err) {
      console.error("Failed to create tenant mapping:", err)
      setError(err instanceof Error ? err.message : "Failed to save tenant mapping")
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable(tenantToDisable: string) {
    if (!confirm(`Disable tenant mapping for ${tenantToDisable}?`)) {
      return
    }

    setDisablingTenantId(tenantToDisable)
    setStatusMessage(null)
    try {
      setError(null)
      const res = await fetch(`/api/mcp/tenants?tenantId=${encodeURIComponent(tenantToDisable)}`, {
        method: "DELETE",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Failed to disable tenant mapping")
      }

      setStatusMessage(`Disabled ${tenantToDisable}`)
      await fetchMappings({ silent: true })
    } catch (err) {
      console.error("Failed to disable tenant mapping:", err)
      setError(err instanceof Error ? err.message : "Failed to disable tenant mapping")
    } finally {
      setDisablingTenantId(null)
    }
  }

  return (
    <div className="border border-border bg-card/20 rounded-lg">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Tenant Databases</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Map `tenant_id` to isolated Turso databases for SaaS customers.
        </p>
      </div>

      <div className="p-4 space-y-4">
        {!hasApiKey ? (
          <p className="text-sm text-muted-foreground">
            Generate an API key first, then configure tenant database mappings.
          </p>
        ) : apiKeyExpired ? (
          <p className="text-sm text-muted-foreground">
            Your API key is expired. Regenerate it before managing tenant mappings.
          </p>
        ) : (
          <>
            <div className="border border-border bg-muted/20 rounded-md p-3 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("provision")}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    mode === "provision"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <Server className="h-3 w-3 inline mr-1.5" />
                  Provision New
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
                  Attach Existing
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">tenantId</span>
                  <input
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="acme-prod"
                    className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Metadata (JSON)</span>
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
                    <span className="text-xs text-muted-foreground">tursoDbUrl</span>
                    <input
                      value={tursoDbUrl}
                      onChange={(event) => setTursoDbUrl(event.target.value)}
                      placeholder="libsql://tenant-db.turso.io"
                      className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">tursoDbToken</span>
                    <input
                      type="password"
                      value={tursoDbToken}
                      onChange={(event) => setTursoDbToken(event.target.value)}
                      placeholder="token"
                      className="w-full bg-background px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">tursoDbName (optional)</span>
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
                    ? "Provisioning..."
                    : "Attaching..."
                  : mode === "provision"
                    ? "Provision Tenant Database"
                    : "Attach Tenant Database"}
              </button>

              <p className="text-xs text-muted-foreground">
                Existing mappings move automatically when you rotate your MCP API key.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Current Mappings</p>
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
                  No tenant mappings yet.
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
