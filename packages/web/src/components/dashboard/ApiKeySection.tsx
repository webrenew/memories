"use client"

import { useState, useEffect, useCallback } from "react"
import { Copy, RefreshCw, Trash2, Key, Eye, EyeOff, Check } from "lucide-react"

export function ApiKeySection() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)

  useEffect(() => {
    fetchKey()
  }, [])

  async function fetchKey() {
    try {
      const res = await fetch("/api/mcp/key")
      const data = await res.json()
      setApiKey(data.apiKey || null)
    } catch (err) {
      console.error("Failed to fetch API key:", err)
    } finally {
      setLoading(false)
    }
  }

  async function generateKey() {
    setLoading(true)
    try {
      const res = await fetch("/api/mcp/key", { method: "POST" })
      const data = await res.json()
      if (data.apiKey) {
        setApiKey(data.apiKey)
        setShowKey(true)
      }
    } catch (err) {
      console.error("Failed to generate API key:", err)
    } finally {
      setLoading(false)
    }
  }

  async function revokeKey() {
    if (!confirm("Are you sure? Any tools using this key will stop working.")) {
      return
    }
    setLoading(true)
    try {
      await fetch("/api/mcp/key", { method: "DELETE" })
      setApiKey(null)
      setShowKey(false)
    } catch (err) {
      console.error("Failed to revoke API key:", err)
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
    }
  }, [apiKey])

  const copyUrl = useCallback(async () => {
    if (!apiKey) return
    const url = `https://memories.sh/api/mcp?api_key=${apiKey}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [apiKey])

  const maskedKey = apiKey ? `${apiKey.slice(0, 12)}${"•".repeat(40)}${apiKey.slice(-4)}` : ""

  if (loading && !apiKey) {
    return (
      <div className="border border-border bg-card/20 rounded-lg p-6">
        <div className="animate-pulse h-20 bg-muted/20 rounded" />
      </div>
    )
  }

  return (
    <div className="border border-border bg-card/20 rounded-lg">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">API Key</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Connect Cursor, Claude, and other AI tools to your memories
        </p>
      </div>

      <div className="p-4 space-y-4">
        {apiKey ? (
          <div className="space-y-4">
            {/* API Key */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Your API Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted/30 px-3 py-2 rounded text-xs font-mono break-all select-all">
                  {showKey ? apiKey : maskedKey}
                </code>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="p-2 hover:bg-muted/30 rounded transition-colors"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={copyKey}
                  className="p-2 hover:bg-muted/30 rounded transition-colors"
                  title="Copy key"
                >
                  {copiedKey ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* MCP URL */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">MCP Endpoint URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted/30 px-3 py-2 rounded text-xs font-mono truncate">
                  https://memories.sh/api/mcp?api_key=...
                </code>
                <button
                  onClick={copyUrl}
                  className="p-2 hover:bg-muted/30 rounded transition-colors"
                  title="Copy full URL"
                >
                  {copiedUrl ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Actions */}
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
              Generate an API key to connect AI tools to your memories.
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
      </div>
    </div>
  )
}
