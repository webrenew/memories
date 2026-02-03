import { authenticateRequest } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDatabase, createDatabaseToken, initSchema } from "@/lib/turso"
import { NextResponse } from "next/server"

const TURSO_ORG = "webrenew"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()

  // Check if user already has a provisioned database
  const { data: profile } = await admin
    .from("users")
    .select("turso_db_url, turso_db_token")
    .eq("id", auth.userId)
    .single()

  if (profile?.turso_db_url && profile?.turso_db_token) {
    return NextResponse.json({
      url: profile.turso_db_url,
      provisioned: false,
    })
  }

  // Ensure user row exists (trigger may not have fired yet)
  if (!profile) {
    const { error: insertError } = await admin
      .from("users")
      .upsert({ id: auth.userId, email: auth.email }, { onConflict: "id" })

    if (insertError) {
      console.error("Failed to create user row:", insertError)
      return NextResponse.json(
        { error: "Failed to initialize user" },
        { status: 500 }
      )
    }
  }

  try {
    // Create a new Turso database
    const db = await createDatabase(TURSO_ORG)
    const token = await createDatabaseToken(TURSO_ORG, db.name)
    const url = `libsql://${db.hostname}`

    // Wait for Turso to finish provisioning
    await new Promise((r) => setTimeout(r, 3000))

    // Initialize the schema
    await initSchema(url, token)

    // Save credentials and dbName via admin client
    const { error } = await admin
      .from("users")
      .update({ turso_db_url: url, turso_db_token: token, turso_db_name: db.name })
      .eq("id", auth.userId)

    if (error) {
      return NextResponse.json(
        { error: "Failed to save database credentials" },
        { status: 500 }
      )
    }

    return NextResponse.json({ url, provisioned: true })
  } catch (err) {
    console.error("Provisioning error:", err)
    return NextResponse.json(
      { error: "Failed to provision database" },
      { status: 500 }
    )
  }
}
