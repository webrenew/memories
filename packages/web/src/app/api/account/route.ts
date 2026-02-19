import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { getTursoOrgSlug, getTursoApiToken } from "@/lib/env"

export async function DELETE(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(strictRateLimit, user.id)
  if (rateLimited) return rateLimited

  try {
    const admin = createAdminClient()

    // Get user profile
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("stripe_customer_id, turso_db_name")
      .eq("id", user.id)
      .single()

    if (profileError) {
      console.error("Failed to load user profile for account deletion:", profileError)
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
    }

    const cleanupFailures: string[] = []

    // Cancel Stripe subscriptions if present.
    if (profile?.stripe_customer_id) {
      try {
        const subscriptions = await getStripe().subscriptions.list({
          customer: profile.stripe_customer_id,
          status: "all",
        })
        const cancellableStatuses = new Set(["active", "trialing", "past_due", "unpaid"])

        for (const sub of subscriptions.data) {
          if (!cancellableStatuses.has(sub.status)) continue
          await getStripe().subscriptions.cancel(sub.id)
        }
      } catch (e) {
        console.error("Failed to cancel Stripe subscription:", e)
        cleanupFailures.push("stripe")
      }
    }

    // Delete Turso database if exists.
    if (profile?.turso_db_name) {
      try {
        const tursoOrgSlug = getTursoOrgSlug()
        const tursoApiToken = getTursoApiToken()

        if (tursoOrgSlug && tursoApiToken) {
          const response = await fetch(
            `https://api.turso.tech/v1/organizations/${tursoOrgSlug}/databases/${profile.turso_db_name}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${tursoApiToken}` },
            }
          )

          if (!response.ok && response.status !== 404) {
            const text = await response.text().catch(() => "")
            throw new Error(`Turso delete failed (${response.status}) ${text}`)
          }
        }
      } catch (e) {
        console.error("Failed to delete Turso database:", e)
        cleanupFailures.push("turso")
      }
    }

    if (cleanupFailures.length > 0) {
      return NextResponse.json(
        { error: "Failed to clean up account resources. Please retry account deletion." },
        { status: 502 }
      )
    }

    // Delete auth user first so we don't leave an active auth principal without an app profile.
    const { error: authError } = await admin.auth.admin.deleteUser(user.id)

    if (authError) {
      console.error("Failed to delete auth user:", authError)
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
    }

    // Best-effort profile cleanup after auth deletion.
    const { error: deleteError } = await admin
      .from("users")
      .delete()
      .eq("id", user.id)

    if (deleteError) {
      console.error("Failed to delete user profile after auth deletion:", deleteError)
    }

    // Sign out the user
    await supabase.auth.signOut()

    return NextResponse.json({
      success: true,
      profileCleanupPending: Boolean(deleteError),
    })
  } catch (error) {
    console.error("Account deletion error:", error)
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
  }
}
