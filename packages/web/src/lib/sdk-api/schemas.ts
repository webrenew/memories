import { z } from "zod"

export const memoryTypeSchema = z.enum(["rule", "decision", "fact", "note", "skill"])
export const memoryLayerSchema = z.enum(["rule", "working", "long_term"])
export const embeddingModelSchema = z.string().trim().min(1).max(160)
export const retrievalStrategySchema = z.enum(["lexical", "semantic", "hybrid", "baseline", "hybrid_graph"])

export type SdkRetrievalStrategy = "lexical" | "semantic" | "hybrid"

export function normalizeRetrievalStrategy(
  strategy: z.infer<typeof retrievalStrategySchema> | undefined
): SdkRetrievalStrategy {
  if (strategy === "hybrid_graph") return "hybrid"
  if (strategy === "baseline") return "lexical"
  if (strategy === "semantic" || strategy === "hybrid" || strategy === "lexical") {
    return strategy
  }
  return "lexical"
}

export function toLegacyContextRetrievalStrategy(strategy: SdkRetrievalStrategy): "baseline" | "hybrid_graph" {
  return strategy === "hybrid" ? "hybrid_graph" : "baseline"
}

export const scopeSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(120).optional(),
    userId: z.string().trim().min(1).max(120).optional(),
    projectId: z.string().trim().min(1).max(240).optional(),
  })
  .optional()
