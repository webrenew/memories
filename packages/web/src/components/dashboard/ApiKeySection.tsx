"use client"

import React, { useState, useEffect, useCallback } from "react"
import { Copy, RefreshCw, Trash2, Key, Eye, EyeOff, Check } from "lucide-react"
import { TenantDatabaseMappingsSection } from "@/components/dashboard/TenantDatabaseMappingsSection"
import { extractErrorMessage } from "@/lib/client-errors"
import { recordClientWorkflowEvent } from "@/lib/client-workflow-debug"
import type { WorkspacePlan } from "@/lib/workspace"

const MCP_ENDPOINT = "https://memories.sh/api/mcp"
const DEFAULT_EXPIRY_DAYS = 30
const MIN_EXPIRY_OFFSET_MS = 60 * 1000

function toDateTimeLocalValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function defaultExpiryInputValue(): string {
  const expiry = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  return toDateTimeLocalValue(expiry)
}

function isoToLocalInputValue(iso: string | null): string {
  if (!iso) return defaultExpiryInputValue()
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return defaultExpiryInputValue()
  return toDateTimeLocalValue(parsed)
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not set"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Not set"
  return parsed.toLocaleString()
}

interface KeyMetadataResponse {
  hasKey?: boolean
  keyPreview?: string | null
  createdAt?: string | null
  expiresAt?: string | null
  isExpired?: boolean
}

interface ApiKeySectionProps {
  workspacePlan: WorkspacePlan
}

export function ApiKeySection({ workspacePlan }: ApiKeySectionProps): React.JSX.Element {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyPreview, setKeyPreview] = useState<string | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [isExpired, setIsExpired] = useState(false)
  const [expiryInput, setExpiryInput] = useState(defaultExpiryInputValue())
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedEndpoint, setCopiedEndpoint] = useState(false)
  const [copiedHeader, setCopiedHeader] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchKey = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch("/api/mcp/key")
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(extractErrorMessage(payload, `Failed to fetch API key metadata (HTTP ${res.status})`))
      }

      const data = (payload ?? {}) as KeyMetadataResponse
      setHasKey(Boolean(data.hasKey))
      setKeyPreview(data.keyPreview || null)
      setCreatedAt(data.createdAt || null)
      setExpiresAt(data.expiresAt || null)
      setIsExpired(Boolean(data.isExpired))
      setApiKey(null)
      setShowKey(false)
      setExpiryInput(isoToLocalInputValue(data.expiresAt || null))
    } catch (err) {
      console.error("Failed to fetch API key:", err)
      setError("Failed to fetch API key metadata")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchKey()
  }, [fetchKey])

  async function generateKey() {
    if (!expiryInput) {
      setError("Select an expiry date and time.")
      return
    }

    const parsedExpiry = new Date(expiryInput)
    if (Number.isNaN(parsedExpiry.getTime())) {
      setError("Expiry must be a valid date and time.")
      return
    }

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
              keyPreview?: string | null
              createdAt?: string | null
              expiresAt?: string | null
            })
          : {}

      if (data.apiKey) {
        setApiKey(data.apiKey)
        setShowKey(true)
        setHasKey(true)
        setKeyPreview(data.keyPreview || null)
        setCreatedAt(data.createdAt || new Date().toISOString())
        setExpiresAt(data.expiresAt || parsedExpiry.toISOString())
        setIsExpired(false)
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
      setLoading(false)
    }
  }

  async function revokeKey() {
    if (!confirm("Are you sure? Any tools using this key will stop working.")) {
      return
    }
    setLoading(true)
    const startedAt = performance.now()
    recordClientWorkflowEvent({
      workflow: "api_key_revoke",
      phase: "start",
    })
    try {
      setError(null)
      const res = await fetch("/api/mcp/key", { method: "DELETE" })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(extractErrorMessage(payload, `Failed to revoke API key (HTTP ${res.status})`))
      }
      setApiKey(null)
      setHasKey(false)
      setKeyPreview(null)
      setCreatedAt(null)
      setExpiresAt(null)
      setIsExpired(false)
      setShowKey(false)
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
  const minExpiryValue = toDateTimeLocalValue(new Date(Date.now() + MIN_EXPIRY_OFFSET_MS))

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
            <h3 className="font-semibold">Step 1: API Key</h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Generate a `mem_` key for SDK runtime calls and MCP clients.
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
                  Regenerate
                </button>
                <button
                  onClick={revokeKey}
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
        hasApiKey={hasKey}
        apiKeyExpired={isExpired}
        workspacePlan={workspacePlan}
      />
    </div>
  )
}
