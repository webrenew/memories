import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"
import { RulesSection } from "@/components/dashboard/RulesSection"
import { MemoriesList } from "@/components/dashboard/MemoriesList"
import { ToolsPanel } from "@/components/dashboard/ToolsPanel"

interface Memory {
  id: string
  content: string
  tags: string | null
  type: string | null
  scope: string | null
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
      "SELECT id, content, tags, type, scope, created_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50"
    )
    memories = result.rows as Memory[]
  } catch (err) {
    console.error("Turso connection error:", err)
    connectError = true
  }

  const rules = memories.filter(m => m.type === "rule")
  const otherMemories = memories.filter(m => m.type !== "rule")

  return (
    <div className="space-y-8">
      {/* Tools Panel */}
      <ToolsPanel ruleCount={rules.length} />

      {/* Rules Section */}
      {connectError ? (
        <div className="border border-border bg-card/20 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Could not connect to your memory database. Please try again later.
          </p>
        </div>
      ) : (
        <RulesSection initialRules={rules} />
      )}

      {/* Other Memories Section */}
      {otherMemories.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold tracking-tight">Other Memories</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Decisions, facts, and notes
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-2 py-1 border border-border">
              {otherMemories.length} items
            </span>
          </div>
          <MemoriesList initialMemories={otherMemories} />
        </div>
      )}
    </div>
  )
}
