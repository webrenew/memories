import { authenticateRequest } from "@/lib/auth"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { parseBody, checkoutSchema } from "@/lib/validations"
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

  if (workspace.plan === "pro") {
    return NextResponse.json({ error: "Workspace is already on Pro" }, { status: 400 })
  }

  const parsed = parseBody(checkoutSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { billing } = parsed.data

  const priceId =
    billing === "annual"
      ? process.env.STRIPE_PRO_PRICE_ID_ANNUAL!
      : process.env.STRIPE_PRO_PRICE_ID!

  const { data: profile } = await admin
    .from("users")
    .select("stripe_customer_id, email")
    .eq("id", auth.userId)
    .single()

  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    // Use idempotency key to prevent duplicate customers on rapid double-clicks
    try {
      const customerEmail = profile?.email || auth.email || undefined
      const customer = await getStripe().customers.create({
        email: customerEmail,
        metadata: { supabase_user_id: auth.userId },
      }, {
        idempotencyKey: `customer_create_${auth.userId}`,
      })
      customerId = customer.id

      await admin
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", auth.userId)
    } catch {
      // Re-read in case another request already created the customer
      const { data: refreshed } = await admin
        .from("users")
        .select("stripe_customer_id")
        .eq("id", auth.userId)
        .single()

      customerId = refreshed?.stripe_customer_id
      if (!customerId) {
        return NextResponse.json({ error: "Failed to create billing account" }, { status: 500 })
      }
    }
  }

  try {
    const { origin } = new URL(request.url)
    const metadata: Record<string, string> = {
      supabase_user_id: auth.userId,
      workspace_owner_type: workspace.ownerType,
    }
    if (workspace.orgId) {
      metadata.workspace_org_id = workspace.orgId
    }

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/app?upgraded=true`,
      cancel_url: `${origin}/app/upgrade`,
      metadata,
    })

    return NextResponse.json({ url: session.url })
  } catch {
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
