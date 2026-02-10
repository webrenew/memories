import { authenticateRequest } from "@/lib/auth"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveWorkspaceContext } from "@/lib/workspace"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(strictRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const workspace = await resolveWorkspaceContext(admin, auth.userId)
  if (!workspace) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!workspace.canManageBilling) {
    return NextResponse.json(
      { error: "Only organization owners can manage billing" },
      { status: 403 }
    )
  }

  const { data: profile } = await admin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", auth.userId)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found" }, { status: 400 })
  }

  const { origin } = new URL(request.url)

  const session = await getStripe().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${origin}/app/billing`,
  })

  return NextResponse.json({ url: session.url })
}
