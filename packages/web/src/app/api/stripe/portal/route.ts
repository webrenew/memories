import { authenticateRequest } from "@/lib/auth"
import { getStripe } from "@/lib/stripe"
import { NextResponse } from "next/server"
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveWorkspaceContext } from "@/lib/workspace"

function jsonError(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
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

  let customerId: string | null = null
  if (workspace.ownerType === "organization") {
    if (!workspace.orgId) {
      return jsonError("Failed to resolve organization workspace", 500, "ORG_WORKSPACE_RESOLUTION_FAILED")
    }

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", workspace.orgId)
      .maybeSingle()

    if (orgError) {
      console.error("Failed to load organization billing customer:", orgError)
      return jsonError("Failed to load billing account", 500, "BILLING_CUSTOMER_LOOKUP_FAILED")
    }

    customerId = org?.stripe_customer_id ?? null
  } else {
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", auth.userId)
      .maybeSingle()

    if (profileError) {
      console.error("Failed to load user billing customer:", profileError)
      return jsonError("Failed to load billing account", 500, "BILLING_CUSTOMER_LOOKUP_FAILED")
    }

    customerId = profile?.stripe_customer_id ?? null
  }

  if (!customerId) {
    return jsonError("No billing account found", 400, "BILLING_CUSTOMER_NOT_FOUND")
  }

  try {
    const { origin } = new URL(request.url)
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/app/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("Failed to create billing portal session:", error)
    return jsonError("Failed to open billing portal", 500, "BILLING_PORTAL_CREATE_FAILED")
  }
}
