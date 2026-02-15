import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { removeTeamSeat } from "@/lib/stripe/teams"
import { createClient as createTurso } from "@libsql/client"
import { NextResponse } from "next/server"
import { apiRateLimit, checkRateLimit } from "@/lib/rate-limit"
import { parseBody, updateMemberRoleSchema } from "@/lib/validations"

interface OrgMemberRow {
  id: string
  user_id: string
  role: string
  created_at?: string | null
}

interface UserRow {
  id: string
  email: string | null
  name: string | null
  avatar_url: string | null
}

interface OrganizationTursoRow {
  turso_db_url: string | null
  turso_db_token: string | null
}

interface AuthUserRow {
  id: string
  last_sign_in_at?: string | null
}

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

async function listLastLoginByUserId(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const output = new Map<string, string | null>()
  const remaining = new Set(userIds)
  if (remaining.size === 0) return output

  let page = 1
  const perPage = Math.min(1000, Math.max(100, remaining.size))
  const maxPages = 25

  for (let i = 0; i < maxPages && remaining.size > 0; i += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.warn("Failed to list auth users for login timestamps:", error.message)
      break
    }

    const users = (data?.users ?? []) as AuthUserRow[]
    if (users.length === 0) break

    for (const authUser of users) {
      if (!remaining.has(authUser.id)) continue
      output.set(authUser.id, authUser.last_sign_in_at ?? null)
      remaining.delete(authUser.id)
    }

    if (users.length < perPage) break
    const total = typeof data?.total === "number" ? data.total : null
    if (total !== null && page * perPage >= total) break
    page += 1
  }

  // Any unresolved IDs remain null instead of forcing per-user lookups (avoids N+1).
  for (const missing of remaining) {
    output.set(missing, null)
  }

  return output
}

// GET /api/orgs/[orgId]/members - List organization members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
  const { orgId } = await params
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  // Check user is member
  const { data: membership, error: membershipError } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (membershipError) {
    console.error("Failed to verify org membership before listing members:", {
      error: membershipError,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to load organization members" }, { status: 500 })
  }

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 })
  }

  const primaryMembersQuery = await admin
    .from("org_members")
    .select("id, user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })

  let members = primaryMembersQuery.data as OrgMemberRow[] | null
  let membersError = primaryMembersQuery.error

  // Backward compatibility for older org_members schemas without created_at.
  if (membersError && isMissingColumnError(membersError, "created_at")) {
    const fallbackMembersQuery = await admin
      .from("org_members")
      .select("id, user_id, role")
      .eq("org_id", orgId)
      .order("user_id", { ascending: true })
    members = fallbackMembersQuery.data as OrgMemberRow[] | null
    membersError = fallbackMembersQuery.error
  }

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 })
  }

  const memberRows = members ?? []
  if (memberRows.length === 0) {
    return NextResponse.json({ members: [] })
  }

  const userIds = [...new Set(memberRows.map((row) => row.user_id).filter(Boolean))]
  let usersById = new Map<string, UserRow>()
  const lastLoginByUserId = new Map<string, string | null>()
  const userScopedMemoryCounts = new Map<string, number>()
  let workspaceMemoryCount = 0

  if (userIds.length > 0) {
    const { data: users, error: usersError } = await admin
      .from("users")
      .select("id, email, name, avatar_url")
      .in("id", userIds)

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    usersById = new Map((users as UserRow[] | null | undefined)?.map((row) => [row.id, row]) ?? [])

    // Read auth login metadata via paged listUsers (single batched path; avoids per-member N+1).
    const loginMap = await listLastLoginByUserId(admin, userIds)
    for (const [memberUserId, lastLoginAt] of loginMap.entries()) {
      lastLoginByUserId.set(memberUserId, lastLoginAt)
    }
  }

  // Team-level memory metrics come from the org workspace Turso database.
  const { data: orgTursoData } = await admin
    .from("organizations")
    .select("turso_db_url, turso_db_token")
    .eq("id", orgId)
    .single()

  const orgTurso = orgTursoData as OrganizationTursoRow | null
  if (orgTurso?.turso_db_url && orgTurso?.turso_db_token) {
    try {
      const turso = createTurso({
        url: orgTurso.turso_db_url,
        authToken: orgTurso.turso_db_token,
      })

      const workspaceCountResult = await turso
        .execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL")
        .catch(() => turso.execute("SELECT COUNT(*) as count FROM memories"))

      workspaceMemoryCount = Number(workspaceCountResult.rows[0]?.count ?? 0)

      const userCountResult = await turso
        .execute(
          "SELECT user_id, COUNT(*) as count FROM memories WHERE deleted_at IS NULL AND user_id IS NOT NULL GROUP BY user_id"
        )
        .catch(() =>
          turso.execute("SELECT user_id, COUNT(*) as count FROM memories WHERE user_id IS NOT NULL GROUP BY user_id")
        )

      for (const row of userCountResult.rows) {
        const rowUserId = typeof row.user_id === "string" ? row.user_id : null
        if (!rowUserId) continue
        userScopedMemoryCounts.set(rowUserId, Number(row.count ?? 0))
      }
    } catch (error) {
      console.error("Failed to load org member memory stats:", { orgId, error })
    }
  }

  const normalizedMembers = memberRows.map((member) => {
    const foundUser = usersById.get(member.user_id)
    return {
      id: member.id,
      role: member.role,
      joined_at: member.created_at ?? null,
      last_login_at: lastLoginByUserId.get(member.user_id) ?? null,
      memory_count: workspaceMemoryCount,
      user_memory_count: userScopedMemoryCounts.get(member.user_id) ?? 0,
      user: {
        id: foundUser?.id ?? member.user_id,
        email: foundUser?.email ?? `${member.user_id}@unknown.local`,
        name: foundUser?.name ?? null,
        avatar_url: foundUser?.avatar_url ?? null,
      },
    }
  })

  return NextResponse.json({ members: normalizedMembers })
}

// DELETE /api/orgs/[orgId]/members?userId=xxx - Remove member
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
): Promise<Response> {
  const { orgId } = await params
  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get("userId")

  if (!targetUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  // Check current user's role
  const { data: currentMembership, error: currentMembershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (currentMembershipError) {
    console.error("Failed to verify acting membership before removing org member:", {
      error: currentMembershipError,
      orgId,
      actorUserId: user.id,
      targetUserId,
    })
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }

  if (!currentMembership) {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 })
  }

  // Get target user's membership
  const { data: targetMembership, error: targetMembershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .single()

  if (targetMembershipError) {
    console.error("Failed to verify target membership before removing org member:", {
      error: targetMembershipError,
      orgId,
      actorUserId: user.id,
      targetUserId,
    })
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }

  if (!targetMembership) {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 })
  }

  // Can't remove the owner
  if (targetMembership.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the organization owner" }, { status: 400 })
  }

  // Users can remove themselves, or admins/owners can remove others
  const canRemove = 
    targetUserId === user.id || 
    ["owner", "admin"].includes(currentMembership.role)

  if (!canRemove) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  // Get org's subscription to decrement seat
  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_subscription_id")
    .eq("id", orgId)
    .single()

  // Remove the member
  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logOrgAuditEvent({
    client: supabase,
    orgId,
    actorUserId: user.id,
    action: "org_member_removed",
    targetType: "user",
    targetId: targetUserId,
    targetLabel: targetUserId,
    metadata: {
      targetRole: targetMembership.role,
      removedBySelf: targetUserId === user.id,
    },
  })

  // Decrement seat in Stripe
  if (org?.stripe_subscription_id) {
    try {
      const result = await removeTeamSeat({
        stripeSubscriptionId: org.stripe_subscription_id,
      })

      // If subscription was cancelled (last seat), clear it from org
      if (result.action === "cancelled") {
        await supabase
          .from("organizations")
          .update({ stripe_subscription_id: null })
          .eq("id", orgId)
      }
    } catch (e) {
      console.error("Failed to remove team seat from Stripe:", e)
      // Don't fail the request - member was removed, billing can be reconciled
    }
  }

  return NextResponse.json({ success: true })
}

// PATCH /api/orgs/[orgId]/members - Update member role
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

  const parsed = parseBody(updateMemberRoleSchema, await request.json().catch(() => ({})))
  if (!parsed.success) return parsed.response
  const { userId, role } = parsed.data

  // Check current user is owner or admin
  const { data: currentMembership, error: currentMembershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single()

  if (currentMembershipError) {
    console.error("Failed to verify acting membership before updating org member role:", {
      error: currentMembershipError,
      orgId,
      actorUserId: user.id,
      targetUserId: userId,
      targetRole: role,
    })
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 })
  }

  if (!currentMembership || !["owner", "admin"].includes(currentMembership.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  // Can't change owner's role
  const { data: targetMembership, error: targetMembershipError } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single()

  if (targetMembershipError) {
    console.error("Failed to verify target membership before updating org member role:", {
      error: targetMembershipError,
      orgId,
      actorUserId: user.id,
      targetUserId: userId,
      targetRole: role,
    })
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 })
  }

  if (!targetMembership) {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 })
  }

  if (targetMembership.role === "owner") {
    return NextResponse.json({ error: "Cannot change owner's role" }, { status: 400 })
  }

  // Only owner can promote to admin
  if (role === "admin" && currentMembership.role !== "owner") {
    return NextResponse.json({ error: "Only owner can promote to admin" }, { status: 403 })
  }

  const { error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logOrgAuditEvent({
    client: supabase,
    orgId,
    actorUserId: user.id,
    action: "org_member_role_updated",
    targetType: "user",
    targetId: userId,
    targetLabel: userId,
    metadata: {
      previousRole: targetMembership.role,
      nextRole: role,
    },
  })

  return NextResponse.json({ success: true })
}
