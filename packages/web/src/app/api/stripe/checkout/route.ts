import { authenticateRequest } from "@/lib/auth"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { setTimeout as delay } from "node:timers/promises"
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

type StripeCustomerLockTarget =
  | { ownerType: "user"; ownerKey: string; ownerUserId: string; ownerOrgId: null }
  | { ownerType: "organization"; ownerKey: string; ownerUserId: null; ownerOrgId: string }

const STRIPE_CUSTOMER_LOCK_STALE_MS = 15 * 60 * 1000
const STRIPE_CUSTOMER_LOCK_WAIT_ATTEMPTS = 8
const STRIPE_CUSTOMER_LOCK_WAIT_MS = 250

function isUniqueViolation(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : ""
  if (code === "23505") return true

  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return message.includes("duplicate key")
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes(tableName.toLowerCase()) &&
    (message.includes("does not exist") || message.includes("could not find the table"))
  )
}

function buildStripeCustomerLockTarget(params: {
  ownerType: "user" | "organization"
  userId?: string
  orgId?: string
}): StripeCustomerLockTarget {
  if (params.ownerType === "organization") {
    if (!params.orgId) {
      throw new Error("Organization id is required for stripe customer provisioning lock")
    }
    return {
      ownerType: "organization",
      ownerKey: `org:${params.orgId}`,
      ownerUserId: null,
      ownerOrgId: params.orgId,
    }
  }

  if (!params.userId) {
    throw new Error("User id is required for stripe customer provisioning lock")
  }
  return {
    ownerType: "user",
    ownerKey: `user:${params.userId}`,
    ownerUserId: params.userId,
    ownerOrgId: null,
  }
}

async function clearStaleStripeCustomerLock(
  admin: ReturnType<typeof createAdminClient>,
  lockTarget: StripeCustomerLockTarget,
): Promise<{ error: unknown }> {
  const staleBeforeIso = new Date(Date.now() - STRIPE_CUSTOMER_LOCK_STALE_MS).toISOString()
  const { error } = await admin
    .from("stripe_customer_provision_locks")
    .delete()
    .eq("owner_key", lockTarget.ownerKey)
    .lt("created_at", staleBeforeIso)

  return { error }
}

async function acquireStripeCustomerLock(params: {
  admin: ReturnType<typeof createAdminClient>
  lockTarget: StripeCustomerLockTarget
  actorUserId: string
}): Promise<{ acquired: boolean; error: unknown }> {
  const { admin, lockTarget, actorUserId } = params

  const staleCleanup = await clearStaleStripeCustomerLock(admin, lockTarget)
  if (staleCleanup.error) {
    return { acquired: false, error: staleCleanup.error }
  }

  const { data, error } = await admin
    .from("stripe_customer_provision_locks")
    .insert({
      owner_key: lockTarget.ownerKey,
      owner_type: lockTarget.ownerType,
      owner_user_id: lockTarget.ownerUserId,
      owner_org_id: lockTarget.ownerOrgId,
      locked_by_user_id: actorUserId,
    })
    .select("owner_key")
    .maybeSingle()

  if (error) {
    if (isUniqueViolation(error)) {
      return { acquired: false, error: null }
    }
    return { acquired: false, error }
  }

  return { acquired: Boolean(data), error: null }
}

async function releaseStripeCustomerLock(params: {
  admin: ReturnType<typeof createAdminClient>
  lockTarget: StripeCustomerLockTarget
  actorUserId: string
}): Promise<void> {
  const { admin, lockTarget, actorUserId } = params

  const { error } = await admin
    .from("stripe_customer_provision_locks")
    .delete()
    .eq("owner_key", lockTarget.ownerKey)
    .eq("locked_by_user_id", actorUserId)

  if (error && !isMissingTableError(error, "stripe_customer_provision_locks")) {
    console.warn("Failed to release stripe customer provisioning lock:", {
      lockOwnerKey: lockTarget.ownerKey,
      actorUserId,
      error,
    })
  }
}

async function waitForUserCustomerId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string | null> {
  for (let attempt = 0; attempt < STRIPE_CUSTOMER_LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const { data: refreshed, error } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single()

    if (error) {
      console.error("Failed while waiting for user stripe customer id:", error)
      return null
    }

    const customerId = refreshed?.stripe_customer_id ?? null
    if (customerId) return customerId

    await delay(STRIPE_CUSTOMER_LOCK_WAIT_MS)
  }

  return null
}

async function waitForOrganizationCustomerId(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string | null> {
  for (let attempt = 0; attempt < STRIPE_CUSTOMER_LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const { data: refreshed, error } = await admin
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", orgId)
      .single()

    if (error) {
      console.error("Failed while waiting for organization stripe customer id:", error)
      return null
    }

    const customerId = refreshed?.stripe_customer_id ?? null
    if (customerId) return customerId

    await delay(STRIPE_CUSTOMER_LOCK_WAIT_MS)
  }

  return null
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

  const lockTarget = buildStripeCustomerLockTarget({
    ownerType: "user",
    userId,
  })

  const lockResult = await acquireStripeCustomerLock({
    admin,
    lockTarget,
    actorUserId: userId,
  })

  if (lockResult.error) {
    if (!isMissingTableError(lockResult.error, "stripe_customer_provision_locks")) {
      console.error("Failed to acquire user stripe customer lock:", {
        userId,
        error: lockResult.error,
      })
      return null
    }
  }

  if (!lockResult.error && !lockResult.acquired) {
    return await waitForUserCustomerId(admin, userId)
  }

  try {
    const { data: refreshedProfile, error: refreshedProfileError } = await admin
      .from("users")
      .select("stripe_customer_id, email")
      .eq("id", userId)
      .single()

    if (refreshedProfileError) {
      console.error("Failed to refresh user billing customer before create:", refreshedProfileError)
      return null
    }

    customerId = refreshedProfile?.stripe_customer_id ?? null
    if (customerId) return customerId

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

    const persistResult = await admin
      .from("users")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId)
      .is("stripe_customer_id", null)
      .select("stripe_customer_id")
      .maybeSingle()

    if (persistResult.error) {
      console.error("Failed to persist user stripe customer id:", persistResult.error)
    }
  } catch (error) {
    console.error("Failed to create Stripe customer for user:", error)
  } finally {
    await releaseStripeCustomerLock({
      admin,
      lockTarget,
      actorUserId: userId,
    })
  }

  const { data: refreshed } = await admin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single()

  return refreshed?.stripe_customer_id ?? customerId ?? null
}

async function getOrCreateOrganizationCustomerId(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  actorUserId: string
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

  const lockTarget = buildStripeCustomerLockTarget({
    ownerType: "organization",
    orgId,
  })

  const lockResult = await acquireStripeCustomerLock({
    admin,
    lockTarget,
    actorUserId,
  })

  if (lockResult.error) {
    if (!isMissingTableError(lockResult.error, "stripe_customer_provision_locks")) {
      console.error("Failed to acquire org stripe customer lock:", {
        orgId,
        actorUserId,
        error: lockResult.error,
      })
      return null
    }
  }

  if (!lockResult.error && !lockResult.acquired) {
    return await waitForOrganizationCustomerId(admin, orgId)
  }

  try {
    const { data: refreshedOrg, error: refreshedOrgError } = await admin
      .from("organizations")
      .select("stripe_customer_id, name")
      .eq("id", orgId)
      .single()

    if (refreshedOrgError) {
      console.error("Failed to refresh organization billing customer before create:", refreshedOrgError)
      return null
    }

    customerId = refreshedOrg?.stripe_customer_id ?? null
    if (customerId) return customerId

    const customer = await getStripe().customers.create(
      {
        name: refreshedOrg?.name ?? org?.name ?? undefined,
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

    const persistResult = await admin
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", orgId)
      .is("stripe_customer_id", null)
      .select("stripe_customer_id")
      .maybeSingle()

    if (persistResult.error) {
      console.error("Failed to persist organization stripe customer id:", persistResult.error)
    }
  } catch (error) {
    console.error("Failed to create Stripe customer for organization:", error)
  } finally {
    await releaseStripeCustomerLock({
      admin,
      lockTarget,
      actorUserId,
    })
  }

  const { data: refreshed } = await admin
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", orgId)
    .single()

  return refreshed?.stripe_customer_id ?? customerId ?? null
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
    customerId = await getOrCreateOrganizationCustomerId(admin, workspace.orgId, auth.userId)
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
