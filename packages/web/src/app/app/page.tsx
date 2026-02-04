import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"

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

  // Fetch memories directly via Turso (server-only, no credential leaking)
  let memories: Array<Record<string, unknown>> = []
  let connectError = false

  try {
    const turso = createTurso({ url: profile.turso_db_url!, authToken: profile.turso_db_token! })
    const result = await turso.execute(
      "SELECT id, content, tags, type, scope, created_at FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50"
    )
    memories = result.rows as Array<Record<string, unknown>>
  } catch (err) {
    console.error("Turso connection error:", err)
    connectError = true
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Memories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse and search your stored memories
          </p>
        </div>
      </div>

      {connectError ? (
        <div className="border border-border bg-card/20 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Could not connect to your memory database. Please try again later.
          </p>
        </div>
      ) : memories.length === 0 ? (
        <div className="border border-border bg-card/20 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No memories found. Start using the CLI to create memories.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {memories.map((memory) => (
            <div
              key={String(memory.id)}
              className="border border-border bg-card/20 p-5 hover:border-primary/30 transition-all duration-300"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-2">
                  {memory.type ? (
                    <span className="px-2 py-0.5 bg-primary/10 border border-primary/20 text-[10px] uppercase tracking-wider font-bold text-primary">
                      {String(memory.type)}
                    </span>
                  ) : null}
                  {memory.scope ? (
                    <span className="px-2 py-0.5 bg-muted/50 border border-border text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                      {String(memory.scope)}
                    </span>
                  ) : null}
                  {memory.tags ? (
                    String(memory.tags)
                      .split(",")
                      .map((tag: string) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-muted/50 border border-border text-[10px] uppercase tracking-wider font-bold text-muted-foreground"
                        >
                          {tag.trim()}
                        </span>
                      ))
                  ) : null}
                </div>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">
                  {new Date(String(memory.created_at)).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed line-clamp-3">
                {String(memory.content)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
