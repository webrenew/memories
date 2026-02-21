import { authenticateRequest } from "@/lib/auth"
import { strictRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createTurso } from "@libsql/client"
import { initSchema } from "@/lib/turso"
import { syncMemoryGraphMapping } from "@/lib/memory-service/graph/upsert"
import { defaultLayerForType, type MemoryLayer } from "@/lib/memory-service/types"
import { NextResponse } from "next/server"
import { z } from "zod"
import { parseBody } from "@/lib/validations"

const migrateSchema = z.object({
  direction: z.enum(["personal_to_org", "org_to_personal"]),
  orgId: z.string().min(1, "Organization ID is required"),
})

interface SourceMemoryRow {
  id: string
  content: string
  tags: string | null
  type: string | null
  scope: string | null
  project_id: string | null
  paths: string | null
  category: string | null
  metadata: string | null
  created_at: string
  updated_at: string | null
  memory_layer?: string | null
  expires_at?: string | null
  user_id?: string | null
}

function parseTags(rawTags: string | null): string[] {
  if (!rawTags) return []
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function parseLayer(type: string, memoryLayer: string | null | undefined): MemoryLayer {
  if (memoryLayer === "rule" || memoryLayer === "working" || memoryLayer === "long_term") {
    return memoryLayer
  }
  return defaultLayerForType(type)
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes("column") &&
    message.includes(columnName.toLowerCase()) &&
    message.includes("does not exist")
  )
}

/**
 * Copy memories between a user's personal Turso database and an organization's
 * Turso database. This is a non-destructive copy — source records are never deleted.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(strictRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const parsed = parseBody(migrateSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const { direction, orgId } = parsed.data
  const admin = createAdminClient()

  // Verify org membership with owner or admin role
  const { data: membership, error: membershipError } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", auth.userId)
    .single()

  if (membershipError || !membership) {
    return NextResponse.json(
      { error: "You are not a member of this organization" },
      { status: 403 }
    )
  }

  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json(
      { error: "Only owners and admins can migrate memories" },
      { status: 403 }
    )
  }

  // Fetch user Turso credentials
  const { data: userData, error: userError } = await admin
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", auth.userId)
    .single()

  if (userError || !userData?.turso_db_url || !userData?.turso_db_token) {
    return NextResponse.json(
      { error: "Your personal database is not provisioned" },
      { status: 400 }
    )
  }

  // Fetch org Turso credentials
  const { data: orgData, error: orgError } = await admin
    .from("organizations")
    .select("turso_db_url, turso_db_token")
    .eq("id", orgId)
    .single()

  if (orgError || !orgData?.turso_db_url || !orgData?.turso_db_token) {
    return NextResponse.json(
      { error: "Organization database is not provisioned" },
      { status: 400 }
    )
  }

  const sourceUrl = direction === "personal_to_org" ? userData.turso_db_url : orgData.turso_db_url
  const sourceToken = direction === "personal_to_org" ? userData.turso_db_token : orgData.turso_db_token
  const destUrl = direction === "personal_to_org" ? orgData.turso_db_url : userData.turso_db_url
  const destToken = direction === "personal_to_org" ? orgData.turso_db_token : userData.turso_db_token

  try {
    const sourceDb = createTurso({ url: sourceUrl, authToken: sourceToken })
    const destDb = createTurso({ url: destUrl, authToken: destToken })

    // Ensure destination schema is ready
    await initSchema(destUrl, destToken)

    // Read all non-deleted memories from source
    let sourceRows: SourceMemoryRow[]
    try {
      const sourceResultWithGraphColumns = await sourceDb.execute(
        "SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at, memory_layer, expires_at, user_id FROM memories WHERE deleted_at IS NULL"
      )
      sourceRows = sourceResultWithGraphColumns.rows as unknown as SourceMemoryRow[]
    } catch (sourceError) {
      if (
        isMissingColumnError(sourceError, "memory_layer") ||
        isMissingColumnError(sourceError, "expires_at") ||
        isMissingColumnError(sourceError, "user_id")
      ) {
        const fallbackSourceResult = await sourceDb.execute(
          "SELECT id, content, tags, type, scope, project_id, paths, category, metadata, created_at, updated_at FROM memories WHERE deleted_at IS NULL"
        )
        sourceRows = fallbackSourceResult.rows as unknown as SourceMemoryRow[]
      } else {
        throw sourceError
      }
    }

    if (sourceRows.length === 0) {
      return NextResponse.json({ migrated: 0, skipped: 0, total: 0 })
    }

    // Get existing IDs in destination to skip duplicates
    const destResult = await destDb.execute(
      "SELECT id FROM memories WHERE deleted_at IS NULL"
    )
    const existingIds = new Set(destResult.rows.map((r) => r.id as string))

    let migrated = 0
    let skipped = 0
    let graphMapped = 0
    let graphSkipped = 0

    for (const row of sourceRows) {
      const type = row.type ?? "note"
      const scope = row.scope ?? "global"
      if (existingIds.has(row.id as string)) {
        skipped++
      } else {
        try {
          await destDb.execute({
            sql: `INSERT INTO memories (
                    id, content, tags, type, scope, project_id, user_id, memory_layer, expires_at, paths, category, metadata, created_at, updated_at
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              row.id,
              row.content,
              row.tags ?? null,
              type,
              scope,
              row.project_id ?? null,
              row.user_id ?? null,
              row.memory_layer ?? parseLayer(type, row.memory_layer),
              row.expires_at ?? null,
              row.paths ?? null,
              row.category ?? null,
              row.metadata ?? null,
              row.created_at,
              row.updated_at ?? row.created_at,
            ],
          })
          migrated++
        } catch (insertError) {
          // Skip individual insert failures (e.g. constraint violations)
          console.error(`Failed to migrate memory ${row.id}:`, insertError)
          skipped++
          continue
        }
      }

      try {
        await syncMemoryGraphMapping(destDb, {
          id: row.id,
          content: row.content,
          type,
          layer: parseLayer(type, row.memory_layer),
          expiresAt: row.expires_at ?? null,
          projectId: row.project_id ?? null,
          userId: row.user_id ?? null,
          tags: parseTags(row.tags ?? null),
          category: row.category ?? null,
        })
        graphMapped++
      } catch (graphError) {
        console.error(`Failed to sync graph mapping for memory ${row.id}:`, graphError)
        graphSkipped++
      }
    }

    return NextResponse.json({
      migrated,
      skipped,
      total: sourceRows.length,
      graph: {
        mapped: graphMapped,
        skipped: graphSkipped,
      },
    })
  } catch (err) {
    console.error("Memory migration error:", err)
    return NextResponse.json(
      { error: "Migration failed — could not connect to one or both databases" },
      { status: 500 }
    )
  }
}
