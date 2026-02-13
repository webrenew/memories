import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { parseBody, applyMemoryInsightActionSchema } from "@/lib/validations"
import { applyMemoryInsightAction } from "@/lib/memory-insight-actions"

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(applyMemoryInsightActionSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const { kind, memoryIds, proposedTags } = parsed.data
  if (kind === "merge" && memoryIds.length < 2) {
    return NextResponse.json({ error: "Merge actions require at least two memories" }, { status: 400 })
  }

  if (kind === "relabel" && (!proposedTags || proposedTags.length === 0)) {
    return NextResponse.json({ error: "Relabel actions require proposed tags" }, { status: 400 })
  }

  const context = await resolveActiveMemoryContext(supabase, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  try {
    const turso = createTurso({
      url: context.turso_db_url,
      authToken: context.turso_db_token,
    })

    const result = await applyMemoryInsightAction(turso, {
      kind,
      memoryIds,
      proposedTags,
      nowIso: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply insight action"
    if (message.includes("at least") || message.includes("proposed tags") || message.includes("Select")) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    console.error("Failed to apply memory insight action:", error)
    return NextResponse.json({ error: "Failed to apply insight action" }, { status: 500 })
  }
}
