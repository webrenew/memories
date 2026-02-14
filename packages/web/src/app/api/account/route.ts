import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { getTursoOrgSlug, getTursoApiToken, getSupabaseUrl, getSupabaseServiceRoleKey } from "@/lib/env"

export async function DELETE(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(strictRateLimit, user.id)
  if (rateLimited) return rateLimited

  try {
    // Get user profile
    const { data: profile } = await supabase
      .from("users")
      .select("stripe_customer_id, turso_db_name")
      .eq("id", user.id)
      .single()

    // Cancel Stripe subscription if exists
    if (profile?.stripe_customer_id) {
      try {
        const subscriptions = await getStripe().subscriptions.list({
          customer: profile.stripe_customer_id,
          status: "active",
        })
        
        for (const sub of subscriptions.data) {
          await getStripe().subscriptions.cancel(sub.id)
        }
      } catch (e) {
        console.error("Failed to cancel Stripe subscription:", e)
      }
    }

    // Delete Turso database if exists
    if (profile?.turso_db_name) {
      try {
        const tursoOrgSlug = getTursoOrgSlug()
        const tursoApiToken = getTursoApiToken()
        
        if (tursoOrgSlug && tursoApiToken) {
          await fetch(
            `https://api.turso.tech/v1/organizations/${tursoOrgSlug}/databases/${profile.turso_db_name}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${tursoApiToken}` },
            }
          )
        }
      } catch (e) {
        console.error("Failed to delete Turso database:", e)
      }
    }

    // Delete user from users table
    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", user.id)

    if (deleteError) {
      console.error("Failed to delete user record:", deleteError)
    }

    // Delete auth user (requires admin client)
    const adminClient = createAdminClient(
      getSupabaseUrl(),
      getSupabaseServiceRoleKey()
    )
    
    const { error: authError } = await adminClient.auth.admin.deleteUser(user.id)
    
    if (authError) {
      console.error("Failed to delete auth user:", authError)
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
    }

    // Sign out the user
    await supabase.auth.signOut()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Account deletion error:", error)
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 })
  }
}
