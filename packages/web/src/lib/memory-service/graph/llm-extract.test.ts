import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { classifyMemoryRelationship, extractSemanticRelationships } from "./llm-extract"

const originalAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY
const originalAiGatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL
const originalModelId = process.env.GRAPH_LLM_RELATIONSHIP_MODEL_ID

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "test_gateway_key"
  process.env.AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
  process.env.GRAPH_LLM_RELATIONSHIP_MODEL_ID = "anthropic/claude-3-5-haiku-latest"
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalAiGatewayApiKey === undefined) {
    delete process.env.AI_GATEWAY_API_KEY
  } else {
    process.env.AI_GATEWAY_API_KEY = originalAiGatewayApiKey
  }
  if (originalAiGatewayBaseUrl === undefined) {
    delete process.env.AI_GATEWAY_BASE_URL
  } else {
    process.env.AI_GATEWAY_BASE_URL = originalAiGatewayBaseUrl
  }
  if (originalModelId === undefined) {
    delete process.env.GRAPH_LLM_RELATIONSHIP_MODEL_ID
  } else {
    process.env.GRAPH_LLM_RELATIONSHIP_MODEL_ID = originalModelId
  }
})

describe("classifyMemoryRelationship", () => {
  it("parses JSON content responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    relationship: "contradicts",
                    confidence: 0.86,
                    explanation: "Both memories discuss the same preference with opposite polarity.",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    )

    const result = await classifyMemoryRelationship({
      memoryA: { id: "mem-a", content: "I love spicy food.", createdAt: "2026-02-20T00:00:00.000Z" },
      memoryB: { id: "mem-b", content: "I dislike spicy food.", createdAt: "2026-02-21T00:00:00.000Z" },
    })

    expect(result).toEqual({
      relationship: "contradicts",
      confidence: 0.86,
      explanation: "Both memories discuss the same preference with opposite polarity.",
    })
  })

  it("parses array-based content payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        relationship: "refines",
                        confidence: 0.91,
                        explanation: "Memory B narrows scope with more recent detail.",
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    )

    const result = await classifyMemoryRelationship({
      memoryA: { id: "mem-a", content: "I like coffee.", createdAt: "2026-02-19T00:00:00.000Z" },
      memoryB: { id: "mem-b", content: "I only drink coffee in the morning.", createdAt: "2026-02-21T00:00:00.000Z" },
    })

    expect(result.relationship).toBe("refines")
    expect(result.confidence).toBe(0.91)
  })

  it("throws when response payload is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    relationship: "something_else",
                    confidence: 0.5,
                    explanation: "Not a supported relationship.",
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    )

    await expect(
      classifyMemoryRelationship({
        memoryA: { id: "mem-a", content: "A", createdAt: null },
        memoryB: { id: "mem-b", content: "B", createdAt: null },
      })
    ).rejects.toThrow("Invalid relationship classification")
  })
})

describe("extractSemanticRelationships", () => {
  it("maps target memory indexes and condition keys to typed semantic edges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    edges: [
                      {
                        type: "caused_by",
                        target_memory_index: 1,
                        condition_key: null,
                        direction: "from_new",
                        confidence: 0.84,
                        evidence: "because I'm on a diet",
                      },
                      {
                        type: "conditional_on",
                        target_memory_index: null,
                        condition_key: "time:morning",
                        direction: "from_new",
                        confidence: 0.76,
                        evidence: "in the morning",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    )

    const result = await extractSemanticRelationships({
      newMemory: {
        id: "mem-new",
        content: "I stopped fast food because I'm on a diet and drink coffee in the morning.",
        createdAt: "2026-02-21T00:00:00.000Z",
      },
      recentMemories: [
        { id: "mem-old", content: "I'm on a diet.", createdAt: "2026-02-20T00:00:00.000Z" },
      ],
    })

    expect(result.edges).toEqual([
      {
        type: "caused_by",
        targetMemoryId: "mem-old",
        conditionKey: null,
        direction: "from_new",
        confidence: 0.84,
        evidence: "because I'm on a diet",
      },
      {
        type: "conditional_on",
        targetMemoryId: null,
        conditionKey: "time:morning",
        direction: "from_new",
        confidence: 0.76,
        evidence: "in the morning",
      },
    ])
  })
})
