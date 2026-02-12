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

export const memoryTypeEnum = z.enum(["rule", "decision", "fact", "note", "skill"])
export const memoryScopeEnum = z.enum(["global", "project"])

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
})

// --- User Profile ---

const VALID_EMBEDDING_MODELS = [
  "all-MiniLM-L6-v2",
  "gte-small",
  "gte-base",
  "gte-large",
  "mxbai-embed-large-v1",
] as const

export const updateUserSchema = z.object({
  name: z.string().max(200).optional(),
  embedding_model: z.enum(VALID_EMBEDDING_MODELS).optional(),
  current_org_id: z.string().min(1, "Organization id is required").nullable().optional(),
  repo_workspace_routing_mode: z.enum(["auto", "active_workspace"]).optional(),
})

// --- GitHub Capture Queue ---

export const githubCaptureDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
})
