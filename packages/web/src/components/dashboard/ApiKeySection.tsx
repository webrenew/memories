"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import { Copy, RefreshCw, Trash2, Key, Eye, EyeOff, Check } from "lucide-react"
import { TenantDatabaseMappingsSection } from "@/components/dashboard/TenantDatabaseMappingsSection"
import {
  defaultExpiryInputValue,
  isoToLocalInputValue,
  MIN_KEY_TTL_MS,
  toDateTimeLocalValue,
} from "@/lib/api-key-expiry"
import { extractErrorMessage } from "@/lib/client-errors"
import { recordClientWorkflowEvent } from "@/lib/client-workflow-debug"
import type { WorkspacePlan } from "@/lib/workspace"

const MCP_ENDPOINT = "https://memories.sh/api/mcp"

function formatDateTime(value: string | null): string {
  if (!value) return "Not set"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Not set"
  return parsed.toLocaleString()
}

interface KeyMetadataResponse {
  hasKey?: boolean
  keyCount?: number
  activeKeyCount?: number
  keyId?: string
  keyPreview?: string | null
  createdAt?: string | null
  expiresAt?: string | null
  isExpired?: boolean
  keys?: Array<{
    id?: string
    keyPreview?: string | null
    createdAt?: string | null
    expiresAt?: string | null
    isExpired?: boolean
  }>
}

interface ApiKeySummary {
  id: string
  keyPreview: string | null
  createdAt: string | null
  expiresAt: string | null
  isExpired: boolean
}

interface ApiKeySectionProps {
  workspacePlan: WorkspacePlan
  refreshNonce?: number
}

export function ApiKeySection({ workspacePlan, refreshNonce = 0 }: ApiKeySectionProps): React.JSX.Element {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keys, setKeys] = useState<ApiKeySummary[]>([])
  const [keyPreview, setKeyPreview] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [isExpired, setIsExpired] = useState(false)
  const [activeKeyCount, setActiveKeyCount] = useState(0)
  const [expiryInput, setExpiryInput] = useState(defaultExpiryInputValue())
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [generatedKeyId, setGeneratedKeyId] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedEndpoint, setCopiedEndpoint] = useState(false)
  const [copiedHeader, setCopiedHeader] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keysRef = useRef<ApiKeySummary[]>([])
  const keyFetchRequestIdRef = useRef(0)
  const keyMutationInFlightRef = useRef(false)

  const applyKeySummaries = useCallback((nextKeys: ApiKeySummary[]) => {
    keysRef.current = nextKeys
    setKeys(nextKeys)
    const nextPrimary = nextKeys.find((item) => !item.isExpired) ?? nextKeys[0] ?? null
    setActiveKeyCount(nextKeys.filter((item) => !item.isExpired).length)
    setHasKey(nextKeys.length > 0)
    setKeyPreview(nextPrimary?.keyPreview ?? null)
    setCreatedAt(nextPrimary?.createdAt ?? null)
    setExpiresAt(nextPrimary?.expiresAt ?? null)
    setIsExpired(nextPrimary?.isExpired ?? false)
  }, [])

  const fetchKey = useCallback(async () => {
    const requestId = ++keyFetchRequestIdRef.current
    try {
      setError(null)
      const res = await fetch("/api/mcp/key")
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(extractErrorMessage(payload, `Failed to fetch API key metadata (HTTP ${res.status})`))
      }
      if (requestId !== keyFetchRequestIdRef.current || keyMutationInFlightRef.current) {
        return
      }

      const data = (payload ?? {}) as KeyMetadataResponse
      const parsedKeys: ApiKeySummary[] = Array.isArray(data.keys)
        ? data.keys
            .map((item) => ({
              id: item.id || "",
              keyPreview: item.keyPreview || null,
              createdAt: item.createdAt || null,
              expiresAt: item.expiresAt || null,
              isExpired: Boolean(item.isExpired),
            }))
            .filter((item) => item.id.length > 0)
        : []

      const primaryKey =
        parsedKeys.find((item) => !item.isExpired) ??
        parsedKeys[0] ??
        null

      const computedHasKey = parsedKeys.length > 0 || Boolean(data.hasKey)
      const computedActiveCount =
        parsedKeys.length > 0
          ? parsedKeys.filter((item) => !item.isExpired).length
          : (data.activeKeyCount ?? (data.hasKey && !data.isExpired ? 1 : 0))

      if (parsedKeys.length > 0) {
        applyKeySummaries(parsedKeys)
      } else {
        keysRef.current = []
        setKeys([])
        setHasKey(computedHasKey)
        setActiveKeyCount(computedActiveCount)
        setKeyPreview(data.keyPreview || primaryKey?.keyPreview || null)
        setCreatedAt(data.createdAt || primaryKey?.createdAt || null)
        setExpiresAt(data.expiresAt || primaryKey?.expiresAt || null)
        setIsExpired(
          primaryKey
            ? primaryKey.isExpired
            : Boolean(data.isExpired)
        )
      }
      setApiKey(null)
      setShowKey(false)
      setGeneratedKeyId(null)
      setExpiryInput(isoToLocalInputValue((data.expiresAt || primaryKey?.expiresAt) ?? null))
    } catch (err) {
      if (requestId !== keyFetchRequestIdRef.current) return
      console.error("Failed to fetch API key:", err)
      setError("Failed to fetch API key metadata")
    } finally {
      if (requestId === keyFetchRequestIdRef.current) {
        setLoading(false)
      }
    }
  }, [applyKeySummaries])

  useEffect(() => {
    void fetchKey()
  }, [fetchKey, refreshNonce])

  async function generateKey() {
    if (keyMutationInFlightRef.current) return
    if (!expiryInput) {
      setError("Select an expiry date and time.")
      return
    }

    const parsedExpiry = new Date(expiryInput)
    if (Number.isNaN(parsedExpiry.getTime())) {
      setError("Expiry must be a valid date and time.")
      return
    }

    keyMutationInFlightRef.current = true
    keyFetchRequestIdRef.current += 1
    setLoading(true)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "api_key_generate",
      phase: "start",
      details: {
        expiresAtInput: parsedExpiry.toISOString(),
      },
    })
    try {
      setError(null)
      const res = await fetch("/api/mcp/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresAt: parsedExpiry.toISOString() }),
      })
      const payload = await res.json().catch(() => null)

      if (!res.ok) {
        throw new Error(extractErrorMessage(payload, `Failed to generate API key (HTTP ${res.status})`))
      }

      const data =
        payload && typeof payload === "object"
          ? (payload as {
              apiKey?: string
              keyId?: string
              keyPreview?: string | null
              createdAt?: string | null
              expiresAt?: string | null
            })
          : {}

      if (data.apiKey) {
        const nextCreatedAt = data.createdAt || new Date().toISOString()
        const nextExpiresAt = data.expiresAt || parsedExpiry.toISOString()
        const nextKeyId = data.keyId || `generated-${Date.now()}`
        const nextSummary: ApiKeySummary = {
          id: nextKeyId,
          keyPreview: data.keyPreview || null,
          createdAt: nextCreatedAt,
          expiresAt: nextExpiresAt,
          isExpired: false,
        }
        const nextKeys = [nextSummary, ...keysRef.current.filter((item) => item.id !== nextSummary.id)]
        setApiKey(data.apiKey)
        setShowKey(true)
        setGeneratedKeyId(nextKeyId)
        applyKeySummaries(nextKeys)
      }
      recordClientWorkflowEvent({
        workflow: "api_key_generate",
        phase: "success",
        durationMs: performance.now() - startedAt,
      })
    } catch (err) {
      console.error("Failed to generate API key:", err)
      const message = err instanceof Error ? err.message : "Failed to generate API key"
      setError(message)
      recordClientWorkflowEvent({
        workflow: "api_key_generate",
        phase: "failure",
        durationMs: performance.now() - startedAt,
        message,
      })
    } finally {
      keyMutationInFlightRef.current = false
      setLoading(false)
    }
  }

  async function revokeKey(keyId?: string) {
    if (keyMutationInFlightRef.current) return
    const isSingleKeyRevoke = typeof keyId === "string" && keyId.length > 0
    if (!confirm(isSingleKeyRevoke
      ? "Revoke this API key? Any client using it will stop working."
      : "Revoke all API keys? Any tools using them will stop working.")) {
      return
    }
    keyMutationInFlightRef.current = true
    keyFetchRequestIdRef.current += 1
    setLoading(true)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "api_key_revoke",
      phase: "start",
    })
    try {
      setError(null)
      const endpoint = isSingleKeyRevoke
        ? `/api/mcp/key?keyId=${encodeURIComponent(keyId)}`
        : "/api/mcp/key"
      const res = await fetch(endpoint, { method: "DELETE" })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(extractErrorMessage(payload, `Failed to revoke API key (HTTP ${res.status})`))
      }

      if (isSingleKeyRevoke) {
        const nextKeys = keysRef.current.filter((item) => item.id !== keyId)
        if (generatedKeyId === keyId) {
          setApiKey(null)
          setShowKey(false)
          setGeneratedKeyId(null)
        }
        applyKeySummaries(nextKeys)
      } else {
        setApiKey(null)
        setGeneratedKeyId(null)
        keysRef.current = []
        setHasKey(false)
        setKeys([])
        setActiveKeyCount(0)
        setKeyPreview(null)
        setCreatedAt(null)
        setExpiresAt(null)
        setIsExpired(false)
        setShowKey(false)
      }

      setExpiryInput(defaultExpiryInputValue())
      recordClientWorkflowEvent({
        workflow: "api_key_revoke",
        phase: "success",
        durationMs: performance.now() - startedAt,
      })
    } catch (err) {
      console.error("Failed to revoke API key:", err)
      const message = err instanceof Error ? err.message : "Failed to revoke API key"
      setError(message)
      recordClientWorkflowEvent({
        workflow: "api_key_revoke",
        phase: "failure",
        durationMs: performance.now() - startedAt,
        message,
      })
    } finally {
      keyMutationInFlightRef.current = false
      setLoading(false)
    }
  }

  const copyKey = useCallback(async () => {
    if (!apiKey) return
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
      setError("Failed to copy key")
    }
  }, [apiKey])

  const copyEndpoint = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(MCP_ENDPOINT)
      setCopiedEndpoint(true)
      setTimeout(() => setCopiedEndpoint(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
      setError("Failed to copy endpoint")
    }
  }, [])

  const copyHeader = useCallback(async () => {
    const header = apiKey ? `Authorization: Bearer ${apiKey}` : "Authorization: Bearer <YOUR_API_KEY>"
    try {
      await navigator.clipboard.writeText(header)
      setCopiedHeader(true)
      setTimeout(() => setCopiedHeader(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
      setError("Failed to copy header")
    }
  }, [apiKey])

  const maskedKey = apiKey ? `${apiKey.slice(0, 12)}${"*".repeat(40)}${apiKey.slice(-4)}` : ""
  const displayedKey = apiKey ? (showKey ? apiKey : maskedKey) : (keyPreview || "")
  const hasActiveKey = activeKeyCount > 0
  const minExpiryValue = toDateTimeLocalValue(new Date(Date.now() + MIN_KEY_TTL_MS))

  if (loading && !hasKey && !apiKey) {
    return (
      <div className="border border-border bg-card/20 rounded-lg p-6">
        <div className="animate-pulse h-20 bg-muted/20 rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="border border-border bg-card/20 rounded-lg">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">API Key</h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Generate a `mem_` key for SDK runtime calls and MCP clients. Tenant databases auto-route by `tenantId`.
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Key Expiry (required)</label>
            <input
              type="datetime-local"
              value={expiryInput}
              min={minExpiryValue}
              onChange={(e) => setExpiryInput(e.target.value)}
              className="w-full bg-muted/30 px-3 py-2 rounded text-sm border border-border focus:outline-none focus:border-primary/50"
            />
            <p className="text-sm text-muted-foreground">
              Choose exactly when this key should expire. Non-expiring keys are not allowed.
            </p>
          </div>

          {hasKey ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  {apiKey ? "Your API Key (shown once)" : "Stored API Key"}
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted/30 px-3 py-2 rounded text-xs font-mono break-all select-all">
                    {displayedKey}
                  </code>
                  <button
                    onClick={() => setShowKey(!showKey)}
                    disabled={!apiKey}
                    className="p-2 hover:bg-muted/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={showKey ? "Hide" : "Show"}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={copyKey}
                    disabled={!apiKey}
                    className="p-2 hover:bg-muted/30 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={apiKey ? "Copy key" : "Regenerate to copy a new key"}
                  >
                    {copiedKey ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {!apiKey && (
                  <p className="text-sm text-muted-foreground">
                    Keys are stored as hashes only. Regenerate to get a new copyable key.
                  </p>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
                <div>
                  <span className="block uppercase tracking-wider mb-1">Created</span>
                  <span>{formatDateTime(createdAt)}</span>
                </div>
                <div>
                  <span className="block uppercase tracking-wider mb-1">Expires</span>
                  <span className={isExpired ? "text-red-400" : ""}>{formatDateTime(expiresAt)}</span>
                </div>
              </div>

              {keys.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    Keys ({keys.length}) · Active {activeKeyCount}
                  </p>
                  <div className="space-y-2">
                    {keys.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col gap-2 rounded border border-border/60 bg-muted/20 p-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1">
                          <code className="font-mono">{item.keyPreview || item.id}</code>
                          <p className="text-muted-foreground">
                            Created {formatDateTime(item.createdAt)} · Expires{" "}
                            <span className={item.isExpired ? "text-red-400" : ""}>
                              {formatDateTime(item.expiresAt)}
                            </span>
                          </p>
                        </div>
                        <button
                          onClick={() => void revokeKey(item.id)}
                          disabled={loading}
                          className="inline-flex items-center gap-1.5 self-start rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">MCP Endpoint URL (for MCP clients)</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted/30 px-3 py-2 rounded text-xs font-mono truncate">
                    {MCP_ENDPOINT}
                  </code>
                  <button
                    onClick={copyEndpoint}
                    className="p-2 hover:bg-muted/30 rounded transition-colors"
                    title="Copy endpoint"
                  >
                    {copiedEndpoint ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-sm text-muted-foreground">
                  If your SaaS only calls SDK endpoints (`/api/sdk/v1/*`), you can ignore this MCP endpoint.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Authorization Header</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted/30 px-3 py-2 rounded text-xs font-mono truncate">
                    {apiKey ? `Authorization: Bearer ${apiKey}` : "Authorization: Bearer <YOUR_API_KEY>"}
                  </code>
                  <button
                    onClick={copyHeader}
                    className="p-2 hover:bg-muted/30 rounded transition-colors"
                    title="Copy header"
                  >
                    {copiedHeader ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-border">
                <button
                  onClick={generateKey}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted/30 hover:bg-muted/50 rounded transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                  Create Another
                </button>
                <button
                  onClick={() => void revokeKey()}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Revoke
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Generate an API key to create AI SDK projects and connect AI tools.
              </p>
              <button
                onClick={generateKey}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Key className="h-4 w-4" />
                Generate API Key
              </button>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 border-t border-border pt-3">
              {error}
            </p>
          )}
        </div>
      </div>

      <TenantDatabaseMappingsSection
        hasApiKey={hasActiveKey}
        apiKeyExpired={hasKey && !hasActiveKey}
        workspacePlan={workspacePlan}
      />
    </div>
  )
}
