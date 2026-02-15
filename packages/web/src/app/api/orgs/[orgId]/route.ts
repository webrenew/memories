import { createClient } from "@/lib/supabase/server"
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

  if (error || !org) {
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

  // Check user is admin or owner
  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (membershipError) {
    console.error("Failed to verify organization membership for update:", {
      error: membershipError,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to update organization" }, { status: 500 })
  }

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const parsed = parseBody(updateOrgSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response

  const updates: Record<string, string | boolean | null> = {}

  if (parsed.data.name) {
    updates.name = parsed.data.name
  }

  const updatesDomainSettings =
    parsed.data.domain_auto_join_enabled !== undefined ||
    parsed.data.domain_auto_join_domain !== undefined

  if (updatesDomainSettings && membership.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can manage domain auto-join" }, { status: 403 })
  }

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

  if (updatesDomainSettings) {
    const { data: currentOrg, error: currentOrgError } = await supabase
      .from("organizations")
      .select("domain_auto_join_enabled, domain_auto_join_domain")
      .eq("id", orgId)
      .single()

    if (
      currentOrgError &&
      (isMissingColumnError(currentOrgError, "domain_auto_join_enabled") ||
        isMissingColumnError(currentOrgError, "domain_auto_join_domain"))
    ) {
      return NextResponse.json(
        { error: "Domain auto-join is not available yet. Run the latest database migration first." },
        { status: 503 },
      )
    }

    if (currentOrgError || !currentOrg) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }

    const finalEnabled =
      typeof updates.domain_auto_join_enabled === "boolean"
        ? updates.domain_auto_join_enabled
        : Boolean(currentOrg.domain_auto_join_enabled)
    const finalDomain =
      typeof updates.domain_auto_join_domain === "string" || updates.domain_auto_join_domain === null
        ? updates.domain_auto_join_domain
        : currentOrg.domain_auto_join_domain

    if (finalEnabled && (!finalDomain || String(finalDomain).trim().length === 0)) {
      return NextResponse.json(
        { error: "Set a domain before enabling domain auto-join" },
        { status: 400 },
      )
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const { data: org, error } = await supabase
    .from("organizations")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", orgId)
    .select()
    .single()

  if (error) {
    if (
      isMissingColumnError(error, "domain_auto_join_enabled") ||
      isMissingColumnError(error, "domain_auto_join_domain")
    ) {
      return NextResponse.json(
        { error: "Domain auto-join is not available yet. Run the latest database migration first." },
        { status: 503 },
      )
    }
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That domain is already configured by another organization" },
        { status: 409 },
      )
    }
    console.error("Failed to update organization row:", {
      error,
      orgId,
      userId: user.id,
      updatedFields: Object.keys(updates).sort(),
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
      updatedFields: Object.keys(updates).sort(),
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

  // Only users with owner role can delete.
  const { data: membership, error: membershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (membershipError) {
    console.error("Failed to verify organization ownership for delete:", {
      error: membershipError,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to delete organization" }, { status: 500 })
  }

  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can delete this organization" }, { status: 403 })
  }

  const { error } = await supabase
    .from("organizations")
    .delete()
    .eq("id", orgId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
