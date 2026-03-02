import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logOrgAuditEvent } from "@/lib/org-audit"
import { removeTeamSeat } from "@/lib/stripe/teams"
import { createClient as createTurso } from "@libsql/client"
import { createHash } from "node:crypto"
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
  user_metadata?: Record<string, unknown> | null
  app_metadata?: Record<string, unknown> | null
  identities?: Array<{ last_sign_in_at?: string | null } | null> | null
}

function normalizeUserIdKey(userId: unknown): string | null {
  if (typeof userId !== "string") return null
  const normalized = userId.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function asTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function extractLastSignInAt(authUser: AuthUserRow): string | null {
  const candidates: Array<unknown> = [
    authUser.last_sign_in_at,
    authUser.user_metadata?.last_sign_in_at,
    authUser.app_metadata?.last_sign_in_at,
  ]

  if (Array.isArray(authUser.identities)) {
    for (const identity of authUser.identities) {
      candidates.push(identity?.last_sign_in_at)
    }
  }

  for (const candidate of candidates) {
    const timestamp = asTimestamp(candidate)
    if (timestamp) return timestamp
  }

  return null
}

function buildGravatarUrl(email: string): string {
  const hash = createHash("md5")
    .update(email.trim().toLowerCase())
    .digest("hex")
  return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=96`
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
  const unresolvedByKey = new Map<string, string>()
  for (const userId of userIds) {
    const key = normalizeUserIdKey(userId)
    if (!key) {
      output.set(userId, null)
      continue
    }
    unresolvedByKey.set(key, userId)
  }
  if (unresolvedByKey.size === 0) return output

  let page = 1
  const perPage = Math.min(1000, Math.max(100, unresolvedByKey.size))
  const maxPages = 25

  for (let i = 0; i < maxPages && unresolvedByKey.size > 0; i += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.warn("Failed to list auth users for login timestamps:", error.message)
      break
    }

    const users = (data?.users ?? []) as AuthUserRow[]
    if (users.length === 0) break

    for (const authUser of users) {
      const key = normalizeUserIdKey(authUser.id)
      if (!key) continue
      const requestedUserId = unresolvedByKey.get(key)
      if (!requestedUserId) continue
      output.set(requestedUserId, extractLastSignInAt(authUser))
      unresolvedByKey.delete(key)
    }

    if (users.length < perPage) break
    const total = typeof data?.total === "number" ? data.total : null
    if (total !== null && page * perPage >= total) break
    page += 1
  }

  // Fallback per-user lookups for unresolved members. This keeps the common path
  // batched while preventing "Never" for members that were outside paged listUsers windows.
  for (const unresolvedUserId of unresolvedByKey.values()) {
    const { data, error } = await admin.auth.admin.getUserById(unresolvedUserId)
    if (error) {
      console.warn("Failed to resolve auth user by id for login timestamp:", {
        userId: unresolvedUserId,
        error: error.message,
      })
      output.set(unresolvedUserId, null)
      continue
    }

    const authUser = (data?.user ?? null) as AuthUserRow | null
    output.set(unresolvedUserId, authUser ? extractLastSignInAt(authUser) : null)
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
    console.error("Failed to load org member rows:", {
      error: membersError,
      orgId,
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to load organization members" }, { status: 500 })
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
      console.error("Failed to load member user profiles:", {
        error: usersError,
        orgId,
        actorUserId: user.id,
        userIds,
      })
      return NextResponse.json({ error: "Failed to load organization members" }, { status: 500 })
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

      const normalizedUserIdSql = "LOWER(TRIM(CAST(user_id AS TEXT)))"
      const userCountResult = await turso
        .execute(
          `SELECT ${normalizedUserIdSql} as user_id, COUNT(*) as count
           FROM memories
           WHERE deleted_at IS NULL
             AND user_id IS NOT NULL
             AND TRIM(CAST(user_id AS TEXT)) <> ''
           GROUP BY ${normalizedUserIdSql}`
        )
        .catch(() =>
          turso.execute(
            `SELECT ${normalizedUserIdSql} as user_id, COUNT(*) as count
             FROM memories
             WHERE user_id IS NOT NULL
               AND TRIM(CAST(user_id AS TEXT)) <> ''
             GROUP BY ${normalizedUserIdSql}`
          )
        )

      for (const row of userCountResult.rows) {
        const rowUserIdKey = normalizeUserIdKey(row.user_id)
        if (!rowUserIdKey) continue
        userScopedMemoryCounts.set(rowUserIdKey, Number(row.count ?? 0))
      }
    } catch (error) {
      console.error("Failed to load org member memory stats:", { orgId, error })
    }
  }

  const normalizedMembers = memberRows.map((member) => {
    const foundUser = usersById.get(member.user_id)
    const memberUserIdKey = normalizeUserIdKey(member.user_id)
    const email = foundUser?.email ?? `${member.user_id}@unknown.local`
    const avatarUrl =
      typeof foundUser?.avatar_url === "string" && foundUser.avatar_url.trim().length > 0
        ? foundUser.avatar_url
        : buildGravatarUrl(email)

    return {
      id: member.id,
      role: member.role,
      joined_at: member.created_at ?? null,
      last_login_at: lastLoginByUserId.get(member.user_id) ?? null,
      memory_count: workspaceMemoryCount,
      user_memory_count: memberUserIdKey ? userScopedMemoryCounts.get(memberUserIdKey) ?? 0 : 0,
      user: {
        id: foundUser?.id ?? member.user_id,
        email,
        name: foundUser?.name ?? null,
        avatar_url: avatarUrl,
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
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimited = await checkRateLimit(apiRateLimit, user.id)
  if (rateLimited) return rateLimited

  const { data: memberRemoveResult, error: memberRemoveError } = await admin.rpc("remove_org_member_atomic", {
    p_org_id: orgId,
    p_actor_user_id: user.id,
    p_target_user_id: targetUserId,
  })

  if (memberRemoveError) {
    if (isMissingFunctionError(memberRemoveError, "remove_org_member_atomic")) {
      return NextResponse.json(
        { error: "Member removal is not available yet. Run the latest database migration first." },
        { status: 503 }
      )
    }

    console.error("Failed to remove org member atomically:", {
      error: memberRemoveError,
      orgId,
      actorUserId: user.id,
      targetUserId,
    })
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }

  const memberRemove =
    typeof memberRemoveResult === "object" && memberRemoveResult !== null
      ? (memberRemoveResult as { status?: string; removed_role?: string | null; removed_by_self?: boolean })
      : null
  const memberRemoveStatus = memberRemove?.status ?? null

  if (memberRemoveStatus === "actor_not_member") {
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 })
  }
  if (memberRemoveStatus === "target_not_member") {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 })
  }
  if (memberRemoveStatus === "target_is_owner") {
    return NextResponse.json({ error: "Cannot remove the organization owner" }, { status: 400 })
  }
  if (memberRemoveStatus === "insufficient_permissions") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }
  if (memberRemoveStatus !== "removed") {
    console.error("Unexpected org member remove result:", {
      orgId,
      actorUserId: user.id,
      targetUserId,
      result: memberRemoveResult,
    })
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 })
  }

  // Get org's subscription to decrement seat after successful member removal.
  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_subscription_id")
    .eq("id", orgId)
    .single()

  await logOrgAuditEvent({
    client: supabase,
    orgId,
    actorUserId: user.id,
    action: "org_member_removed",
    targetType: "user",
    targetId: targetUserId,
    targetLabel: targetUserId,
    metadata: {
      targetRole: memberRemove?.removed_role ?? null,
      removedBySelf: memberRemove?.removed_by_self ?? targetUserId === user.id,
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

  const admin = createAdminClient()
  const { data: roleUpdateResult, error: roleUpdateError } = await admin.rpc("update_org_member_role_atomic", {
    p_org_id: orgId,
    p_actor_user_id: user.id,
    p_target_user_id: userId,
    p_next_role: role,
  })

  if (roleUpdateError) {
    if (isMissingFunctionError(roleUpdateError, "update_org_member_role_atomic")) {
      return NextResponse.json(
        { error: "Member role updates are not available yet. Run the latest database migration first." },
        { status: 503 }
      )
    }

    console.error("Failed to update org member role atomically:", {
      error: roleUpdateError,
      orgId,
      actorUserId: user.id,
      targetUserId: userId,
      targetRole: role,
    })
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 })
  }

  const result =
    typeof roleUpdateResult === "object" && roleUpdateResult !== null
      ? (roleUpdateResult as { status?: string; previous_role?: string | null; updated?: boolean })
      : null
  const resultStatus = result?.status ?? null

  if (resultStatus === "insufficient_permissions") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  if (resultStatus === "target_not_member") {
    return NextResponse.json({ error: "User is not a member" }, { status: 404 })
  }

  if (resultStatus === "target_is_owner") {
    return NextResponse.json({ error: "Cannot change owner's role" }, { status: 400 })
  }

  if (resultStatus === "owner_required") {
    return NextResponse.json({ error: "Only owner can promote to admin" }, { status: 403 })
  }

  if (resultStatus === "invalid_role") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  }

  if (resultStatus !== "updated" && resultStatus !== "unchanged") {
    console.error("Unexpected org member role update result:", {
      orgId,
      actorUserId: user.id,
      targetUserId: userId,
      targetRole: role,
      result: roleUpdateResult,
    })
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 })
  }

  if (resultStatus === "unchanged") {
    return NextResponse.json({ success: true })
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
      previousRole: result?.previous_role ?? null,
      nextRole: role,
    },
  })

  return NextResponse.json({ success: true })
}
