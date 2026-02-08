import { createClient } from "@/lib/supabase/server"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { parseBody, checkoutSchema } from "@/lib/validations"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(strictRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(checkoutSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { billing } = parsed.data

  const priceId =
    billing === "annual"
      ? process.env.STRIPE_PRO_PRICE_ID_ANNUAL!
      : process.env.STRIPE_PRO_PRICE_ID!

  const { data: profile } = await supabase
    .from("users")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single()

  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    // Use idempotency key to prevent duplicate customers on rapid double-clicks
    try {
      const customer = await getStripe().customers.create({
        email: profile?.email ?? user.email!,
        metadata: { supabase_user_id: user.id },
      }, {
        idempotencyKey: `customer_create_${user.id}`,
      })
      customerId = customer.id

      await supabase
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id)
    } catch {
      // Re-read in case another request already created the customer
      const { data: refreshed } = await supabase
        .from("users")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single()

      customerId = refreshed?.stripe_customer_id
      if (!customerId) {
        return NextResponse.json({ error: "Failed to create billing account" }, { status: 500 })
      }
    }
  }

  try {
    const { origin } = new URL(request.url)

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/app?upgraded=true`,
      cancel_url: `${origin}/app/upgrade`,
      metadata: { supabase_user_id: user.id },
    })

    return NextResponse.json({ url: session.url })
  } catch {
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
