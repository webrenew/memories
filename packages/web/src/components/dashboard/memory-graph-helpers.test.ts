import { describe, expect, it, vi } from "vitest"
import type { GraphCanvasEdge, GraphCanvasNode } from "./memory-graph-helpers"
import {
  buildMiniMapViewport,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  GRAPH_ZOOM_MAX,
  GRAPH_ZOOM_MIN,
  GRAPH_ZOOM_STEP,
  graphEdgeAriaLabel,
  graphNodeAriaLabel,
  handleGraphActivationKey,
  isAbortLikeError,
  isGraphActivationKey,
  scaleViewportAtPoint,
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

describe("memory-graph-helpers viewport scaling", () => {
  it("composes repeated zoom steps against the latest viewport", () => {
    const anchor = { x: 540, y: 310 }
    const first = scaleViewportAtPoint({ scale: 1, x: 0, y: 0 }, 1 + GRAPH_ZOOM_STEP, anchor)
    const second = scaleViewportAtPoint(first, 1 + GRAPH_ZOOM_STEP, anchor)

    expect(second.scale).toBeCloseTo((1 + GRAPH_ZOOM_STEP) ** 2, 6)
    expect(second.scale).toBeGreaterThan(first.scale)
  })

  it("clamps viewport scaling to configured min and max", () => {
    const anchor = { x: 540, y: 310 }
    const maxed = scaleViewportAtPoint({ scale: GRAPH_ZOOM_MAX, x: 0, y: 0 }, 1 + GRAPH_ZOOM_STEP, anchor)
    const mined = scaleViewportAtPoint({ scale: GRAPH_ZOOM_MIN, x: 0, y: 0 }, 1 - GRAPH_ZOOM_STEP, anchor)

    expect(maxed.scale).toBe(GRAPH_ZOOM_MAX)
    expect(mined.scale).toBe(GRAPH_ZOOM_MIN)
  })
})

describe("memory-graph-helpers minimap viewport", () => {
  it("clamps low-zoom viewport extents to graph bounds", () => {
    const miniMap = buildMiniMapViewport({
      scale: 0.5,
      x: -400,
      y: -260,
    })

    expect(miniMap.viewportWidth).toBe(GRAPH_WIDTH)
    expect(miniMap.viewportHeight).toBe(GRAPH_HEIGHT)
    expect(miniMap.viewportX).toBe(0)
    expect(miniMap.viewportY).toBe(0)
  })

  it("keeps viewport origin within bounds at higher zoom levels", () => {
    const miniMap = buildMiniMapViewport({
      scale: 2,
      x: -900,
      y: -800,
    })

    expect(miniMap.viewportWidth).toBeCloseTo(GRAPH_WIDTH / 2, 6)
    expect(miniMap.viewportHeight).toBeCloseTo(GRAPH_HEIGHT / 2, 6)
    expect(miniMap.viewportX).toBeGreaterThanOrEqual(0)
    expect(miniMap.viewportY).toBeGreaterThanOrEqual(0)
    expect(miniMap.viewportX + miniMap.viewportWidth).toBeLessThanOrEqual(GRAPH_WIDTH)
    expect(miniMap.viewportY + miniMap.viewportHeight).toBeLessThanOrEqual(GRAPH_HEIGHT)
  })
})
