import { describe, expect, it, vi } from "vitest"
import type { GraphCanvasEdge, GraphCanvasNode } from "./memory-graph-helpers"
import {
  graphEdgeAriaLabel,
  graphNodeAriaLabel,
  handleGraphActivationKey,
  isAbortLikeError,
  isGraphActivationKey,
} from "./memory-graph-helpers"

function buildNodeFixture(overrides: Partial<GraphCanvasNode> = {}): GraphCanvasNode {
  return {
    id: "repo:github.com/webrenew/memories",
    nodeType: "repo",
    nodeKey: "github.com/webrenew/memories",
    label: "memories",
    degree: 5,
    x: 120,
    y: 160,
    isSelected: false,
    ...overrides,
  }
}

function buildEdgeFixture(overrides: Partial<GraphCanvasEdge> = {}): GraphCanvasEdge {
  const from = buildNodeFixture()
  const to = buildNodeFixture({
    id: "topic:graph",
    nodeType: "topic",
    nodeKey: "graph",
    label: "graph",
  })

  return {
    id: "edge-1",
    edgeType: "similar_to",
    weight: 0.84,
    confidence: 0.91,
    expiresAt: null,
    evidenceMemoryId: "mem_123",
    direction: "outbound",
    from,
    to,
    fromId: from.id,
    toId: to.id,
    path: "M0 0",
    labelX: 10,
    labelY: 15,
    ...overrides,
  }
}

describe("memory-graph-helpers keyboard activation", () => {
  it("recognizes Enter and Space keys as activation keys", () => {
    expect(isGraphActivationKey("Enter")).toBe(true)
    expect(isGraphActivationKey(" ")).toBe(true)
    expect(isGraphActivationKey("Spacebar")).toBe(true)
    expect(isGraphActivationKey("Escape")).toBe(false)
  })

  it("activates selection handlers on Enter or Space keydown", () => {
    const onActivate = vi.fn()
    const preventDefault = vi.fn()

    const enterActivated = handleGraphActivationKey({ key: "Enter", preventDefault }, onActivate)
    const spaceActivated = handleGraphActivationKey({ key: " ", preventDefault }, onActivate)

    expect(enterActivated).toBe(true)
    expect(spaceActivated).toBe(true)
    expect(onActivate).toHaveBeenCalledTimes(2)
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })

  it("ignores non-activation keys", () => {
    const onActivate = vi.fn()
    const preventDefault = vi.fn()

    const activated = handleGraphActivationKey({ key: "Escape", preventDefault }, onActivate)

    expect(activated).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe("memory-graph-helpers aria labels", () => {
  it("formats node aria labels with key node details", () => {
    const label = graphNodeAriaLabel(buildNodeFixture())
    expect(label).toContain("Graph node memories")
    expect(label).toContain("Type repo")
    expect(label).toContain("Degree 5")
  })

  it("formats edge aria labels with direction and quality metadata", () => {
    const label = graphEdgeAriaLabel(buildEdgeFixture())
    expect(label).toContain("Graph edge similar_to")
    expect(label).toContain("outbound")
    expect(label).toContain("From repo:github.com/webrenew/memories")
    expect(label).toContain("to topic:graph")
    expect(label).toContain("Weight 0.84")
    expect(label).toContain("Confidence 0.91")
  })
})

describe("memory-graph-helpers abort detection", () => {
  it("detects AbortError by name", () => {
    expect(isAbortLikeError({ name: "AbortError" })).toBe(true)
    expect(isAbortLikeError(new Error("network"))).toBe(false)
    expect(isAbortLikeError({ name: "TypeError" })).toBe(false)
    expect(isAbortLikeError(null)).toBe(false)
  })
})
