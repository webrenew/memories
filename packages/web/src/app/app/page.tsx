import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"
import { MemoriesSection } from "@/components/dashboard/MemoriesSection"
import { ToolsPanel } from "@/components/dashboard/ToolsPanel"
import type { Memory } from "@/types/memory"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"

export default async function MemoriesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const context = await resolveActiveMemoryContext(supabase, user.id)
  const hasTurso = context?.turso_db_url && context?.turso_db_token

  if (!hasTurso) {
    return <ProvisioningScreen />
  }

  let memories: Memory[] = []
  let connectError = false

  try {
    const turso = createTurso({ url: context.turso_db_url!, authToken: context.turso_db_token! })
    const result = await turso.execute(
      "SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200"
    )
    memories = result.rows.map(row => ({
      id: row.id as string,
      content: row.content as string,
      tags: row.tags as string | null,
      type: (row.type as Memory["type"]) ?? "note",
      scope: (row.scope as Memory["scope"]) ?? "global",
      project_id: row.project_id as string | null,
      paths: row.paths as string | null,
      category: row.category as string | null,
      metadata: row.metadata as string | null,
      created_at: row.created_at as string,
      updated_at: (row.updated_at as string) ?? (row.created_at as string),
    }))
  } catch (err) {
    console.error("Turso connection error:", err)
    connectError = true
  }

  const ruleCount = memories.filter(m => m.type === "rule").length
  const workspaceKey = `${context?.ownerType ?? "user"}:${context?.orgId ?? user.id}`

  return (
    <div className="space-y-8">
      {/* Tools Panel */}
      <ToolsPanel ruleCount={ruleCount} />

      {/* Memories Section with filters */}
      {connectError ? (
        <div className="border border-border bg-card/20 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Could not connect to your memory database. Please try again later.
          </p>
        </div>
      ) : (
        <MemoriesSection key={workspaceKey} initialMemories={memories} />
      )}
    </div>
  )
}
