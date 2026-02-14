import { getStripe } from "./index"
import { getStripeProPriceId } from "@/lib/env"

export async function addTeamSeat({
  orgId,
  stripeCustomerId,
  stripeSubscriptionId,
  billing = "monthly",
}: {
  orgId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  billing?: "monthly" | "annual"
}): Promise<{ subscriptionId: string; action: "created" | "updated" }> {
  const stripe = getStripe()
  const priceId = getStripeProPriceId(billing)

  // If org already has a subscription, increment quantity
  if (stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    const item = subscription.items.data[0]
    
    if (item) {
      await stripe.subscriptionItems.update(item.id, {
        quantity: (item.quantity || 1) + 1,
      })
      return { subscriptionId: stripeSubscriptionId, action: "updated" }
    }
  }

  // Need to create a new subscription
  if (!stripeCustomerId) {
    throw new Error("No Stripe customer ID for organization")
  }

  const subscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: priceId, quantity: 1 }],
    metadata: { org_id: orgId, type: "team_seats" },
  })

  return { subscriptionId: subscription.id, action: "created" }
}

export async function removeTeamSeat({
  stripeSubscriptionId,
}: {
  stripeSubscriptionId: string
}): Promise<{ action: "decremented" | "cancelled" }> {
  const stripe = getStripe()
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  const item = subscription.items.data[0]

  if (!item) {
    return { action: "cancelled" }
  }

  const currentQuantity = item.quantity || 1

  if (currentQuantity <= 1) {
    // Last seat - cancel the subscription
    await stripe.subscriptions.cancel(stripeSubscriptionId)
    return { action: "cancelled" }
  }

  // Decrement quantity
  await stripe.subscriptionItems.update(item.id, {
    quantity: currentQuantity - 1,
  })

  return { action: "decremented" }
}

