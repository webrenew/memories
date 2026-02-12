import { createAdminClient } from "@/lib/supabase/admin"
import { addTeamSeat } from "@/lib/stripe/teams"
import { getUniqueEmailDomains } from "@/lib/org-domain"

interface AutoJoinInput {
  userId: string
  emails: string[]
}

interface AuthIdentityLike {
  identity_data?: {
    email?: unknown
  } | null
}

interface AuthUserLike {
  email?: string | null
  identities?: AuthIdentityLike[] | null
}

interface AutoJoinOrganizationRow {
  id: string
  owner_id: string | null
  domain_auto_join_domain: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

function normalizeEmails(emails: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const raw of emails) {
    const email = raw.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    normalized.push(email)
  }

  return normalized
}

function isDuplicateMembershipError(error: unknown): boolean {
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

export function extractUserEmails(user: AuthUserLike): string[] {
  const emails: string[] = []

  if (typeof user.email === "string" && user.email.trim()) {
    emails.push(user.email)
  }

  if (Array.isArray(user.identities)) {
    for (const identity of user.identities) {
      const identityEmail = identity.identity_data?.email
      if (typeof identityEmail === "string" && identityEmail.trim()) {
        emails.push(identityEmail)
      }
    }
  }

  return normalizeEmails(emails)
}

export async function autoJoinOrganizationsForEmails(input: AutoJoinInput): Promise<void> {
  const emails = normalizeEmails(input.emails)
  if (emails.length === 0) return

  const domains = getUniqueEmailDomains(emails)
  if (domains.length === 0) return

  const admin = createAdminClient()
  const { data: organizations, error: orgError } = await admin
    .from("organizations")
    .select("id, owner_id, domain_auto_join_domain, stripe_customer_id, stripe_subscription_id")
    .eq("domain_auto_join_enabled", true)
    .in("domain_auto_join_domain", domains)

  if (orgError) {
    console.error("Domain auto-join org lookup failed:", orgError)
    return
  }

  const candidates = (organizations ?? []) as AutoJoinOrganizationRow[]
  if (candidates.length === 0) return

  const candidateOrgIds = candidates.map((org) => org.id)
  const { data: existingMemberships, error: membershipReadError } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", input.userId)
    .in("org_id", candidateOrgIds)

  if (membershipReadError) {
    console.error("Domain auto-join membership lookup failed:", membershipReadError)
    return
  }

  const existingOrgIds = new Set((existingMemberships ?? []).map((row) => row.org_id as string))
  const joinedOrgIds: string[] = []
  const nowIso = new Date().toISOString()

  for (const org of candidates) {
    if (existingOrgIds.has(org.id)) continue

    const { error: insertError } = await admin.from("org_members").insert({
      org_id: org.id,
      user_id: input.userId,
      role: "member",
      invited_by: org.owner_id,
    })

    if (insertError) {
      if (isDuplicateMembershipError(insertError)) continue
      console.error("Domain auto-join insert failed:", {
        orgId: org.id,
        userId: input.userId,
        error: insertError,
      })
      continue
    }

    joinedOrgIds.push(org.id)

    await admin
      .from("org_invites")
      .update({ accepted_at: nowIso })
      .eq("org_id", org.id)
      .in("email", emails)
      .is("accepted_at", null)
      .gt("expires_at", nowIso)

    try {
      const result = await addTeamSeat({
        orgId: org.id,
        stripeCustomerId: org.stripe_customer_id,
        stripeSubscriptionId: org.stripe_subscription_id,
        billing: "monthly",
      })

      if (result.action === "created") {
        await admin
          .from("organizations")
          .update({ stripe_subscription_id: result.subscriptionId })
          .eq("id", org.id)
      }
    } catch (billingError) {
      console.error("Domain auto-join billing seat update failed:", {
        orgId: org.id,
        error: billingError instanceof Error ? billingError.message : String(billingError),
      })
    }
  }

  if (joinedOrgIds.length === 0) return

  await admin
    .from("users")
    .update({ current_org_id: joinedOrgIds[0] })
    .eq("id", input.userId)
    .is("current_org_id", null)
}
