import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, updateOrgSchema } from "@/lib/validations"
import { normalizeOrgJoinDomain } from "@/lib/org-domain"

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""

  return (
    message.includes("column") &&
    message.includes(columnName.toLowerCase()) &&
    message.includes("does not exist")
  )
}

function isMissingFunctionError(error: unknown, functionName: string): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : ""
  const fn = functionName.toLowerCase()

  return (
    message.includes(fn) &&
    (message.includes("does not exist") ||
      message.includes("function") ||
      message.includes("could not find"))
  )
}

// GET /api/orgs/[orgId] - Get organization details
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
  const { orgId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  // Check user is member
  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (membershipError) {
    console.error("Failed to verify organization membership for read:", {
      error: membershipError,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to fetch organization" }, { status: 500 })
  }

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 })
  }

  const { data: org, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single()

  if (error) {
    console.error("Failed to load organization by ID:", {
      error,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to fetch organization" }, { status: 500 })
  }

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }

  return NextResponse.json({ organization: org, role: membership.role })
}

// PATCH /api/orgs/[orgId] - Update organization
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
  const { orgId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const parsed = parseBody(updateOrgSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const updates: Record<string, string | boolean | null> = {}

  if (parsed.data.name) {
    updates.name = parsed.data.name
  }

  const updatesDomainSettings =
    parsed.data.domain_auto_join_enabled !== undefined ||
    parsed.data.domain_auto_join_domain !== undefined

  if (parsed.data.domain_auto_join_domain !== undefined) {
    if (parsed.data.domain_auto_join_domain === null) {
      updates.domain_auto_join_domain = null
    } else {
      const normalizedDomain = normalizeOrgJoinDomain(parsed.data.domain_auto_join_domain)
      if (!normalizedDomain) {
        return NextResponse.json({ error: "Enter a valid domain like company.com" }, { status: 400 })
      }
      updates.domain_auto_join_domain = normalizedDomain
    }
  }

  if (parsed.data.domain_auto_join_enabled !== undefined) {
    updates.domain_auto_join_enabled = parsed.data.domain_auto_join_enabled
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const updatedFields = Object.keys(updates).sort()
  const admin = createAdminClient()
  const { data: updateResult, error: updateError } = await admin.rpc("update_org_settings_atomic", {
    p_org_id: orgId,
    p_actor_user_id: user.id,
    p_name: updates.name ?? null,
    p_set_name: updates.name !== undefined,
    p_domain_auto_join_enabled:
      typeof updates.domain_auto_join_enabled === "boolean"
        ? updates.domain_auto_join_enabled
        : null,
    p_set_domain_auto_join_enabled: updates.domain_auto_join_enabled !== undefined,
    p_domain_auto_join_domain:
      typeof updates.domain_auto_join_domain === "string" || updates.domain_auto_join_domain === null
        ? updates.domain_auto_join_domain
        : null,
    p_set_domain_auto_join_domain: updates.domain_auto_join_domain !== undefined,
  })

  if (updateError) {
    if (isMissingFunctionError(updateError, "update_org_settings_atomic")) {
      return NextResponse.json(
        { error: "Domain auto-join is not available yet. Run the latest database migration first." },
        { status: 503 },
      )
    }
    if (
      isMissingColumnError(updateError, "domain_auto_join_enabled") ||
      isMissingColumnError(updateError, "domain_auto_join_domain")
    ) {
      return NextResponse.json(
        { error: "Domain auto-join is not available yet. Run the latest database migration first." },
        { status: 503 },
      )
    }
    const errorCode =
      typeof updateError === "object" && updateError !== null && "code" in updateError
        ? String((updateError as { code?: unknown }).code ?? "")
        : ""
    if (errorCode === "23505") {
      return NextResponse.json(
        { error: "That domain is already configured by another organization" },
        { status: 409 },
      )
    }
    console.error("Failed to update organization atomically:", {
      error: updateError,
      orgId,
      userId: user.id,
      updatedFields,
    })
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 })
  }

  const updateStatus = typeof updateResult === "string" ? updateResult : null
  if (updateStatus === "insufficient_permissions") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }
  if (updateStatus === "owner_required") {
    return NextResponse.json({ error: "Only the owner can manage domain auto-join" }, { status: 403 })
  }
  if (updateStatus === "domain_required") {
    return NextResponse.json({ error: "Set a domain before enabling domain auto-join" }, { status: 400 })
  }
  if (updateStatus === "team_plan_required") {
    return NextResponse.json(
      {
        error: "Domain auto-join requires the Team plan. Upgrade to continue.",
        code: "TEAM_PLAN_REQUIRED",
        upgradeUrl: "/app/upgrade?plan=team",
      },
      { status: 402 },
    )
  }
  if (updateStatus === "org_not_found") {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }
  if (updateStatus !== "updated") {
    console.error("Unexpected update_org_settings_atomic result:", {
      orgId,
      actorUserId: user.id,
      result: updateResult,
      updatedFields,
    })
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 })
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single()

  if (orgError || !org) {
    console.error("Failed to load updated organization row:", {
      error: orgError,
      orgId,
      userId: user.id,
      updatedFields,
    })
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 })
  }

  await logOrgAuditEvent({
    client: supabase,
    orgId,
    actorUserId: user.id,
    action: updatesDomainSettings ? "org_domain_auto_join_updated" : "org_settings_updated",
    targetType: "organization",
    targetId: orgId,
    targetLabel: org?.name ?? null,
    metadata: {
      updatedFields,
      domain_auto_join_enabled: org?.domain_auto_join_enabled ?? null,
      domain_auto_join_domain: org?.domain_auto_join_domain ?? null,
    },
  })

  return NextResponse.json({ organization: org })
}

// DELETE /api/orgs/[orgId] - Delete organization
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
  const { orgId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const admin = createAdminClient()
  const { data: deleteResult, error: deleteError } = await admin.rpc("delete_organization_atomic", {
    p_org_id: orgId,
    p_actor_user_id: user.id,
  })

  if (deleteError) {
    if (isMissingFunctionError(deleteError, "delete_organization_atomic")) {
      return NextResponse.json(
        { error: "Organization deletion is not available yet. Run the latest database migration first." },
        { status: 503 }
      )
    }

    console.error("Failed to delete organization atomically:", {
      error: deleteError,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to delete organization" }, { status: 500 })
  }

  const deleteStatus = typeof deleteResult === "string" ? deleteResult : null
  if (deleteStatus === "actor_not_member" || deleteStatus === "owner_required") {
    return NextResponse.json({ error: "Only the owner can delete this organization" }, { status: 403 })
  }
  if (deleteStatus === "org_not_found") {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }
  if (deleteStatus !== "deleted") {
    console.error("Unexpected delete_organization_atomic result:", {
      orgId,
      actorUserId: user.id,
      result: deleteResult,
    })
    return NextResponse.json({ error: "Failed to delete organization" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
