import { describe, expect, it } from "vitest"

import { resolveActiveMemoryContext } from "@/lib/active-memory-context"

interface Fixtures {
  user: {
    id: string
    current_org_id: string | null
    plan: string | null
    turso_db_url: string | null
    turso_db_token: string | null
    turso_db_name: string | null
    repo_workspace_routing_mode?: "auto" | "active_workspace" | null
    repo_owner_org_mappings?: Array<{ owner: string; org_id: string }> | null
  } | null
  membership: { role: "owner" | "admin" | "member" } | null
  membershipsByOrgId?: Record<string, { role: "owner" | "admin" | "member" }>
  organization: {
    id: string
    slug: string | null
    plan: string | null
    subscription_status: "active" | "past_due" | "cancelled" | null
    stripe_subscription_id: string | null
    turso_db_url: string | null
    turso_db_token: string | null
    turso_db_name: string | null
  } | null
  organizationBySlug?: {
    id: string
    slug: string | null
    plan: string | null
    subscription_status: "active" | "past_due" | "cancelled" | null
    stripe_subscription_id: string | null
    turso_db_url: string | null
    turso_db_token: string | null
    turso_db_name: string | null
  } | null
}

function makeClient(fixtures: Fixtures) {
  function buildQuery(table: string, filters: Record<string, string> = {}) {
    return {
      eq(column: string, value: string) {
        return buildQuery(table, { ...filters, [column]: value })
      },
      async single() {
        if (table === "users" && filters.id) {
          return { data: fixtures.user, error: fixtures.user ? null : { message: "not found" } }
        }

        if (
          table === "org_members" &&
          filters.org_id &&
          filters.user_id
        ) {
          const membershipByOrg = fixtures.membershipsByOrgId?.[filters.org_id]
          if (membershipByOrg) {
            return { data: membershipByOrg, error: null }
          }
          if (fixtures.membership) {
            return { data: fixtures.membership, error: null }
          }
        }

        if (table === "organizations" && filters.slug) {
          return {
            data: fixtures.organizationBySlug ?? null,
            error: fixtures.organizationBySlug ? null : { message: "not found" },
          }
        }

        if (table === "organizations" && filters.id) {
          return {
            data: fixtures.organization,
            error: fixtures.organization ? null : { message: "not found" },
          }
        }

        return { data: null, error: { message: "not found" } }
      },
    }
  }

  return {
    from(table: string) {
      return {
        select() {
          return buildQuery(table)
        },
      }
    },
  }
}

describe("resolveActiveMemoryContext", () => {
  it("returns user context when no current_org_id is set", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: null,
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
      },
      membership: null,
      organization: null,
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1")

    expect(context?.ownerType).toBe("user")
    expect(context?.turso_db_url).toBe("libsql://user.turso.io")
  })

  it("returns org context when current org membership is valid", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: "org-1",
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
      },
      membership: { role: "member" },
      organization: {
        id: "org-1",
        slug: "webrenew",
        plan: "pro",
        subscription_status: "active",
        stripe_subscription_id: "sub_123",
        turso_db_url: "libsql://org.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1")

    expect(context?.ownerType).toBe("organization")
    expect(context?.orgId).toBe("org-1")
    expect(context?.turso_db_url).toBe("libsql://org.turso.io")
    expect(context?.plan).toBe("team")
  })

  it("keeps org context without creds by default", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: "org-1",
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
      },
      membership: { role: "owner" },
      organization: {
        id: "org-1",
        slug: "webrenew",
        plan: "pro",
        subscription_status: "active",
        stripe_subscription_id: null,
        turso_db_url: null,
        turso_db_token: null,
        turso_db_name: null,
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1")

    expect(context?.ownerType).toBe("organization")
    expect(context?.turso_db_url).toBeNull()
  })

  it("falls back to user when requested and org creds are missing", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: "org-1",
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
      },
      membership: { role: "owner" },
      organization: {
        id: "org-1",
        slug: "webrenew",
        plan: "pro",
        subscription_status: "active",
        stripe_subscription_id: null,
        turso_db_url: null,
        turso_db_token: null,
        turso_db_name: null,
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1", {
      fallbackToUserWithoutOrgCredentials: true,
    })

    expect(context?.ownerType).toBe("user")
    expect(context?.turso_db_url).toBe("libsql://user.turso.io")
  })

  it("maps org past_due subscription status to past_due plan", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: "org-1",
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
      },
      membership: { role: "owner" },
      organization: {
        id: "org-1",
        slug: "webrenew",
        plan: "pro",
        subscription_status: "past_due",
        stripe_subscription_id: "sub_123",
        turso_db_url: "libsql://org.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1")
    expect(context?.plan).toBe("past_due")
  })

  it("maps cancelled org subscription status to free plan", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: "org-1",
        plan: "pro",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
      },
      membership: { role: "owner" },
      organization: {
        id: "org-1",
        slug: "webrenew",
        plan: "pro",
        subscription_status: "cancelled",
        stripe_subscription_id: null,
        turso_db_url: "libsql://org.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1")
    expect(context?.plan).toBe("free")
  })

  it("routes repo-scoped requests to matching org workspace in auto mode", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: null,
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
        repo_workspace_routing_mode: "auto",
      },
      membership: { role: "admin" },
      organization: null,
      organizationBySlug: {
        id: "org-webrenew",
        slug: "webrenew",
        plan: "team",
        subscription_status: "active",
        stripe_subscription_id: "sub_123",
        turso_db_url: "libsql://org-webrenew.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
    })

    const context = await resolveActiveMemoryContext(client, "user-1", {
      projectId: "github.com/webrenew/memories",
    })

    expect(context?.ownerType).toBe("organization")
    expect(context?.orgId).toBe("org-webrenew")
    expect(context?.turso_db_url).toBe("libsql://org-webrenew.turso.io")
  })

  it("routes repo-scoped requests using explicit owner mappings in auto mode", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: null,
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
        repo_workspace_routing_mode: "auto",
        repo_owner_org_mappings: [{ owner: "acme-platform", org_id: "org-webrenew" }],
      },
      membership: null,
      membershipsByOrgId: {
        "org-webrenew": { role: "admin" },
      },
      organization: {
        id: "org-webrenew",
        slug: "webrenew",
        plan: "team",
        subscription_status: "active",
        stripe_subscription_id: "sub_123",
        turso_db_url: "libsql://org-webrenew.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1", {
      projectId: "github.com/acme-platform/memories",
    })

    expect(context?.ownerType).toBe("organization")
    expect(context?.orgId).toBe("org-webrenew")
    expect(context?.turso_db_url).toBe("libsql://org-webrenew.turso.io")
  })

  it("falls back to slug routing when explicit owner mapping is invalid", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: null,
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
        repo_workspace_routing_mode: "auto",
        repo_owner_org_mappings: [{ owner: "webrenew", org_id: "org-missing" }],
      },
      membership: { role: "admin" },
      organization: null,
      organizationBySlug: {
        id: "org-webrenew",
        slug: "webrenew",
        plan: "team",
        subscription_status: "active",
        stripe_subscription_id: "sub_123",
        turso_db_url: "libsql://org-webrenew.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
    })

    const context = await resolveActiveMemoryContext(client, "user-1", {
      projectId: "github.com/webrenew/memories",
    })

    expect(context?.ownerType).toBe("organization")
    expect(context?.orgId).toBe("org-webrenew")
  })

  it("routes non-org repo scopes to personal workspace in auto mode", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: "org-webrenew",
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
        repo_workspace_routing_mode: "auto",
      },
      membership: null,
      organization: {
        id: "org-webrenew",
        slug: "webrenew",
        plan: "team",
        subscription_status: "active",
        stripe_subscription_id: "sub_123",
        turso_db_url: "libsql://org-webrenew.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1", {
      projectId: "github.com/personal/repo",
    })

    expect(context?.ownerType).toBe("user")
    expect(context?.orgId).toBeNull()
    expect(context?.turso_db_url).toBe("libsql://user.turso.io")
  })

  it("uses active workspace when routing mode override is active_workspace", async () => {
    const client = makeClient({
      user: {
        id: "user-1",
        current_org_id: "org-webrenew",
        plan: "free",
        turso_db_url: "libsql://user.turso.io",
        turso_db_token: "user-token",
        turso_db_name: "user-db",
        repo_workspace_routing_mode: "active_workspace",
      },
      membership: { role: "owner" },
      organization: {
        id: "org-webrenew",
        slug: "webrenew",
        plan: "pro",
        subscription_status: "active",
        stripe_subscription_id: "sub_123",
        turso_db_url: "libsql://org-webrenew.turso.io",
        turso_db_token: "org-token",
        turso_db_name: "org-db",
      },
      organizationBySlug: null,
    })

    const context = await resolveActiveMemoryContext(client, "user-1", {
      projectId: "github.com/personal/repo",
    })

    expect(context?.ownerType).toBe("organization")
    expect(context?.orgId).toBe("org-webrenew")
  })
})
