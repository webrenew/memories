import { z } from "zod"

export const baseUrlSchema = z.string().url()

export const apiErrorSchema = z.object({
  type: z.string(),
  code: z.string(),
  message: z.string(),
  status: z.number().int().optional(),
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
})

export const responseEnvelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().nullable(),
  error: apiErrorSchema.nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

export const legacyHttpErrorSchema = z.object({
  error: z.union([z.string(), apiErrorSchema]).optional(),
  errorDetail: apiErrorSchema.optional(),
  message: z.string().optional(),
})

export const structuredMemorySchema = z.object({
  id: z.string().nullable().optional(),
  content: z.string(),
  type: z.string(),
  layer: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  scope: z.string(),
  projectId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
  graph: z
    .object({
      whyIncluded: z.literal("graph_expansion"),
      linkedViaNode: z.string(),
      edgeType: z.string(),
      hopCount: z.number().int().nonnegative(),
      seedMemoryId: z.string(),
    })
    .nullable()
    .optional(),
})

export const structuredSkillFileSchema = z.object({
  id: z.string(),
  path: z.string(),
  content: z.string(),
  scope: z.string(),
  projectId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const contextStructuredSchema = z.object({
  rules: z.array(structuredMemorySchema).optional().default([]),
  memories: z.array(structuredMemorySchema).optional().default([]),
  skillFiles: z.array(structuredSkillFileSchema).optional().default([]),
  workingMemories: z.array(structuredMemorySchema).optional().default([]),
  longTermMemories: z.array(structuredMemorySchema).optional().default([]),
  trace: z
    .object({
      requestedStrategy: z.union([z.literal("baseline"), z.literal("hybrid_graph")]).optional(),
      strategy: z.union([z.literal("baseline"), z.literal("hybrid_graph")]),
      graphDepth: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      graphLimit: z.number().int().nonnegative(),
      rolloutMode: z.union([z.literal("off"), z.literal("shadow"), z.literal("canary")]).optional(),
      shadowExecuted: z.boolean().optional(),
      baselineCandidates: z.number().int().nonnegative(),
      graphCandidates: z.number().int().nonnegative(),
      graphExpandedCount: z.number().int().nonnegative(),
      fallbackTriggered: z.boolean().optional(),
      fallbackReason: z.string().nullable().optional(),
      totalCandidates: z.number().int().nonnegative(),
    })
    .optional(),
})

export const memoriesStructuredSchema = z.object({
  memories: z.array(structuredMemorySchema).optional().default([]),
})

export const skillFilesStructuredSchema = z.object({
  skillFiles: z.array(structuredSkillFileSchema).optional().default([]),
  count: z.number().int().nonnegative().optional(),
})

export const mutationEnvelopeDataSchema = z.object({
  message: z.string().optional(),
})

export const bulkForgetResultSchema = z.object({
  count: z.number().int().nonnegative(),
  ids: z.array(z.string()).optional(),
  memories: z.array(z.object({
    id: z.string(),
    type: z.string(),
    contentPreview: z.string(),
  })).optional(),
  message: z.string(),
})

export const vacuumResultSchema = z.object({
  purged: z.number().int().nonnegative(),
  message: z.string(),
})

export const managementKeyStatusSchema = z.object({
  hasKey: z.boolean(),
  keyPreview: z.string().optional(),
  createdAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  isExpired: z.boolean().optional(),
})

export const managementKeyCreateSchema = z.object({
  apiKey: z.string(),
  keyPreview: z.string().optional(),
  createdAt: z.string().optional(),
  expiresAt: z.string().optional(),
  message: z.string().optional(),
})

export const managementKeyRevokeSchema = z.object({
  ok: z.boolean(),
})

export const managementTenantSchema = z.object({
  tenantId: z.string(),
  tursoDbUrl: z.string(),
  tursoDbName: z.string().nullable().optional(),
  status: z.string(),
  source: z.union([z.literal("auto"), z.literal("override")]).default("override"),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastVerifiedAt: z.string().nullable().optional(),
})

export const managementTenantListSchema = z.object({
  tenantDatabases: z.array(managementTenantSchema),
  count: z.number().int(),
})

export const managementTenantUpsertSchema = z.object({
  tenantDatabase: managementTenantSchema,
  provisioned: z.boolean(),
  mode: z.string(),
})

export const managementTenantDisableSchema = z.object({
  ok: z.boolean(),
  tenantId: z.string(),
  status: z.string(),
  updatedAt: z.string(),
})
