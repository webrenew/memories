import React from "react"
import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"
import { MemoryGraphSection } from "@/components/dashboard/MemoryGraphSection"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope"
import { getGraphStatusPayload, type GraphStatusPayload } from "@/lib/memory-service/graph/status"

export const metadata = {
  title: "Graph Explorer",
}

export default async function GraphExplorerPage(): Promise<React.JSX.Element | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const context = await resolveActiveMemoryContext(supabase, user.id)
  const hasTurso = context?.turso_db_url && context?.turso_db_token

  if (!hasTurso) {
    return <ProvisioningScreen />
  }

  let graphStatus: GraphStatusPayload | null = null
  let connectError = false

  try {
    const turso = createTurso({ url: context.turso_db_url!, authToken: context.turso_db_token! })

    try {
      await ensureMemoryUserIdSchema(turso, {
        cacheKey: context.turso_db_name ?? context.turso_db_url,
      })
    } catch (schemaError) {
      console.warn("Graph explorer schema init skipped; continuing with read-only queries:", schemaError)
    }

    graphStatus = await getGraphStatusPayload({
      turso,
      nowIso: new Date().toISOString(),
      topNodesLimit: 10,
      syncMappings: false,
    })
  } catch (err) {
    console.error("Graph explorer connection error:", err)
    connectError = true
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Graph Explorer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inspect graph rollout health and traverse node relationships.
        </p>
      </div>

      <MemoryGraphSection status={connectError ? null : graphStatus} />
    </div>
  )
}
