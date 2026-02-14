import Stripe from "stripe"
import { getStripeSecretKey } from "@/lib/env"

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(getStripeSecretKey(), {
      typescript: true,
    })
  }
  return _stripe
}
