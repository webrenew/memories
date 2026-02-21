import { getAiGatewayApiKey, getAiGatewayBaseUrl, getGraphLlmRelationshipModelId } from "@/lib/env"

export type MemoryRelationshipClassification = "agrees" | "contradicts" | "refines" | "unrelated"

export interface MemoryRelationshipClassificationResult {
  relationship: MemoryRelationshipClassification
  confidence: number
  explanation: string
}

export interface MemoryRelationshipInput {
  id: string
  content: string
  createdAt: string | null
}

export interface ClassifyMemoryRelationshipInput {
  memoryA: MemoryRelationshipInput
  memoryB: MemoryRelationshipInput
  modelId?: string
}

export type SemanticRelationshipEdgeType =
  | "caused_by"
  | "prefers_over"
  | "depends_on"
  | "specializes"
  | "conditional_on"

export interface SemanticRelationshipMemoryInput {
  id: string
  content: string
  createdAt: string | null
}

export interface ExtractSemanticRelationshipsInput {
  newMemory: SemanticRelationshipMemoryInput
  recentMemories: SemanticRelationshipMemoryInput[]
  modelId?: string
}

export interface SemanticRelationshipEdge {
  type: SemanticRelationshipEdgeType
  targetMemoryId?: string | null
  conditionKey?: string | null
  direction: "from_new" | "to_new"
  confidence: number
  evidence: string
}

export interface ExtractSemanticRelationshipsResult {
  edges: SemanticRelationshipEdge[]
}

interface GatewayChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown
    } | null
  }>
}

const VALID_RELATIONSHIPS = new Set<MemoryRelationshipClassification>([
  "agrees",
  "contradicts",
  "refines",
  "unrelated",
])

const VALID_SEMANTIC_EDGE_TYPES = new Set<SemanticRelationshipEdgeType>([
  "caused_by",
  "prefers_over",
  "depends_on",
  "specializes",
  "conditional_on",
])

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function truncateText(value: string, max = 600): string {
  if (value.length <= max) return value
  if (max <= 3) return value.slice(0, max)
  return `${value.slice(0, max - 3)}...`
}

function normalizeContent(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim()
  }

  if (!Array.isArray(value)) {
    return null
  }

  const textParts: string[] = []
  for (const part of value) {
    if (!part || typeof part !== "object") continue
    const text = (part as { text?: unknown }).text
    if (typeof text === "string" && text.trim().length > 0) {
      textParts.push(text.trim())
    }
  }

  if (textParts.length === 0) return null
  return textParts.join("\n")
}

function parseClassificationPayload(payloadText: string): MemoryRelationshipClassificationResult {
  const parsed = JSON.parse(payloadText) as {
    relationship?: unknown
    confidence?: unknown
    explanation?: unknown
  }

  const relationship = typeof parsed.relationship === "string" ? parsed.relationship.trim() : ""
  if (!VALID_RELATIONSHIPS.has(relationship as MemoryRelationshipClassification)) {
    throw new Error(`Invalid relationship classification: ${relationship || "<empty>"}`)
  }

  return {
    relationship: relationship as MemoryRelationshipClassification,
    confidence: clamp01(Number(parsed.confidence)),
    explanation: typeof parsed.explanation === "string" ? parsed.explanation.trim() : "",
  }
}

function parseSemanticRelationshipPayload(
  payloadText: string,
  recentMemories: SemanticRelationshipMemoryInput[]
): ExtractSemanticRelationshipsResult {
  const parsed = JSON.parse(payloadText) as {
    edges?: Array<{
      type?: unknown
      target_memory_index?: unknown
      condition_key?: unknown
      direction?: unknown
      confidence?: unknown
      evidence?: unknown
    }>
  }

  if (!Array.isArray(parsed.edges)) {
    return { edges: [] }
  }

  const edges: SemanticRelationshipEdge[] = []
  for (const candidate of parsed.edges) {
    const type = typeof candidate.type === "string" ? candidate.type.trim() : ""
    if (!VALID_SEMANTIC_EDGE_TYPES.has(type as SemanticRelationshipEdgeType)) {
      continue
    }

    const direction = candidate.direction === "to_new" ? "to_new" : "from_new"
    const confidence = clamp01(Number(candidate.confidence))
    const evidence = typeof candidate.evidence === "string" ? candidate.evidence.trim() : ""

    const rawIndex = Number(candidate.target_memory_index)
    const hasValidIndex = Number.isInteger(rawIndex) && rawIndex >= 1 && rawIndex <= recentMemories.length
    const targetMemoryId = hasValidIndex ? recentMemories[rawIndex - 1]?.id ?? null : null
    const conditionKey = typeof candidate.condition_key === "string" ? candidate.condition_key.trim() : null

    if (type !== "conditional_on" && !targetMemoryId) {
      continue
    }
    if (type === "conditional_on" && !conditionKey) {
      continue
    }

    edges.push({
      type: type as SemanticRelationshipEdgeType,
      targetMemoryId,
      conditionKey,
      direction,
      confidence,
      evidence,
    })
  }

  return { edges }
}

function buildPrompt(input: ClassifyMemoryRelationshipInput): string {
  const dateA = input.memoryA.createdAt ?? "unknown"
  const dateB = input.memoryB.createdAt ?? "unknown"

  return [
    "Given two memories from the same user, classify their relationship.",
    "",
    `Memory A (id: ${input.memoryA.id}, created ${dateA}): "${input.memoryA.content}"`,
    `Memory B (id: ${input.memoryB.id}, created ${dateB}): "${input.memoryB.content}"`,
    "",
    "Classify as one of:",
    "- agrees: Both express compatible information",
    "- contradicts: They conflict or express opposing views on the same topic",
    "- refines: Memory B updates/narrows/corrects Memory A",
    "- unrelated: Despite surface similarity, they're about different things",
    "",
    "Return strict JSON: {\"relationship\":\"...\",\"confidence\":0.0-1.0,\"explanation\":\"...\"}",
  ].join("\n")
}

function buildSemanticExtractionPrompt(input: ExtractSemanticRelationshipsInput): string {
  const numberedRecent = input.recentMemories
    .map((memory, index) => `${index + 1}. [${memory.id}] ${memory.content}`)
    .join("\n")

  return [
    "Analyze this memory and identify relationships to the user's recent memories.",
    "",
    `New memory (${input.newMemory.id}): "${input.newMemory.content}"`,
    "Recent memories (same user/project):",
    numberedRecent || "(none)",
    "",
    "Return strict JSON with an `edges` array.",
    "Each edge must include:",
    "- type: caused_by | prefers_over | depends_on | specializes | conditional_on",
    "- target_memory_index: integer index into the numbered recent memories list (omit for conditional_on)",
    "- condition_key: required for conditional_on (examples: time:morning, season:summer)",
    "- direction: from_new | to_new",
    "- confidence: 0.0-1.0",
    "- evidence: short quote from the new memory",
    "",
    "Only include edges with confidence above 0.6. Return empty array if none.",
  ].join("\n")
}

export async function classifyMemoryRelationship(
  input: ClassifyMemoryRelationshipInput
): Promise<MemoryRelationshipClassificationResult> {
  const apiKey = getAiGatewayApiKey()
  const baseUrl = getAiGatewayBaseUrl().replace(/\/$/, "")
  const modelId = input.modelId?.trim() || getGraphLlmRelationshipModelId()

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You classify pairwise memory relationships. Return only valid JSON matching the provided schema.",
        },
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "memory_relationship_classification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              relationship: {
                type: "string",
                enum: ["agrees", "contradicts", "refines", "unrelated"],
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
              },
              explanation: {
                type: "string",
              },
            },
            required: ["relationship", "confidence", "explanation"],
          },
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `Memory relationship classification failed with status ${response.status}${body ? `: ${truncateText(body, 300)}` : ""}`
    )
  }

  const payload = (await response.json().catch(() => null)) as GatewayChatResponse | null
  if (!payload || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new Error("Memory relationship classification response did not include choices")
  }

  const rawContent = payload.choices[0]?.message?.content
  const content = normalizeContent(rawContent)
  if (!content) {
    throw new Error("Memory relationship classification response did not include parsable content")
  }

  return parseClassificationPayload(content)
}

export async function extractSemanticRelationships(
  input: ExtractSemanticRelationshipsInput
): Promise<ExtractSemanticRelationshipsResult> {
  if (input.recentMemories.length === 0) {
    return { edges: [] }
  }

  const apiKey = getAiGatewayApiKey()
  const baseUrl = getAiGatewayBaseUrl().replace(/\/$/, "")
  const modelId = input.modelId?.trim() || getGraphLlmRelationshipModelId()

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract semantic relationships between memories. Return only JSON matching the schema.",
        },
        {
          role: "user",
          content: buildSemanticExtractionPrompt(input),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "memory_semantic_relationship_extraction",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              edges: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: {
                      type: "string",
                      enum: ["caused_by", "prefers_over", "depends_on", "specializes", "conditional_on"],
                    },
                    target_memory_index: {
                      type: ["integer", "null"],
                    },
                    condition_key: {
                      type: ["string", "null"],
                    },
                    direction: {
                      type: "string",
                      enum: ["from_new", "to_new"],
                    },
                    confidence: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                    },
                    evidence: {
                      type: "string",
                    },
                  },
                  required: ["type", "target_memory_index", "condition_key", "direction", "confidence", "evidence"],
                },
              },
            },
            required: ["edges"],
          },
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `Semantic relationship extraction failed with status ${response.status}${body ? `: ${truncateText(body, 300)}` : ""}`
    )
  }

  const payload = (await response.json().catch(() => null)) as GatewayChatResponse | null
  if (!payload || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new Error("Semantic relationship extraction response did not include choices")
  }

  const rawContent = payload.choices[0]?.message?.content
  const content = normalizeContent(rawContent)
  if (!content) {
    throw new Error("Semantic relationship extraction response did not include parsable content")
  }

  return parseSemanticRelationshipPayload(content, input.recentMemories)
}
