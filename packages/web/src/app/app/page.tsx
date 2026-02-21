import React from "react"
import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { ProvisioningScreen } from "@/components/dashboard/ProvisioningScreen"
import { MemoriesSection } from "@/components/dashboard/MemoriesSection"
import { IntegrationHealthSection } from "@/components/dashboard/IntegrationHealthSection"
import { GithubCaptureQueueSection } from "@/components/dashboard/GithubCaptureQueueSection"
import { ActionableIntelligenceSection } from "@/components/dashboard/ActionableIntelligenceSection"
import type { Memory } from "@/types/memory"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope"
import { buildMemoryInsights, type MemoryInsights } from "@/lib/memory-insights"
import { isMissingDeletedAtColumnError } from "@/lib/sqlite-errors"

const INITIAL_MEMORIES_LIMIT = 50
const INSIGHTS_MEMORIES_LIMIT = 200
const MEMORY_QUERY_LIMIT = Math.max(INITIAL_MEMORIES_LIMIT + 1, INSIGHTS_MEMORIES_LIMIT)

async function listMemories(turso: ReturnType<typeof createTurso>) {
  try {
    return await turso.execute(
      `SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at
       FROM memories
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ${MEMORY_QUERY_LIMIT}`
    )
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) {
      throw error
    }

    return turso.execute(
      `SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at
       FROM memories
       ORDER BY created_at DESC, id DESC
       LIMIT ${MEMORY_QUERY_LIMIT}`
    )
  }
}

export default async function MemoriesPage(): Promise<React.JSX.Element | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const context = await resolveActiveMemoryContext(supabase, user.id)
  const hasTurso = context?.turso_db_url && context?.turso_db_token

  if (!hasTurso) {
    return <ProvisioningScreen />
  }

  let memories: Memory[] = []
  let hasMore = false
  let memoryInsights: MemoryInsights | null = null
  let connectError = false

  try {
    const turso = createTurso({ url: context.turso_db_url!, authToken: context.turso_db_token! })

    try {
      await ensureMemoryUserIdSchema(turso, {
        cacheKey: context.turso_db_name ?? context.turso_db_url,
      })
    } catch (schemaError) {
      console.warn("Dashboard schema init skipped; continuing with read-only queries:", schemaError)
    }

    const memoriesResult = await listMemories(turso)

    const loadedMemories = memoriesResult.rows.map(row => ({
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
    hasMore = loadedMemories.length > INITIAL_MEMORIES_LIMIT
    memories = loadedMemories.slice(0, INITIAL_MEMORIES_LIMIT)
    memoryInsights = buildMemoryInsights(loadedMemories.slice(0, INSIGHTS_MEMORIES_LIMIT))
  } catch (err) {
    console.error("Turso connection error:", err)
    connectError = true
  }

  const workspaceKey = `${context?.ownerType ?? "user"}:${context?.orgId ?? user.id}`

  return (
    <div className="space-y-8">
      {/* Loaded client-side to keep workspace switches snappy; endpoint has short private cache. */}
      <IntegrationHealthSection initialHealth={null} />

      <GithubCaptureQueueSection />

      <ActionableIntelligenceSection insights={connectError ? null : memoryInsights} />

      {/* Memories Section with filters */}
      {connectError ? (
        <div className="border border-border bg-card/20 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Could not connect to your memory database. Please try again later.
          </p>
        </div>
      ) : (
        <MemoriesSection
          key={workspaceKey}
          initialMemories={memories}
          initialHasMore={hasMore}
        />
      )}
    </div>
  )
}
