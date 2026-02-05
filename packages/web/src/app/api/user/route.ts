import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// Valid embedding models (must match CLI)
const VALID_EMBEDDING_MODELS = [
  "all-MiniLM-L6-v2",
  "gte-small",
  "gte-base",
  "gte-large",
  "mxbai-embed-large-v1",
]

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))

  const updates: Record<string, string> = {}

  if (typeof body.name === "string" && body.name.length <= 200) {
    updates.name = body.name
  }

  if (typeof body.embedding_model === "string") {
    if (VALID_EMBEDDING_MODELS.includes(body.embedding_model)) {
      updates.embedding_model = body.embedding_model
    } else {
      return NextResponse.json(
        { error: `Invalid embedding model. Valid options: ${VALID_EMBEDDING_MODELS.join(", ")}` },
        { status: 400 }
      )
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const { error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", user.id)

  if (error) {
    console.error("User update error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
