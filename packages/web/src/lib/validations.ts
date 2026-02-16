import { z } from "zod"
import { NextResponse } from "next/server"

/**
 * Parse request body against a Zod schema.
 * Returns parsed data on success, or a 400 NextResponse on failure.
 */
export function parseBody<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; response: NextResponse } {
  const result = schema.safeParse(data)
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid input"
    return {
      success: false,
      response: NextResponse.json({ error: message }, { status: 400 }),
    }
  }
  return { success: true, data: result.data }
}

// --- Memories ---

const memoryTypeEnum = z.enum(["rule", "decision", "fact", "note", "skill"])
const memoryScopeEnum = z.enum(["global", "project"])

export const createMemorySchema = z.object({
  content: z.string().min(1, "Content required"),
  type: memoryTypeEnum.default("rule"),
  scope: memoryScopeEnum.default("global"),
  tags: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  paths: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(),
})

export const updateMemorySchema = z.object({
  id: z.string().min(1, "Memory ID required"),
  content: z.string().min(1, "Content required").optional(),
  tags: z.string().nullable().optional(),
  type: memoryTypeEnum.optional(),
  paths: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(),
})

export const deleteMemorySchema = z.object({
  id: z.string().min(1, "Memory ID required"),
})

// --- CLI Auth ---

export const cliAuthPollSchema = z.object({
  action: z.literal("poll"),
  code: z.string().regex(/^[a-f0-9]{32}$/, "Invalid code"),
})

export const cliAuthApproveSchema = z.object({
  action: z.literal("approve"),
  code: z.string().regex(/^[a-f0-9]{32}$/, "Invalid code"),
})

// --- Organizations ---

export const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Organization name must be at least 2 characters"),
})

export const updateOrgSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  domain_auto_join_enabled: z.boolean().optional(),
  domain_auto_join_domain: z.string().trim().min(1, "Domain is required").nullable().optional(),
})

// --- Invites ---

export const createInviteSchema = z.object({
  email: z.string().email("Valid email is required"),
  role: z.enum(["admin", "member"]).default("member"),
})

// --- Members ---

export const updateMemberRoleSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role: z.enum(["admin", "member"]),
})

// --- Accept Invite ---

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Token is required"),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
})

// --- Stripe Checkout ---

export const checkoutSchema = z.object({
  billing: z.enum(["monthly", "annual"]).catch("annual"),
  plan: z.enum(["individual", "team", "growth"]).optional(),
})

// --- User Profile ---

const VALID_EMBEDDING_MODELS = [
  "all-MiniLM-L6-v2",
  "gte-small",
  "gte-base",
  "gte-large",
  "mxbai-embed-large-v1",
] as const

const GITHUB_OWNER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i

const repoOwnerOrgMappingSchema = z.object({
  owner: z
    .string()
    .trim()
    .min(1, "GitHub owner is required")
    .max(100, "GitHub owner is too long")
    .transform((value) => value.replace(/^@/, "").toLowerCase())
    .refine((value) => GITHUB_OWNER_PATTERN.test(value), {
      message: "Use a valid GitHub owner (for example: acme)",
    }),
  org_id: z.string().trim().min(1, "Organization id is required"),
})

const repoOwnerOrgMappingsSchema = z
  .array(repoOwnerOrgMappingSchema)
  .max(50, "Add at most 50 repo owner mappings")
  .superRefine((mappings, ctx) => {
    const seenOwners = new Set<string>()
    for (let index = 0; index < mappings.length; index += 1) {
      const owner = mappings[index]?.owner
      if (!owner) continue
      if (seenOwners.has(owner)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each GitHub owner can only be mapped once",
          path: [index, "owner"],
        })
      } else {
        seenOwners.add(owner)
      }
    }
  })

export const updateUserSchema = z.object({
  name: z.string().max(200).optional(),
  embedding_model: z.enum(VALID_EMBEDDING_MODELS).optional(),
  current_org_id: z.string().min(1, "Organization id is required").nullable().optional(),
  repo_workspace_routing_mode: z.enum(["auto", "active_workspace"]).optional(),
  repo_owner_org_mappings: repoOwnerOrgMappingsSchema.optional(),
})

export const workspaceSwitchProfileSchema = z.object({
  from_org_id: z.string().min(1).nullable().optional(),
  to_org_id: z.string().min(1).nullable().optional(),
  success: z.boolean(),
  error_code: z.string().trim().max(80).nullable().optional(),
  client_total_ms: z.number().min(0).max(60_000).optional(),
  user_patch_ms: z.number().min(0).max(60_000).optional(),
  workspace_prefetch_ms: z.number().min(0).max(60_000).optional(),
  integration_health_prefetch_ms: z.number().min(0).max(60_000).optional(),
  workspace_summary_total_ms: z.number().min(0).max(60_000).optional(),
  workspace_summary_query_ms: z.number().min(0).max(60_000).optional(),
  workspace_summary_org_count: z.number().int().min(0).max(100_000).optional(),
  workspace_summary_workspace_count: z.number().int().min(0).max(100_000).optional(),
  workspace_summary_response_bytes: z.number().int().min(0).max(20_000_000).optional(),
  include_summaries: z.boolean().optional(),
  cache_mode: z.enum(["force-cache", "default", "no-store"]).optional(),
  source: z.string().trim().max(50).optional(),
})

// --- GitHub Capture Queue ---

export const githubCaptureDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
})

export const updateGithubCaptureSettingsSchema = z.object({
  allowed_events: z.array(z.string()).optional(),
  repo_allow_list: z.array(z.string()).optional(),
  repo_block_list: z.array(z.string()).optional(),
  branch_filters: z.array(z.string()).optional(),
  label_filters: z.array(z.string()).optional(),
  actor_filters: z.array(z.string()).optional(),
  include_prerelease: z.boolean().optional(),
})

export const applyMemoryInsightActionSchema = z.object({
  kind: z.enum(["archive", "merge", "relabel"]),
  memoryIds: z.array(z.string().trim().min(1, "Memory id is required")).min(1, "Select at least one memory"),
  proposedTags: z.array(z.string().trim().min(1)).max(20).optional(),
})

// --- Enterprise Contact ---

export const enterpriseContactSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120, "Name is too long"),
  workEmail: z.string().trim().email("Valid work email is required").max(320, "Email is too long"),
  company: z.string().trim().min(2, "Company is required").max(160, "Company name is too long"),
  teamSize: z.string().trim().min(1, "Team size is required").max(40, "Team size is too long"),
  interest: z.enum(["enterprise", "usage_based", "both"]).default("both"),
  useCase: z.string().trim().min(20, "Please share at least 20 characters").max(4000, "Use case is too long"),
  hp: z.string().max(0).optional(),
})
