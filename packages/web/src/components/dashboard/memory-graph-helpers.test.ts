import { describe, expect, it, vi } from "vitest"
import type { GraphCanvasEdge, GraphCanvasModel, GraphCanvasNode } from "./memory-graph-helpers"
import {
  buildMiniMapViewport,
  filterGraphCanvasModel,
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
  resolveSelectedGraphEdge,
  scaleViewportAtPoint,
  summarizeGraphNodeStats,
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

function buildGraphCanvasFixture(): GraphCanvasModel {
  const selectedNode = buildNodeFixture({
    id: "repo:github.com/webrenew/memories",
    nodeType: "repo",
    nodeKey: "github.com/webrenew/memories",
    label: "memories",
    degree: 3,
    isSelected: true,
  })
  const topicNode = buildNodeFixture({
    id: "topic:graph",
    nodeType: "topic",
    nodeKey: "graph",
    label: "graph",
    degree: 2,
  })
  const categoryNode = buildNodeFixture({
    id: "category:ops",
    nodeType: "category",
    nodeKey: "ops",
    label: "ops",
    degree: 1,
  })

  const edges: GraphCanvasEdge[] = [
    buildEdgeFixture({
      id: "edge-1",
      edgeType: "similar_to",
      direction: "outbound",
      weight: 0.92,
      confidence: 0.96,
      evidenceMemoryId: "mem_1",
      from: selectedNode,
      to: topicNode,
      fromId: selectedNode.id,
      toId: topicNode.id,
    }),
    buildEdgeFixture({
      id: "edge-2",
      edgeType: "caused_by",
      direction: "inbound",
      weight: 0.71,
      confidence: 0.82,
      evidenceMemoryId: null,
      expiresAt: "2026-03-01T00:00:00.000Z",
      from: topicNode,
      to: selectedNode,
      fromId: topicNode.id,
      toId: selectedNode.id,
    }),
    buildEdgeFixture({
      id: "edge-3",
      edgeType: "similar_to",
      direction: "outbound",
      weight: 0.42,
      confidence: 0.31,
      evidenceMemoryId: null,
      from: selectedNode,
      to: categoryNode,
      fromId: selectedNode.id,
      toId: categoryNode.id,
    }),
  ]

  return {
    nodes: [selectedNode, topicNode, categoryNode],
    edges,
    nodeTypes: ["category", "repo", "topic"],
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

describe("memory-graph-helpers interaction projections", () => {
  it("filters graph canvas by edge type, confidence, and evidence", () => {
    const graphCanvas = buildGraphCanvasFixture()
    const filtered = filterGraphCanvasModel(graphCanvas, {
      edgeTypeFilter: ["similar_to"],
      nodeTypeFilter: [],
      minWeight: 0,
      minConfidence: 0.5,
      onlyEvidenceEdges: true,
    })

    expect(filtered?.edges.map((edge) => edge.id)).toEqual(["edge-1"])
    expect(filtered?.nodes.map((node) => node.id)).toEqual([
      "repo:github.com/webrenew/memories",
      "topic:graph",
    ])
  })

  it("falls back to the first available edge when selected id is missing", () => {
    const graphCanvas = buildGraphCanvasFixture()
    const selected = resolveSelectedGraphEdge(graphCanvas, "missing-edge-id")

    expect(selected?.id).toBe("edge-1")
  })

  it("summarizes outbound/inbound and evidence/expiry stats from filtered edges", () => {
    const graphCanvas = buildGraphCanvasFixture()
    const filtered = filterGraphCanvasModel(graphCanvas, {
      edgeTypeFilter: [],
      nodeTypeFilter: ["repo", "topic"],
      minWeight: 0.5,
      minConfidence: 0.5,
      onlyEvidenceEdges: false,
    })

    expect(filtered?.edges.map((edge) => edge.id)).toEqual(["edge-1", "edge-2"])
    expect(summarizeGraphNodeStats(filtered)).toEqual({
      outbound: 1,
      inbound: 1,
      expiring: 1,
      withEvidence: 1,
    })
  })
})
