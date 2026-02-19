import { z } from "zod"

export const memoryTypeSchema = z.enum(["rule", "decision", "fact", "note", "skill"])
export const memoryLayerSchema = z.enum(["rule", "working", "long_term"])
export const embeddingModelSchema = z.string().trim().min(1).max(160)

export const scopeSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(120).optional(),
    userId: z.string().trim().min(1).max(120).optional(),
    projectId: z.string().trim().min(1).max(240).optional(),
  })
  .optional()
