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
