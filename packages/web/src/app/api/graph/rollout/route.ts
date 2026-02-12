import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope"
import { getGraphStatusPayload } from "@/lib/memory-service/graph/status"
import { setGraphRolloutConfig } from "@/lib/memory-service/graph/rollout"
import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

const DEFAULT_TOP_NODES_LIMIT = 10

const updateSchema = z.object({
  mode: z.enum(["off", "shadow", "canary"]),
})

async function resolveWorkspaceTurso() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const context = await resolveActiveMemoryContext(supabase, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  return {
    userId: user.id,
    turso: createTurso({
      url: context.turso_db_url,
      authToken: context.turso_db_token,
    }),
  }
}

async function readGraphStatus(turso: ReturnType<typeof createTurso>) {
  const nowIso = new Date().toISOString()
  await ensureMemoryUserIdSchema(turso)
  return getGraphStatusPayload({
    turso,
    nowIso,
    topNodesLimit: DEFAULT_TOP_NODES_LIMIT,
  })
}

export async function GET() {
  try {
    const resolved = await resolveWorkspaceTurso()
    if (resolved instanceof NextResponse) {
      return resolved
    }

    const status = await readGraphStatus(resolved.turso)
    return NextResponse.json({ status })
  } catch (error) {
    console.error("Failed to load graph rollout status:", error)
    return NextResponse.json({ error: "Failed to load graph rollout status" }, { status: 500 })
  }
}

async function updateRolloutMode(request: NextRequest) {
  let parsed: z.infer<typeof updateSchema>
  try {
    parsed = updateSchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  try {
    const resolved = await resolveWorkspaceTurso()
    if (resolved instanceof NextResponse) {
      return resolved
    }

    await setGraphRolloutConfig(resolved.turso, {
      mode: parsed.mode,
      nowIso: new Date().toISOString(),
      updatedBy: resolved.userId,
    })

    const status = await readGraphStatus(resolved.turso)
    return NextResponse.json({ status })
  } catch (error) {
    console.error("Failed to update graph rollout mode:", error)
    return NextResponse.json({ error: "Failed to update graph rollout mode" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return updateRolloutMode(request)
}

export async function PATCH(request: NextRequest) {
  return updateRolloutMode(request)
}
