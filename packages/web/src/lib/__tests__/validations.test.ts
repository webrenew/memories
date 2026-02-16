import { describe, it, expect } from "vitest"
import {
  parseBody,
  createMemorySchema,
  updateMemorySchema,
  deleteMemorySchema,
  cliAuthPollSchema,
  cliAuthApproveSchema,
  createOrgSchema,
  updateOrgSchema,
  createInviteSchema,
  updateMemberRoleSchema,
  acceptInviteSchema,
  checkoutSchema,
  updateUserSchema,
  enterpriseContactSchema,
} from "../validations"

describe("parseBody", () => {
  it("should return parsed data on valid input", () => {
    const result = parseBody(createMemorySchema, { content: "test" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe("test")
      expect(result.data.type).toBe("rule")
      expect(result.data.scope).toBe("global")
    }
  })

  it("should return 400 response on invalid input", () => {
    const result = parseBody(createMemorySchema, { content: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.response.status).toBe(400)
    }
  })

  it("should return first error message", async () => {
    const result = parseBody(createMemorySchema, {})
    expect(result.success).toBe(false)
    if (!result.success) {
      const body = await result.response.json()
      expect(body.error).toBeDefined()
    }
  })
})

describe("createMemorySchema", () => {
  it("should accept valid memory with defaults", () => {
    const result = createMemorySchema.safeParse({ content: "Remember this" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe("Remember this")
      expect(result.data.type).toBe("rule")
      expect(result.data.scope).toBe("global")
    }
  })

  it("should accept all memory types including skill", () => {
    for (const type of ["rule", "decision", "fact", "note", "skill"] as const) {
      const result = createMemorySchema.safeParse({ content: "test", type })
      expect(result.success).toBe(true)
    }
  })

  it("should accept optional fields: project_id, paths, category, metadata", () => {
    const result = createMemorySchema.safeParse({
      content: "test",
      project_id: "github.com/user/repo",
      paths: "src/**/*.ts",
      category: "testing",
      metadata: '{"key":"value"}',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.project_id).toBe("github.com/user/repo")
      expect(result.data.paths).toBe("src/**/*.ts")
      expect(result.data.category).toBe("testing")
      expect(result.data.metadata).toBe('{"key":"value"}')
    }
  })

  it("should accept null optional fields", () => {
    const result = createMemorySchema.safeParse({
      content: "test",
      project_id: null,
      paths: null,
      category: null,
      metadata: null,
    })
    expect(result.success).toBe(true)
  })

  it("should accept both scopes", () => {
    for (const scope of ["global", "project"] as const) {
      const result = createMemorySchema.safeParse({ content: "test", scope })
      expect(result.success).toBe(true)
    }
  })

  it("should accept nullable tags", () => {
    const result = createMemorySchema.safeParse({ content: "test", tags: null })
    expect(result.success).toBe(true)
  })

  it("should accept string tags", () => {
    const result = createMemorySchema.safeParse({ content: "test", tags: "tag1,tag2" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.tags).toBe("tag1,tag2")
  })

  it("should reject empty content", () => {
    const result = createMemorySchema.safeParse({ content: "" })
    expect(result.success).toBe(false)
  })

  it("should reject missing content", () => {
    const result = createMemorySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it("should reject invalid type", () => {
    const result = createMemorySchema.safeParse({ content: "test", type: "invalid" })
    expect(result.success).toBe(false)
  })
})

describe("updateMemorySchema", () => {
  it("should accept valid update", () => {
    const result = updateMemorySchema.safeParse({ id: "abc123", content: "updated" })
    expect(result.success).toBe(true)
  })

  it("should reject empty id", () => {
    const result = updateMemorySchema.safeParse({ id: "", content: "updated" })
    expect(result.success).toBe(false)
  })

  it("should reject empty content when provided", () => {
    const result = updateMemorySchema.safeParse({ id: "abc123", content: "" })
    expect(result.success).toBe(false)
  })

  it("should accept update without content (partial update)", () => {
    const result = updateMemorySchema.safeParse({ id: "abc123", tags: "api,auth" })
    expect(result.success).toBe(true)
  })

  it("should accept optional type, paths, category, metadata", () => {
    const result = updateMemorySchema.safeParse({
      id: "abc123",
      content: "updated",
      type: "skill",
      paths: "src/**/*.ts",
      category: "testing",
      metadata: '{"key":"value"}',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("skill")
      expect(result.data.paths).toBe("src/**/*.ts")
    }
  })
})

describe("deleteMemorySchema", () => {
  it("should accept valid id", () => {
    const result = deleteMemorySchema.safeParse({ id: "abc123" })
    expect(result.success).toBe(true)
  })

  it("should reject empty id", () => {
    const result = deleteMemorySchema.safeParse({ id: "" })
    expect(result.success).toBe(false)
  })
})

describe("cliAuthPollSchema", () => {
  it("should accept valid poll request", () => {
    const code = "a".repeat(32)
    const result = cliAuthPollSchema.safeParse({ action: "poll", code })
    expect(result.success).toBe(true)
  })

  it("should reject non-hex code", () => {
    const result = cliAuthPollSchema.safeParse({ action: "poll", code: "g".repeat(32) })
    expect(result.success).toBe(false)
  })

  it("should reject wrong-length code", () => {
    const result = cliAuthPollSchema.safeParse({ action: "poll", code: "abc" })
    expect(result.success).toBe(false)
  })

  it("should reject wrong action", () => {
    const result = cliAuthPollSchema.safeParse({ action: "approve", code: "a".repeat(32) })
    expect(result.success).toBe(false)
  })
})

describe("cliAuthApproveSchema", () => {
  it("should accept valid approve request", () => {
    const result = cliAuthApproveSchema.safeParse({ action: "approve", code: "b".repeat(32) })
    expect(result.success).toBe(true)
  })

  it("should reject poll action", () => {
    const result = cliAuthApproveSchema.safeParse({ action: "poll", code: "b".repeat(32) })
    expect(result.success).toBe(false)
  })
})

describe("createOrgSchema", () => {
  it("should accept valid org name", () => {
    const result = createOrgSchema.safeParse({ name: "My Team" })
    expect(result.success).toBe(true)
  })

  it("should trim whitespace", () => {
    const result = createOrgSchema.safeParse({ name: "  My Team  " })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe("My Team")
  })

  it("should reject single-char name", () => {
    const result = createOrgSchema.safeParse({ name: "A" })
    expect(result.success).toBe(false)
  })

  it("should reject empty name", () => {
    const result = createOrgSchema.safeParse({ name: "" })
    expect(result.success).toBe(false)
  })
})

describe("updateOrgSchema", () => {
  it("should accept optional name", () => {
    const result = updateOrgSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("should accept valid name", () => {
    const result = updateOrgSchema.safeParse({ name: "Updated" })
    expect(result.success).toBe(true)
  })

  it("should accept domain auto-join settings", () => {
    const result = updateOrgSchema.safeParse({
      domain_auto_join_enabled: true,
      domain_auto_join_domain: "webrenew.io",
    })
    expect(result.success).toBe(true)
  })

  it("should accept clearing domain auto-join domain", () => {
    const result = updateOrgSchema.safeParse({
      domain_auto_join_domain: null,
    })
    expect(result.success).toBe(true)
  })
})

describe("createInviteSchema", () => {
  it("should accept valid email with default role", () => {
    const result = createInviteSchema.safeParse({ email: "test@example.com" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.role).toBe("member")
  })

  it("should accept admin role", () => {
    const result = createInviteSchema.safeParse({ email: "test@example.com", role: "admin" })
    expect(result.success).toBe(true)
  })

  it("should reject invalid email", () => {
    const result = createInviteSchema.safeParse({ email: "not-an-email" })
    expect(result.success).toBe(false)
  })
})

describe("updateMemberRoleSchema", () => {
  it("should accept valid role update", () => {
    const result = updateMemberRoleSchema.safeParse({ userId: "user-1", role: "admin" })
    expect(result.success).toBe(true)
  })

  it("should reject invalid role", () => {
    const result = updateMemberRoleSchema.safeParse({ userId: "user-1", role: "owner" })
    expect(result.success).toBe(false)
  })
})

describe("acceptInviteSchema", () => {
  it("should accept valid invite acceptance", () => {
    const result = acceptInviteSchema.safeParse({ token: "invite-token-123" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.billing).toBe("monthly")
  })

  it("should accept annual billing", () => {
    const result = acceptInviteSchema.safeParse({ token: "abc", billing: "annual" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.billing).toBe("annual")
  })

  it("should reject empty token", () => {
    const result = acceptInviteSchema.safeParse({ token: "" })
    expect(result.success).toBe(false)
  })
})

describe("checkoutSchema", () => {
  it("should accept monthly billing", () => {
    const result = checkoutSchema.safeParse({ billing: "monthly" })
    expect(result.success).toBe(true)
  })

  it("should accept annual billing", () => {
    const result = checkoutSchema.safeParse({ billing: "annual" })
    expect(result.success).toBe(true)
  })

  it("should default to annual on invalid value", () => {
    const result = checkoutSchema.safeParse({ billing: "invalid" })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.billing).toBe("annual")
  })

  it("should accept individual, team, and growth plans", () => {
    for (const plan of ["individual", "team", "growth"] as const) {
      const result = checkoutSchema.safeParse({ billing: "monthly", plan })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.plan).toBe(plan)
    }
  })

  it("should reject unknown plan values", () => {
    const result = checkoutSchema.safeParse({ billing: "monthly", plan: "unknown" })
    expect(result.success).toBe(false)
  })
})

describe("updateUserSchema", () => {
  it("should accept valid name", () => {
    const result = updateUserSchema.safeParse({ name: "John" })
    expect(result.success).toBe(true)
  })

  it("should accept valid embedding model", () => {
    const result = updateUserSchema.safeParse({ embedding_model: "gte-small" })
    expect(result.success).toBe(true)
  })

  it("should accept empty object", () => {
    const result = updateUserSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("should reject invalid embedding model", () => {
    const result = updateUserSchema.safeParse({ embedding_model: "invalid-model" })
    expect(result.success).toBe(false)
  })

  it("should accept valid repo workspace routing mode", () => {
    const result = updateUserSchema.safeParse({ repo_workspace_routing_mode: "active_workspace" })
    expect(result.success).toBe(true)
  })

  it("should reject invalid repo workspace routing mode", () => {
    const result = updateUserSchema.safeParse({ repo_workspace_routing_mode: "invalid-mode" })
    expect(result.success).toBe(false)
  })

  it("should accept valid repo owner org mappings", () => {
    const result = updateUserSchema.safeParse({
      repo_owner_org_mappings: [
        { owner: "WebRenew", org_id: "org-1" },
        { owner: "@acme", org_id: "org-2" },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.repo_owner_org_mappings).toEqual([
        { owner: "webrenew", org_id: "org-1" },
        { owner: "acme", org_id: "org-2" },
      ])
    }
  })

  it("should reject invalid repo owner values", () => {
    const result = updateUserSchema.safeParse({
      repo_owner_org_mappings: [{ owner: "not valid owner", org_id: "org-1" }],
    })
    expect(result.success).toBe(false)
  })

  it("should reject duplicate repo owner mappings", () => {
    const result = updateUserSchema.safeParse({
      repo_owner_org_mappings: [
        { owner: "acme", org_id: "org-1" },
        { owner: "ACME", org_id: "org-2" },
      ],
    })
    expect(result.success).toBe(false)
  })

  it("should reject name over 200 chars", () => {
    const result = updateUserSchema.safeParse({ name: "a".repeat(201) })
    expect(result.success).toBe(false)
  })

  it("should accept all valid embedding models", () => {
    const models = ["all-MiniLM-L6-v2", "gte-small", "gte-base", "gte-large", "mxbai-embed-large-v1"]
    for (const model of models) {
      const result = updateUserSchema.safeParse({ embedding_model: model })
      expect(result.success).toBe(true)
    }
  })
})

describe("enterpriseContactSchema", () => {
  it("should accept valid enterprise contact input", () => {
    const result = enterpriseContactSchema.safeParse({
      name: "Jane Doe",
      workEmail: "jane@example.com",
      company: "Acme Inc",
      teamSize: "15 engineers",
      interest: "both",
      useCase: "We need shared memory across tenants for our AI support product.",
    })
    expect(result.success).toBe(true)
  })

  it("should reject short use cases", () => {
    const result = enterpriseContactSchema.safeParse({
      name: "Jane Doe",
      workEmail: "jane@example.com",
      company: "Acme Inc",
      teamSize: "15 engineers",
      interest: "enterprise",
      useCase: "Too short",
    })
    expect(result.success).toBe(false)
  })

  it("should reject honeypot field when present", () => {
    const result = enterpriseContactSchema.safeParse({
      name: "Jane Doe",
      workEmail: "jane@example.com",
      company: "Acme Inc",
      teamSize: "15 engineers",
      interest: "usage_based",
      useCase: "We expect around 1M calls per month and need usage-based pricing.",
      hp: "spam",
    })
    expect(result.success).toBe(false)
  })
})
