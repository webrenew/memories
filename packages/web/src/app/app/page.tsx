import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"
import { MemoriesSection } from "@/components/dashboard/MemoriesSection"
import { ToolsPanel } from "@/components/dashboard/ToolsPanel"
import { ApiKeySection } from "@/components/dashboard/ApiKeySection"

interface Memory {
  id: string
  content: string
  tags: string | null
  type: string | null
  scope: string | null
  project_id: string | null
  created_at: string
}

export default async function MemoriesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", user.id)
    .single()

  const hasTurso = profile?.turso_db_url && profile?.turso_db_token

  if (!hasTurso) {
    return <ProvisioningScreen />
  }

  let memories: Memory[] = []
  let connectError = false

  try {
    const turso = createTurso({ url: profile.turso_db_url!, authToken: profile.turso_db_token! })
    const result = await turso.execute(
      "SELECT id, content, tags, type, scope, project_id, created_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200"
    )
    memories = result.rows.map(row => ({
      id: row.id as string,
      content: row.content as string,
      tags: row.tags as string | null,
      type: row.type as string | null,
      scope: row.scope as string | null,
      project_id: row.project_id as string | null,
      created_at: row.created_at as string,
    }))
  } catch (err) {
    console.error("Turso connection error:", err)
    connectError = true
  }

  const ruleCount = memories.filter(m => m.type === "rule").length

  return (
    <div className="space-y-8">
      {/* Tools Panel */}
      <ToolsPanel ruleCount={ruleCount} />

      {/* API Key Section */}
      <ApiKeySection />

      {/* Memories Section with filters */}
      {connectError ? (
        <div className="border border-border bg-card/20 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Could not connect to your memory database. Please try again later.
          </p>
        </div>
      ) : (
        <MemoriesSection initialMemories={memories} />
      )}
    </div>
  )
}
