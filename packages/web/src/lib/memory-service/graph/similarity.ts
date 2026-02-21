import {
  getGraphLlmAmbiguousSimilarityMax,
  getGraphLlmAmbiguousSimilarityMin,
  getGraphLlmRelationshipConfidenceThreshold,
  getGraphLlmSemanticConfidenceThreshold,
  getGraphLlmSemanticContextLimit,
  getGraphLlmSemanticMinChars,
  getSimilarityEdgeMaxK,
  getSimilarityEdgeMaxPerMemory,
  getSimilarityEdgeThreshold,
} from "@/lib/env"
import { cosineSimilarity, decodeEmbeddingBlob } from "../embedding"
import { buildNotExpiredFilter, buildUserScopeFilter } from "../scope"
import type { MemoryLayer, TursoClient } from "../types"
import type { GraphNodeRef } from "./extract"
import { replaceMemoryRelationshipEdges, replaceMemorySimilarityEdges, type GraphEdgeWrite } from "./upsert"

interface SimilarityCandidateRow {
  memory_id: string
  embedding: unknown
  updated_at: string
  created_at: string | null
  content: string | null
}

interface SimilarityMatch {
  memoryId: string
  score: number
  updatedAt: string
  createdAt: string | null
  content: string | null
}

export interface ComputeSimilarityEdgesInput {
  turso: TursoClient
  memoryId: string
  embedding: number[]
  modelId: string
  projectId: string | null
  userId: string | null
  layer: MemoryLayer
  expiresAt: string | null
  nowIso?: string
  threshold?: number
  maxCandidates?: number
  maxEdges?: number
  memoryContent?: string | null
  memoryCreatedAt?: string | null
}

export type MemoryRelationship = "agrees" | "contradicts" | "refines" | "unrelated"

export interface RelationshipClassifierInput {
  memoryA: {
    id: string
    content: string
    createdAt: string | null
  }
  memoryB: {
    id: string
    content: string
    createdAt: string | null
  }
}

export interface RelationshipClassifierResult {
  relationship: MemoryRelationship
  confidence: number
  explanation: string
}

export type RelationshipClassifier = (
  input: RelationshipClassifierInput
) => Promise<RelationshipClassifierResult>

export type SemanticRelationshipEdgeType =
  | "caused_by"
  | "prefers_over"
  | "depends_on"
  | "specializes"
  | "conditional_on"

export interface SemanticRelationshipContextMemory {
  id: string
  content: string
  createdAt: string | null
}

export interface SemanticRelationshipExtractedEdge {
  type: SemanticRelationshipEdgeType
  targetMemoryId?: string | null
  conditionKey?: string | null
  direction: "from_new" | "to_new"
  confidence: number
  evidence: string
}

export interface SemanticRelationshipExtractionResult {
  edges: SemanticRelationshipExtractedEdge[]
}

export type SemanticRelationshipExtractor = (input: {
  newMemory: {
    id: string
    content: string
    createdAt: string | null
  }
  recentMemories: SemanticRelationshipContextMemory[]
}) => Promise<SemanticRelationshipExtractionResult>

export interface ComputeRelationshipEdgesInput extends ComputeSimilarityEdgesInput {
  ambiguousMinScore?: number
  ambiguousMaxScore?: number
  llmConfidenceThreshold?: number
  classifier?: RelationshipClassifier | null
  semanticExtractor?: SemanticRelationshipExtractor | null
  semanticContextLimit?: number
  semanticConfidenceThreshold?: number
  semanticMinChars?: number
}

function memoryNodeRef(memoryId: string): GraphNodeRef {
  return {
    nodeType: "memory",
    nodeKey: memoryId,
  }
}

function isMissingEmbeddingsTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("no such table") && message.includes("memory_embeddings")
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalizeRange(minValue: number, maxValue: number): [number, number] {
  const minScore = normalizeScore(minValue)
  const maxScore = normalizeScore(maxValue)
  return minScore <= maxScore ? [minScore, maxScore] : [maxScore, minScore]
}

function dedupeEdges(edges: GraphEdgeWrite[]): GraphEdgeWrite[] {
  const seen = new Set<string>()
  const deduped: GraphEdgeWrite[] = []
  for (const edge of edges) {
    const key = `${edge.edgeType}:${edge.from.nodeType}:${edge.from.nodeKey}:${edge.to.nodeType}:${edge.to.nodeKey}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(edge)
  }
  return deduped
}

async function selectSimilarityCandidates(input: ComputeSimilarityEdgesInput): Promise<SimilarityMatch[]> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const maxCandidates = Math.max(1, input.maxCandidates ?? getSimilarityEdgeMaxK())
  const userFilter = buildUserScopeFilter(input.userId, "m.")
  const activeFilter = buildNotExpiredFilter(nowIso, "m.")
  const projectFilter = input.projectId
    ? "AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))"
    : "AND m.scope = 'global'"

  const args: (string | number)[] = [input.modelId, input.memoryId]
  if (input.projectId) {
    args.push(input.projectId)
  }
  args.push(...userFilter.args)
  args.push(...activeFilter.args)
  args.push(maxCandidates)

  let resultRows: SimilarityCandidateRow[] = []
  try {
    const result = await input.turso.execute({
      sql: `SELECT m.id AS memory_id,
                   e.embedding,
                   m.updated_at,
                   m.created_at,
                   m.content
            FROM memory_embeddings e
            JOIN memories m ON m.id = e.memory_id
            WHERE e.model = ?
              AND m.id != ?
              AND m.deleted_at IS NULL
              ${projectFilter}
              AND ${userFilter.clause}
              AND ${activeFilter.clause}
            ORDER BY m.updated_at DESC
            LIMIT ?`,
      args,
    })
    resultRows = result.rows as unknown as SimilarityCandidateRow[]
  } catch (error) {
    if (isMissingEmbeddingsTableError(error)) {
      return []
    }
    throw error
  }

  return resultRows
    .map((row) => {
      const decoded = decodeEmbeddingBlob(row.embedding)
      if (!decoded) return null
      const score = cosineSimilarity(input.embedding, decoded)
      if (!Number.isFinite(score)) return null
      return {
        memoryId: row.memory_id,
        score,
        updatedAt: row.updated_at,
        createdAt: row.created_at ?? null,
        content: row.content ?? null,
      }
    })
    .filter((entry): entry is SimilarityMatch => Boolean(entry))
    .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

async function selectRecentMemoryContext(
  input: ComputeRelationshipEdgesInput
): Promise<SemanticRelationshipContextMemory[]> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const limit = Math.max(1, input.semanticContextLimit ?? getGraphLlmSemanticContextLimit())
  const userFilter = buildUserScopeFilter(input.userId, "m.")
  const activeFilter = buildNotExpiredFilter(nowIso, "m.")
  const projectFilter = input.projectId
    ? "AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))"
    : "AND m.scope = 'global'"

  const args: (string | number)[] = [input.memoryId]
  if (input.projectId) {
    args.push(input.projectId)
  }
  args.push(...userFilter.args)
  args.push(...activeFilter.args)
  args.push(limit)

  const result = await input.turso.execute({
    sql: `SELECT m.id, m.content, m.created_at
          FROM memories m
          WHERE m.id != ?
            AND m.deleted_at IS NULL
            ${projectFilter}
            AND ${userFilter.clause}
            AND ${activeFilter.clause}
          ORDER BY m.updated_at DESC
          LIMIT ?`,
    args,
  })

  return (result.rows as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      content: String(row.content ?? "").trim(),
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    }))
    .filter((row) => row.id.length > 0 && row.content.length > 0)
}

function buildBidirectionalMemoryEdges(params: {
  fromMemoryId: string
  toMemoryId: string
  edgeType: string
  weight: number
  confidence: number
  evidenceMemoryId: string
  expiresAt: string | null
}): GraphEdgeWrite[] {
  return [
    {
      from: memoryNodeRef(params.fromMemoryId),
      to: memoryNodeRef(params.toMemoryId),
      edgeType: params.edgeType,
      weight: params.weight,
      confidence: params.confidence,
      evidenceMemoryId: params.evidenceMemoryId,
      expiresAt: params.expiresAt,
    },
    {
      from: memoryNodeRef(params.toMemoryId),
      to: memoryNodeRef(params.fromMemoryId),
      edgeType: params.edgeType,
      weight: params.weight,
      confidence: params.confidence,
      evidenceMemoryId: params.evidenceMemoryId,
      expiresAt: params.expiresAt,
    },
  ]
}

function resolveSupersedesDirection(params: {
  sourceMemoryId: string
  sourceCreatedAt: string | null
  candidateMemoryId: string
  candidateCreatedAt: string | null
}): { fromMemoryId: string; toMemoryId: string } {
  const sourceTs = params.sourceCreatedAt ? Date.parse(params.sourceCreatedAt) : Number.NaN
  const candidateTs = params.candidateCreatedAt ? Date.parse(params.candidateCreatedAt) : Number.NaN
  if (Number.isFinite(sourceTs) && Number.isFinite(candidateTs)) {
    if (sourceTs > candidateTs) {
      return { fromMemoryId: params.sourceMemoryId, toMemoryId: params.candidateMemoryId }
    }
    if (candidateTs > sourceTs) {
      return { fromMemoryId: params.candidateMemoryId, toMemoryId: params.sourceMemoryId }
    }
  }
  return { fromMemoryId: params.sourceMemoryId, toMemoryId: params.candidateMemoryId }
}

function buildSimilarEdges(params: {
  matches: SimilarityMatch[]
  threshold: number
  maxEdges: number
  memoryId: string
  evidenceMemoryId: string
  expiresAt: string | null
}): GraphEdgeWrite[] {
  const edges: GraphEdgeWrite[] = []
  for (const match of params.matches) {
    if (match.score < params.threshold) continue
    if (match.memoryId === params.memoryId) continue
    edges.push(
      ...buildBidirectionalMemoryEdges({
        fromMemoryId: params.memoryId,
        toMemoryId: match.memoryId,
        edgeType: "similar_to",
        weight: match.score,
        confidence: 1,
        evidenceMemoryId: params.evidenceMemoryId,
        expiresAt: params.expiresAt,
      })
    )
    if (edges.length >= params.maxEdges * 2) {
      break
    }
  }
  return edges
}

async function buildLlmRelationshipEdges(
  input: ComputeRelationshipEdgesInput,
  matches: SimilarityMatch[],
  expiresAt: string | null
): Promise<GraphEdgeWrite[]> {
  if (!input.classifier) return []

  const sourceContent = input.memoryContent?.trim()
  if (!sourceContent) return []

  const [ambiguousMin, ambiguousMax] = normalizeRange(
    input.ambiguousMinScore ?? getGraphLlmAmbiguousSimilarityMin(),
    input.ambiguousMaxScore ?? getGraphLlmAmbiguousSimilarityMax()
  )
  const confidenceThreshold = normalizeScore(
    input.llmConfidenceThreshold ?? getGraphLlmRelationshipConfidenceThreshold()
  )

  const edges: GraphEdgeWrite[] = []
  for (const match of matches) {
    if (match.memoryId === input.memoryId) continue
    if (match.score < ambiguousMin || match.score > ambiguousMax) continue
    const candidateContent = match.content?.trim()
    if (!candidateContent) continue

    try {
      const classification = await input.classifier({
        memoryA: {
          id: match.memoryId,
          content: candidateContent,
          createdAt: match.createdAt,
        },
        memoryB: {
          id: input.memoryId,
          content: sourceContent,
          createdAt: input.memoryCreatedAt ?? null,
        },
      })
      const confidence = normalizeScore(classification.confidence)
      if (confidence < confidenceThreshold) continue

      if (classification.relationship === "contradicts") {
        edges.push(
          ...buildBidirectionalMemoryEdges({
            fromMemoryId: input.memoryId,
            toMemoryId: match.memoryId,
            edgeType: "contradicts",
            weight: 1,
            confidence,
            evidenceMemoryId: input.memoryId,
            expiresAt,
          })
        )
      } else if (classification.relationship === "refines") {
        const direction = resolveSupersedesDirection({
          sourceMemoryId: input.memoryId,
          sourceCreatedAt: input.memoryCreatedAt ?? null,
          candidateMemoryId: match.memoryId,
          candidateCreatedAt: match.createdAt,
        })
        edges.push({
          from: memoryNodeRef(direction.fromMemoryId),
          to: memoryNodeRef(direction.toMemoryId),
          edgeType: "supersedes",
          weight: 1,
          confidence,
          evidenceMemoryId: input.memoryId,
          expiresAt,
        })
      }
    } catch (error) {
      console.error("Memory relationship classification failed:", error)
    }
  }

  return edges
}

function normalizeConditionKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

async function buildSemanticRelationshipEdges(
  input: ComputeRelationshipEdgesInput,
  expiresAt: string | null
): Promise<GraphEdgeWrite[]> {
  if (!input.semanticExtractor) return []

  const sourceContent = input.memoryContent?.trim()
  if (!sourceContent) return []
  const minChars = Math.max(1, input.semanticMinChars ?? getGraphLlmSemanticMinChars())
  if (sourceContent.length < minChars) return []

  const semanticContext = await selectRecentMemoryContext(input)
  if (semanticContext.length === 0) return []

  const confidenceThreshold = normalizeScore(
    input.semanticConfidenceThreshold ?? getGraphLlmSemanticConfidenceThreshold()
  )

  try {
    const extraction = await input.semanticExtractor({
      newMemory: {
        id: input.memoryId,
        content: sourceContent,
        createdAt: input.memoryCreatedAt ?? null,
      },
      recentMemories: semanticContext,
    })

    const edges: GraphEdgeWrite[] = []
    for (const extractedEdge of extraction.edges) {
      const confidence = normalizeScore(extractedEdge.confidence)
      if (confidence < confidenceThreshold) continue

      if (extractedEdge.type === "conditional_on") {
        const conditionKey = typeof extractedEdge.conditionKey === "string"
          ? normalizeConditionKey(extractedEdge.conditionKey)
          : ""
        if (!conditionKey) continue

        const conditionRef = {
          nodeType: "condition",
          nodeKey: conditionKey,
        } satisfies GraphNodeRef

        edges.push({
          from: extractedEdge.direction === "to_new" ? conditionRef : memoryNodeRef(input.memoryId),
          to: extractedEdge.direction === "to_new" ? memoryNodeRef(input.memoryId) : conditionRef,
          edgeType: extractedEdge.type,
          weight: 1,
          confidence,
          evidenceMemoryId: input.memoryId,
          expiresAt,
        })
        continue
      }

      const targetMemoryId = extractedEdge.targetMemoryId?.trim()
      if (!targetMemoryId || targetMemoryId === input.memoryId) continue
      const hasTarget = semanticContext.some((entry) => entry.id === targetMemoryId)
      if (!hasTarget) continue

      edges.push({
        from: extractedEdge.direction === "to_new" ? memoryNodeRef(targetMemoryId) : memoryNodeRef(input.memoryId),
        to: extractedEdge.direction === "to_new" ? memoryNodeRef(input.memoryId) : memoryNodeRef(targetMemoryId),
        edgeType: extractedEdge.type,
        weight: 1,
        confidence,
        evidenceMemoryId: input.memoryId,
        expiresAt,
      })
    }

    return edges
  } catch (error) {
    console.error("Semantic relationship extraction failed:", error)
    return []
  }
}

export async function computeSimilarityEdges(input: ComputeSimilarityEdgesInput): Promise<GraphEdgeWrite[]> {
  if (input.embedding.length === 0) return []

  const threshold = normalizeScore(input.threshold ?? getSimilarityEdgeThreshold())
  const maxEdges = Math.max(1, input.maxEdges ?? getSimilarityEdgeMaxPerMemory())
  const expiresAt = input.layer === "working" ? input.expiresAt : null
  const matches = await selectSimilarityCandidates(input)

  return buildSimilarEdges({
    matches,
    threshold,
    maxEdges,
    memoryId: input.memoryId,
    evidenceMemoryId: input.memoryId,
    expiresAt,
  })
}

export async function computeRelationshipEdges(input: ComputeRelationshipEdgesInput): Promise<GraphEdgeWrite[]> {
  if (input.embedding.length === 0) return []

  const threshold = normalizeScore(input.threshold ?? getSimilarityEdgeThreshold())
  const maxEdges = Math.max(1, input.maxEdges ?? getSimilarityEdgeMaxPerMemory())
  const expiresAt = input.layer === "working" ? input.expiresAt : null
  const matches = await selectSimilarityCandidates(input)

  const similarEdges = buildSimilarEdges({
    matches,
    threshold,
    maxEdges,
    memoryId: input.memoryId,
    evidenceMemoryId: input.memoryId,
    expiresAt,
  })
  const llmEdges = await buildLlmRelationshipEdges(input, matches, expiresAt)
  const semanticEdges = await buildSemanticRelationshipEdges(input, expiresAt)

  return dedupeEdges([...similarEdges, ...llmEdges, ...semanticEdges])
}

export async function syncSimilarityEdgesForMemory(input: ComputeSimilarityEdgesInput): Promise<void> {
  const edges = await computeSimilarityEdges(input)
  await replaceMemorySimilarityEdges(input.turso, input.memoryId, edges, { nowIso: input.nowIso })
}

export async function syncRelationshipEdgesForMemory(input: ComputeRelationshipEdgesInput): Promise<void> {
  const edges = await computeRelationshipEdges(input)
  await replaceMemoryRelationshipEdges(input.turso, input.memoryId, edges, {
    nowIso: input.nowIso,
    edgeTypes: [
      "similar_to",
      "contradicts",
      "supersedes",
      "caused_by",
      "prefers_over",
      "depends_on",
      "specializes",
      "conditional_on",
    ],
  })
}
