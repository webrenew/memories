"use client"

import React, { useState } from "react"
import { ArrowRightLeft, Loader2 } from "lucide-react"

interface MemoryMigrationCardProps {
  orgId: string
}

interface MigrateResult {
  migrated: number
  skipped: number
  total: number
  direction: string
  graph?: {
    mapped: number
    skipped: number
  }
}

export function MemoryMigrationCard({ orgId }: MemoryMigrationCardProps): React.JSX.Element {
  const [migrating, setMigrating] = useState(false)
  const [result, setResult] = useState<MigrateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function migrateMemories(direction: "personal_to_org" | "org_to_personal") {
    const label = direction === "personal_to_org"
      ? "personal memories to this organization"
      : "organization memories to your personal workspace"

    if (!confirm(`Copy ${label}? This will not delete the originals.`)) return

    setMigrating(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch("/api/memories/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, orgId }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Migration failed")
      }

      setResult({ ...data, direction })
    } catch (err) {
      console.error("Memory migration failed:", err)
      setError(err instanceof Error ? err.message : "Migration failed")
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className="border border-border bg-card/20">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Memory Migration</h3>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Copy memories between your personal workspace and this organization.
          Originals are never deleted.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => migrateMemories("personal_to_org")}
            disabled={migrating}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {migrating ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
            Copy personal → org
          </button>
          <button
            onClick={() => migrateMemories("org_to_personal")}
            disabled={migrating}
            className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border border-border text-xs font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {migrating ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
            Copy org → personal
          </button>
        </div>
        {result && (
          <div className="bg-green-500/10 border border-green-500/20 p-3 text-sm">
            <p className="text-green-400 font-medium">
              Migrated {result.migrated} {result.migrated === 1 ? "memory" : "memories"}
              {result.skipped > 0 && (
                <span className="text-muted-foreground font-normal">
                  {" "}({result.skipped} already existed)
                </span>
              )}
            </p>
            {result.graph && (
              <p className="text-xs text-muted-foreground mt-1">
                Graph mappings synced: {result.graph.mapped}
                {result.graph.skipped > 0 ? ` (${result.graph.skipped} skipped)` : ""}
              </p>
            )}
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
