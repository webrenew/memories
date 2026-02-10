import type { User } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"

type OrgRole = "owner" | "admin" | "member"

interface UserRow {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  plan: string | null
  turso_db_url: string | null
  turso_db_token: string | null
  turso_db_name: string | null
  current_org_id: string | null
  embedding_model: string | null
  stripe_customer_id: string | null
  mcp_api_key_hash: string | null
  mcp_api_key_prefix: string | null
  mcp_api_key_last4: string | null
  mcp_api_key_created_at: string | null
  mcp_api_key_expires_at: string | null
  created_at: string | null
}

interface OrgMemberRow {
  org_id: string
  user_id: string
  role: OrgRole
  invited_by: string | null
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isPopulated(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function roleRank(role: OrgRole): number {
  if (role === "owner") return 3
  if (role === "admin") return 2
  return 1
}

function strongerRole(a: OrgRole, b: OrgRole): OrgRole {
  return roleRank(a) >= roleRank(b) ? a : b
}

function collectCandidateEmails(user: User): string[] {
  const emails = new Set<string>()

  if (isPopulated(user.email)) {
    emails.add(normalizeEmail(user.email))
  }

  for (const identity of user.identities || []) {
    const identityEmail = identity.identity_data?.email
    if (isPopulated(identityEmail)) {
      emails.add(normalizeEmail(identityEmail))
    }
  }

  return Array.from(emails)
}

function pickFirstValue<T>(current: T | null | undefined, duplicates: Array<T | null | undefined>): T | null {
  if (current !== null && current !== undefined) {
    return current
  }

  for (const value of duplicates) {
    if (value !== null && value !== undefined) {
      return value
    }
  }

  return null
}

function isFreePlan(plan: string | null): boolean {
  return !plan || plan === "free"
}

export async function reconcileUserAccountByEmail(user: User): Promise<void> {
  const candidateEmails = collectCandidateEmails(user)
  if (candidateEmails.length === 0) return

  const admin = createAdminClient()
  const primaryEmail = candidateEmails[0]

  // Ensure the current auth user has a users row even if the auth trigger lagged.
  const { error: ensureRowError } = await admin
    .from("users")
    .upsert({ id: user.id, email: primaryEmail }, { onConflict: "id" })

  if (ensureRowError) {
    console.error("Account reconciliation: failed to ensure user row", ensureRowError)
    return
  }

  const { data: currentRaw, error: currentError } = await admin
    .from("users")
    .select(`
      id,
      email,
      name,
      avatar_url,
      plan,
      turso_db_url,
      turso_db_token,
      turso_db_name,
      current_org_id,
      embedding_model,
      stripe_customer_id,
      mcp_api_key_hash,
      mcp_api_key_prefix,
      mcp_api_key_last4,
      mcp_api_key_created_at,
      mcp_api_key_expires_at,
      created_at
    `)
    .eq("id", user.id)
    .single()

  if (currentError || !currentRaw) {
    console.error("Account reconciliation: failed to load current user row", currentError)
    return
  }

  const current = currentRaw as UserRow
  const duplicatesById = new Map<string, UserRow>()

  for (const email of candidateEmails) {
    const { data: rows, error } = await admin
      .from("users")
      .select(`
        id,
        email,
        name,
        avatar_url,
        plan,
        turso_db_url,
        turso_db_token,
        turso_db_name,
        current_org_id,
        embedding_model,
        stripe_customer_id,
        mcp_api_key_hash,
        mcp_api_key_prefix,
        mcp_api_key_last4,
        mcp_api_key_created_at,
        mcp_api_key_expires_at,
        created_at
      `)
      .ilike("email", email)
      .neq("id", user.id)

    if (error) {
      console.error("Account reconciliation: failed duplicate email lookup", { email, error })
      continue
    }

    for (const row of (rows || []) as UserRow[]) {
      duplicatesById.set(row.id, row)
    }
  }

  const duplicates = Array.from(duplicatesById.values()).sort((a, b) => {
    const aTs = a.created_at ? new Date(a.created_at).getTime() : 0
    const bTs = b.created_at ? new Date(b.created_at).getTime() : 0
    return aTs - bTs
  })

  if (duplicates.length === 0) return

  const updates: Record<string, string | null> = {}
  const duplicateValues = {
    name: duplicates.map((d) => d.name),
    avatar_url: duplicates.map((d) => d.avatar_url),
    turso_db_url: duplicates.map((d) => d.turso_db_url),
    turso_db_token: duplicates.map((d) => d.turso_db_token),
    turso_db_name: duplicates.map((d) => d.turso_db_name),
    current_org_id: duplicates.map((d) => d.current_org_id),
    embedding_model: duplicates.map((d) => d.embedding_model),
  }

  const mergedName = pickFirstValue(current.name, duplicateValues.name)
  if (mergedName !== current.name) updates.name = mergedName

  const mergedAvatar = pickFirstValue(current.avatar_url, duplicateValues.avatar_url)
  if (mergedAvatar !== current.avatar_url) updates.avatar_url = mergedAvatar

  if (isFreePlan(current.plan)) {
    const higherPlan = duplicates.find((d) => !isFreePlan(d.plan))?.plan || null
    if (higherPlan && higherPlan !== current.plan) {
      updates.plan = higherPlan
    }
  }

  const mergedTursoUrl = pickFirstValue(current.turso_db_url, duplicateValues.turso_db_url)
  if (mergedTursoUrl !== current.turso_db_url) updates.turso_db_url = mergedTursoUrl

  const mergedTursoToken = pickFirstValue(current.turso_db_token, duplicateValues.turso_db_token)
  if (mergedTursoToken !== current.turso_db_token) updates.turso_db_token = mergedTursoToken

  const mergedTursoName = pickFirstValue(current.turso_db_name, duplicateValues.turso_db_name)
  if (mergedTursoName !== current.turso_db_name) updates.turso_db_name = mergedTursoName

  const mergedCurrentOrg = pickFirstValue(current.current_org_id, duplicateValues.current_org_id)
  if (mergedCurrentOrg !== current.current_org_id) updates.current_org_id = mergedCurrentOrg

  const mergedEmbeddingModel = pickFirstValue(current.embedding_model, duplicateValues.embedding_model)
  if (mergedEmbeddingModel !== current.embedding_model) updates.embedding_model = mergedEmbeddingModel

  // Move unique user-level billing ownership when the current account does not have one.
  if (!current.stripe_customer_id) {
    const stripeSource = duplicates.find((d) => isPopulated(d.stripe_customer_id))
    if (stripeSource?.stripe_customer_id) {
      const stripeCustomerId = stripeSource.stripe_customer_id

      const { error: clearStripeError } = await admin
        .from("users")
        .update({ stripe_customer_id: null })
        .eq("id", stripeSource.id)
        .eq("stripe_customer_id", stripeCustomerId)

      if (!clearStripeError) {
        updates.stripe_customer_id = stripeCustomerId
      } else {
        console.error("Account reconciliation: failed to move stripe customer ownership", clearStripeError)
      }
    }
  }

  // Move unique MCP API key ownership so existing MCP clients keep working.
  if (!current.mcp_api_key_hash) {
    const mcpSource = duplicates.find((d) => isPopulated(d.mcp_api_key_hash))
    if (mcpSource?.mcp_api_key_hash) {
      const mcpHash = mcpSource.mcp_api_key_hash
      const { error: clearMcpError } = await admin
        .from("users")
        .update({
          mcp_api_key_hash: null,
          mcp_api_key_prefix: null,
          mcp_api_key_last4: null,
          mcp_api_key_created_at: null,
          mcp_api_key_expires_at: null,
        })
        .eq("id", mcpSource.id)
        .eq("mcp_api_key_hash", mcpHash)

      if (!clearMcpError) {
        updates.mcp_api_key_hash = mcpHash
        updates.mcp_api_key_prefix = mcpSource.mcp_api_key_prefix
        updates.mcp_api_key_last4 = mcpSource.mcp_api_key_last4
        updates.mcp_api_key_created_at = mcpSource.mcp_api_key_created_at
        updates.mcp_api_key_expires_at = mcpSource.mcp_api_key_expires_at
      } else {
        console.error("Account reconciliation: failed to move MCP key ownership", clearMcpError)
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await admin
      .from("users")
      .update(updates)
      .eq("id", current.id)

    if (updateError) {
      console.error("Account reconciliation: failed to merge user profile", updateError)
    }
  }

  const duplicateIds = duplicates.map((d) => d.id)
  const { data: currentMembershipRaw, error: currentMembershipError } = await admin
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", current.id)

  if (currentMembershipError) {
    console.error("Account reconciliation: failed to load current org memberships", currentMembershipError)
    return
  }

  const currentMembershipMap = new Map<string, OrgRole>()
  for (const membership of (currentMembershipRaw || []) as Array<{ org_id: string; role: OrgRole }>) {
    currentMembershipMap.set(membership.org_id, membership.role)
  }

  const { data: duplicateMembershipRaw, error: duplicateMembershipError } = await admin
    .from("org_members")
    .select("org_id, user_id, role, invited_by")
    .in("user_id", duplicateIds)

  if (duplicateMembershipError) {
    console.error("Account reconciliation: failed to load duplicate org memberships", duplicateMembershipError)
    return
  }

  for (const membership of (duplicateMembershipRaw || []) as OrgMemberRow[]) {
    const existingRole = currentMembershipMap.get(membership.org_id)

    if (!existingRole) {
      const invitedBy =
        membership.invited_by && duplicateIds.includes(membership.invited_by)
          ? current.id
          : membership.invited_by

      const { error: insertError } = await admin
        .from("org_members")
        .insert({
          org_id: membership.org_id,
          user_id: current.id,
          role: membership.role,
          invited_by: invitedBy,
        })

      if (insertError) {
        // Ignore duplicate race conditions, but surface everything else.
        if (insertError.code !== "23505") {
          console.error("Account reconciliation: failed to copy org membership", insertError)
        }
        continue
      }

      currentMembershipMap.set(membership.org_id, membership.role)
      continue
    }

    const desiredRole = strongerRole(existingRole, membership.role)
    if (desiredRole === existingRole) continue

    const { error: roleUpdateError } = await admin
      .from("org_members")
      .update({ role: desiredRole })
      .eq("org_id", membership.org_id)
      .eq("user_id", current.id)

    if (roleUpdateError) {
      console.error("Account reconciliation: failed to elevate org role", roleUpdateError)
      continue
    }

    currentMembershipMap.set(membership.org_id, desiredRole)
  }
}
