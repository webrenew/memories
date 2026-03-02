import { authenticateRequest } from "@/lib/auth"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { parseBody, checkoutSchema } from "@/lib/validations"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveWorkspaceContext } from "@/lib/workspace"
import {
  getStripeCheckoutPriceId,
  getStripeGrowthOveragePriceId,
  type StripeCheckoutPlan,
} from "@/lib/env"

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

async function getOrCreateUserCustomerId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  email: string
): Promise<string | null> {
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("stripe_customer_id, email")
    .eq("id", userId)
    .single()

  if (profileError) {
    console.error("Failed to load user billing customer:", profileError)
    return null
  }

  let customerId = profile?.stripe_customer_id
  if (customerId) return customerId

  try {
    const customerEmail = profile?.email || email || undefined
    const customer = await getStripe().customers.create(
      {
        email: customerEmail,
        metadata: { supabase_user_id: userId },
      },
      {
        idempotencyKey: `customer_create_${userId}`,
      }
    )
    customerId = customer.id

    await admin
      .from("users")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId)
  } catch (error) {
    console.error("Failed to create Stripe customer for user:", error)
    const { data: refreshed } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single()

    customerId = refreshed?.stripe_customer_id
  }

  return customerId ?? null
}

async function getOrCreateOrganizationCustomerId(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string | null> {
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("stripe_customer_id, name")
    .eq("id", orgId)
    .single()

  if (orgError) {
    console.error("Failed to load organization billing customer:", orgError)
    return null
  }

  let customerId = org?.stripe_customer_id
  if (customerId) return customerId

  try {
    const customer = await getStripe().customers.create(
      {
        name: org?.name ?? undefined,
        metadata: {
          workspace_owner_type: "organization",
          workspace_org_id: orgId,
        },
      },
      {
        idempotencyKey: `org_customer_create_${orgId}`,
      }
    )
    customerId = customer.id

    await admin
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", orgId)
  } catch (error) {
    console.error("Failed to create Stripe customer for organization:", error)
    const { data: refreshed } = await admin
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", orgId)
      .single()

    customerId = refreshed?.stripe_customer_id
  }

  return customerId ?? null
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateRequest(request)

  if (!auth) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED")
  }

  const rateLimited = await checkRateLimit(strictRateLimit, auth.userId)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const workspace = await resolveWorkspaceContext(admin, auth.userId)
  if (!workspace) {
    return jsonError("Unauthorized", 401, "WORKSPACE_UNAVAILABLE")
  }

  if (!workspace.canManageBilling) {
    return jsonError("Only organization owners can manage billing", 403, "BILLING_PERMISSION_DENIED")
  }

  const parsed = parseBody(checkoutSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { billing, requestId } = parsed.data

  const defaultPlan: StripeCheckoutPlan = workspace.ownerType === "organization" ? "team" : "individual"
  const requestedPlan = parsed.data.plan ?? defaultPlan

  if (workspace.ownerType === "organization" && requestedPlan === "individual") {
    return jsonError(
      "Organization workspaces can only subscribe to Team or Growth plans",
      400,
      "INVALID_ORG_PLAN_SELECTION"
    )
  }

  if (workspace.ownerType === "user" && requestedPlan === "team") {
    return jsonError(
      "Team seats require an organization workspace",
      400,
      "INVALID_USER_PLAN_SELECTION"
    )
  }

  if (workspace.plan === requestedPlan) {
    return jsonError("Workspace is already on this plan", 400, "ALREADY_ON_PLAN")
  }

  const priceId = getStripeCheckoutPriceId(requestedPlan, billing)

  let customerId: string | null = null
  if (workspace.ownerType === "organization") {
    if (!workspace.orgId) {
      return jsonError("Failed to resolve organization workspace", 500, "ORG_WORKSPACE_RESOLUTION_FAILED")
    }
    customerId = await getOrCreateOrganizationCustomerId(admin, workspace.orgId)
  } else {
    customerId = await getOrCreateUserCustomerId(admin, auth.userId, auth.email)
  }

  if (!customerId) {
    return jsonError("Failed to create billing account", 500, "BILLING_CUSTOMER_CREATE_FAILED")
  }

  try {
    const { origin } = new URL(request.url)
    const metadata: Record<string, string> = {
      supabase_user_id: auth.userId,
      workspace_owner_type: workspace.ownerType,
      billing_plan: requestedPlan,
    }
    if (workspace.orgId) {
      metadata.workspace_org_id = workspace.orgId
    }

    const sessionPayload: {
      customer: string
      line_items: Array<{ price: string; quantity?: number }>
      mode: "subscription"
      success_url: string
      cancel_url: string
      metadata: Record<string, string>
      subscription_data?: { metadata: Record<string, string> }
    } = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/app?upgraded=true`,
      cancel_url: `${origin}/app/upgrade`,
      metadata,
    }

    if (requestedPlan === "growth") {
      sessionPayload.line_items.push({ price: getStripeGrowthOveragePriceId() })
    }

    const subscriptionType =
      requestedPlan === "team"
        ? "team_seats"
        : requestedPlan === "growth"
          ? "growth_base"
          : "individual"

    const subscriptionMetadata: Record<string, string> = {
      type: subscriptionType,
      billing_plan: requestedPlan,
      created_by_user_id: auth.userId,
    }
    if (workspace.ownerType === "organization" && workspace.orgId) {
      subscriptionMetadata.org_id = workspace.orgId
    }
    sessionPayload.subscription_data = { metadata: subscriptionMetadata }

    const session = requestId
      ? await getStripe().checkout.sessions.create(sessionPayload, {
          idempotencyKey: `checkout_${auth.userId}_${requestId}`,
        })
      : await getStripe().checkout.sessions.create(sessionPayload)

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Failed to create checkout session:", error)
    return jsonError("Failed to create checkout session", 500, "CHECKOUT_SESSION_CREATE_FAILED")
  }
}
