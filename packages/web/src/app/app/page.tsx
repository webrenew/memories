import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"
import { MemoriesSection } from "@/components/dashboard/MemoriesSection"
import { MemoryGraphSection } from "@/components/dashboard/MemoryGraphSection"
import type { Memory } from "@/types/memory"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { getGraphStatusPayload, type GraphStatusPayload } from "@/lib/memory-service/graph/status"

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
  let graphStatus: GraphStatusPayload | null = null
  let connectError = false

  try {
    const turso = createTurso({ url: context.turso_db_url!, authToken: context.turso_db_token! })
    const [result, graphStatusResult] = await Promise.all([
      turso.execute(
        "SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200"
      ),
      getGraphStatusPayload({
        turso,
        nowIso: new Date().toISOString(),
        topNodesLimit: 10,
      }),
    ])
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
    graphStatus = graphStatusResult
  } catch (err) {
    console.error("Turso connection error:", err)
    connectError = true
  }

  const workspaceKey = `${context?.ownerType ?? "user"}:${context?.orgId ?? user.id}`

  return (
    <div className="space-y-8">
      {/* Memory Graph Section */}
      <MemoryGraphSection status={connectError ? null : graphStatus} />

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
