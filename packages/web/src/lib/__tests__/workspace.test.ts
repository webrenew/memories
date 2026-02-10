import { describe, expect, it, vi } from "vitest"

const { mockResolveActiveMemoryContext } = vi.hoisted(() => ({
  mockResolveActiveMemoryContext: vi.fn(),
}))

vi.mock("@/lib/active-memory-context", () => ({
  resolveActiveMemoryContext: mockResolveActiveMemoryContext,
}))

import {
  canManageWorkspaceBilling,
  canProvisionWorkspace,
  normalizeWorkspacePlan,
  resolveWorkspaceContext,
} from "@/lib/workspace"

describe("workspace helpers", () => {
  it("normalizes plan values", () => {
    expect(normalizeWorkspacePlan("pro")).toBe("pro")
    expect(normalizeWorkspacePlan("past_due")).toBe("past_due")
    expect(normalizeWorkspacePlan("free")).toBe("free")
    expect(normalizeWorkspacePlan("enterprise")).toBe("free")
    expect(normalizeWorkspacePlan(null)).toBe("free")
  })

  it("enforces provisioning roles", () => {
    expect(canProvisionWorkspace("user", null)).toBe(true)
    expect(canProvisionWorkspace("organization", "owner")).toBe(true)
    expect(canProvisionWorkspace("organization", "admin")).toBe(true)
    expect(canProvisionWorkspace("organization", "member")).toBe(false)
    expect(canProvisionWorkspace("organization", null)).toBe(false)
  })

  it("enforces billing roles", () => {
    expect(canManageWorkspaceBilling("user", null)).toBe(true)
    expect(canManageWorkspaceBilling("organization", "owner")).toBe(true)
    expect(canManageWorkspaceBilling("organization", "admin")).toBe(false)
    expect(canManageWorkspaceBilling("organization", "member")).toBe(false)
    expect(canManageWorkspaceBilling("organization", null)).toBe(false)
  })

  it("maps active context into workspace context", async () => {
    mockResolveActiveMemoryContext.mockResolvedValue({
      ownerType: "organization",
      userId: "user-1",
      orgId: "org-1",
      orgRole: "admin",
      plan: "enterprise",
      turso_db_url: "libsql://org.turso.io",
      turso_db_token: "token",
      turso_db_name: "org-db",
    })

    const workspace = await resolveWorkspaceContext({}, "user-1")

    expect(workspace).toMatchObject({
      ownerType: "organization",
      orgId: "org-1",
      orgRole: "admin",
      plan: "free",
      hasDatabase: true,
      canProvision: true,
      canManageBilling: false,
    })
  })
})
