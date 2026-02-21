import type { GraphStatusPayload } from "@/lib/memory-service/graph/status"

export type GraphRolloutMode = GraphStatusPayload["rollout"]["mode"]

export interface GraphNodeSelection {
  nodeType: string
  nodeKey: string
  label: string
}

export interface GraphExplorerEdge {
  id: string
  edgeType: string
  weight: number
  confidence: number
  expiresAt: string | null
  evidenceMemoryId: string | null
  direction: "outbound" | "inbound"
  from: GraphNodeSelection
  to: GraphNodeSelection
}

export interface GraphExplorerMemory {
  memoryId: string
  role: string
  type: string
  content: string
  updatedAt: string | null
}

export interface GraphExplorerResponse {
  node: GraphNodeSelection | null
  nodes: GraphNodeSelection[]
  edges: GraphExplorerEdge[]
  memories: GraphExplorerMemory[]
}

export interface GraphCanvasNode extends GraphNodeSelection {
  id: string
  x: number
  y: number
  degree: number
  isSelected: boolean
}

export interface GraphCanvasEdge extends GraphExplorerEdge {
  fromId: string
  toId: string
  path: string
  labelX: number
  labelY: number
}

export interface GraphCanvasModel {
  nodes: GraphCanvasNode[]
  edges: GraphCanvasEdge[]
  nodeTypes: string[]
}

export interface GraphFilterOptions {
  edgeTypeFilter: string[]
  nodeTypeFilter: string[]
  minWeight: number
  minConfidence: number
  onlyEvidenceEdges: boolean
}

export interface GraphNodeStats {
  outbound: number
  inbound: number
  expiring: number
  withEvidence: number
}

export interface GraphViewport {
  scale: number
  x: number
  y: number
}

export interface MiniMapViewport {
  width: number
  height: number
  viewportX: number
  viewportY: number
  viewportWidth: number
  viewportHeight: number
}

export const ROLLOUT_MODES: Array<{ value: GraphRolloutMode; label: string; description: string }> = [
  { value: "off", label: "Off", description: "Always serve baseline retrieval." },
  { value: "shadow", label: "Shadow", description: "Run graph retrieval without applying it." },
  { value: "canary", label: "Canary", description: "Apply graph retrieval for hybrid requests." },
]

export const GRAPH_WIDTH = 1080
export const GRAPH_HEIGHT = 620
export const GRAPH_ZOOM_MIN = 0.55
export const GRAPH_ZOOM_MAX = 2.6
export const GRAPH_ZOOM_STEP = 0.16

export const DEFAULT_GRAPH_VIEWPORT: GraphViewport = {
  scale: 1,
  x: 0,
  y: 0,
}

export function scaleViewportAtPoint(
  viewport: GraphViewport,
  scaleMultiplier: number,
  anchor: { x: number; y: number }
): GraphViewport {
  const clampedScale = clamp(viewport.scale * scaleMultiplier, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX)
  if (clampedScale === viewport.scale) {
    return viewport
  }

  const ratio = clampedScale / viewport.scale
  return {
    scale: clampedScale,
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
  }
}

export function buildMiniMapViewport(viewport: GraphViewport): MiniMapViewport {
  const width = 172
  const height = 98
  const unclampedViewportWidth = GRAPH_WIDTH / viewport.scale
  const unclampedViewportHeight = GRAPH_HEIGHT / viewport.scale
  const viewportWidth = clamp(unclampedViewportWidth, 0, GRAPH_WIDTH)
  const viewportHeight = clamp(unclampedViewportHeight, 0, GRAPH_HEIGHT)
  const rawViewportX = (-viewport.x) / viewport.scale
  const rawViewportY = (-viewport.y) / viewport.scale
  const maxViewportX = Math.max(0, GRAPH_WIDTH - viewportWidth)
  const maxViewportY = Math.max(0, GRAPH_HEIGHT - viewportHeight)

  return {
    width,
    height,
    viewportX: clamp(rawViewportX, 0, maxViewportX),
    viewportY: clamp(rawViewportY, 0, maxViewportY),
    viewportWidth,
    viewportHeight,
  }
}

export const NODE_TYPE_STYLES: Record<string, { fill: string; stroke: string; text: string }> = {
  repo: { fill: "rgba(56, 189, 248, 0.16)", stroke: "#38bdf8", text: "#d8f3ff" },
  topic: { fill: "rgba(16, 185, 129, 0.16)", stroke: "#10b981", text: "#dcfce7" },
  category: { fill: "rgba(245, 158, 11, 0.16)", stroke: "#f59e0b", text: "#fef3c7" },
  user: { fill: "rgba(168, 85, 247, 0.16)", stroke: "#a855f7", text: "#f3e8ff" },
  memory_type: { fill: "rgba(99, 102, 241, 0.18)", stroke: "#6366f1", text: "#e0e7ff" },
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function severityClass(severity: "info" | "warning" | "critical"): string {
  if (severity === "critical") return "text-red-500"
  if (severity === "warning") return "text-amber-500"
  return "text-sky-500"
}

export function qualityStatusLabel(status: GraphStatusPayload["qualityGate"]["status"]): string {
  if (status === "insufficient_data") return "Insufficient Data"
  return status.toUpperCase()
}

export function qualityStatusClass(status: GraphStatusPayload["qualityGate"]["status"], blocked: boolean): string {
  if (blocked || status === "fail") return "text-red-500"
  if (status === "warn") return "text-amber-500"
  if (status === "pass") return "text-emerald-500"
  return "text-muted-foreground"
}

export function truncateText(value: string, max = 180): string {
  if (value.length <= max) return value
  return `${value.slice(0, max).trim()}...`
}

export function isGraphActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar"
}

export function handleGraphActivationKey(
  event: Pick<KeyboardEvent, "key" | "preventDefault">,
  onActivate: () => void
): boolean {
  if (!isGraphActivationKey(event.key)) {
    return false
  }

  event.preventDefault()
  onActivate()
  return true
}

export function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const name = "name" in error ? (error as { name?: unknown }).name : undefined
  return typeof name === "string" && name === "AbortError"
}

export function graphNodeAriaLabel(node: GraphCanvasNode): string {
  return `Graph node ${node.label}. Type ${node.nodeType}. Degree ${node.degree}.`
}

export function graphEdgeAriaLabel(edge: GraphCanvasEdge): string {
  return `Graph edge ${edge.edgeType}. ${edge.direction}. From ${edge.from.nodeType}:${edge.from.nodeKey} to ${edge.to.nodeType}:${edge.to.nodeKey}. Weight ${edge.weight.toFixed(2)}. Confidence ${edge.confidence.toFixed(2)}.`
}

export function nodeRefId(node: GraphNodeSelection): string {
  return `${node.nodeType}:${node.nodeKey}`
}

export function getNodeStyle(nodeType: string): { fill: string; stroke: string; text: string } {
  return NODE_TYPE_STYLES[nodeType] ?? {
    fill: "rgba(148, 163, 184, 0.14)",
    stroke: "#94a3b8",
    text: "#e2e8f0",
  }
}

export function formatNodeLabel(node: GraphNodeSelection): string {
  if (node.nodeType === "repo") {
    const tail = node.nodeKey.split("/").pop()
    return tail || node.label
  }
  return node.label || `${node.nodeType}:${node.nodeKey}`
}

export function trimMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const slice = Math.max(4, Math.floor((maxLength - 3) / 2))
  return `${value.slice(0, slice)}...${value.slice(-slice)}`
}

export function buildEdgeGeometry(from: GraphCanvasNode, to: GraphCanvasNode, curveOffset: number): {
  path: string
  labelX: number
  labelY: number
} {
  if (from.id === to.id) {
    const loopLift = 62 + Math.abs(curveOffset) * 0.4
    const loopRadius = 34 + Math.abs(curveOffset) * 0.3
    return {
      path: `M ${from.x} ${from.y - 12}
             C ${from.x + loopRadius} ${from.y - loopLift}
               ${from.x - loopRadius} ${from.y - loopLift}
               ${from.x} ${from.y - 12}`,
      labelX: from.x,
      labelY: from.y - loopLift - 8,
    }
  }

  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const nx = -dy / length
  const ny = dx / length
  const cx = mx + nx * curveOffset
  const cy = my + ny * curveOffset

  return {
    path: `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`,
    labelX: 0.25 * from.x + 0.5 * cx + 0.25 * to.x,
    labelY: 0.25 * from.y + 0.5 * cy + 0.25 * to.y,
  }
}

export function buildGraphCanvasModel(
  selectedNode: GraphNodeSelection | null,
  explorerData: GraphExplorerResponse | null
): GraphCanvasModel | null {
  if (!selectedNode || !explorerData) {
    return null
  }

  const selectedId = nodeRefId(selectedNode)
  const nodeMap = new Map<string, GraphNodeSelection>()
  nodeMap.set(selectedId, selectedNode)

  for (const node of explorerData.nodes) {
    nodeMap.set(nodeRefId(node), node)
  }

  for (const edge of explorerData.edges) {
    nodeMap.set(nodeRefId(edge.from), edge.from)
    nodeMap.set(nodeRefId(edge.to), edge.to)
  }

  if (nodeMap.size === 0) {
    return null
  }

  const degreeMap = new Map<string, number>()
  for (const edge of explorerData.edges) {
    const fromId = nodeRefId(edge.from)
    const toId = nodeRefId(edge.to)
    degreeMap.set(fromId, (degreeMap.get(fromId) ?? 0) + 1)
    degreeMap.set(toId, (degreeMap.get(toId) ?? 0) + 1)
  }

  const positionMap = new Map<string, { x: number; y: number }>()
  const centerX = GRAPH_WIDTH / 2
  const centerY = GRAPH_HEIGHT / 2
  positionMap.set(selectedId, { x: centerX, y: centerY })

  const surroundingNodeIds = [...nodeMap.keys()]
    .filter((id) => id !== selectedId)
    .sort((left, right) => {
      const leftDegree = degreeMap.get(left) ?? 0
      const rightDegree = degreeMap.get(right) ?? 0
      if (leftDegree !== rightDegree) return rightDegree - leftDegree
      return left.localeCompare(right)
    })

  const ringSize = 10
  const baseRadius = 165
  const ringGap = 96
  surroundingNodeIds.forEach((id, index) => {
    const ringIndex = Math.floor(index / ringSize)
    const ringStart = ringIndex * ringSize
    const ringCount = Math.min(ringSize, surroundingNodeIds.length - ringStart)
    const slotIndex = index - ringStart
    const radius = baseRadius + ringIndex * ringGap
    const angle = (slotIndex / Math.max(ringCount, 1)) * Math.PI * 2 - Math.PI / 2

    positionMap.set(id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    })
  })

  const nodes = [...nodeMap.entries()].map(([id, node]) => {
    const position = positionMap.get(id) ?? { x: centerX, y: centerY }
    return {
      ...node,
      id,
      x: position.x,
      y: position.y,
      degree: degreeMap.get(id) ?? 0,
      isSelected: id === selectedId,
    }
  })

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const groupedEdges = new Map<string, GraphExplorerEdge[]>()

  for (const edge of explorerData.edges) {
    const key = `${nodeRefId(edge.from)}->${nodeRefId(edge.to)}`
    const group = groupedEdges.get(key)
    if (group) {
      group.push(edge)
    } else {
      groupedEdges.set(key, [edge])
    }
  }

  const edges: GraphCanvasEdge[] = []
  for (const [key, group] of groupedEdges.entries()) {
    const [fromId, toId] = key.split("->")
    const fromNode = nodeById.get(fromId)
    const toNode = nodeById.get(toId)
    if (!fromNode || !toNode) continue

    const centerOffset = (group.length - 1) / 2
    group.forEach((edge, index) => {
      const curveOffset = (index - centerOffset) * 26
      const geometry = buildEdgeGeometry(fromNode, toNode, curveOffset)
      edges.push({
        ...edge,
        fromId,
        toId,
        path: geometry.path,
        labelX: geometry.labelX,
        labelY: geometry.labelY,
      })
    })
  }

  const nodeTypes = [...new Set(nodes.map((node) => node.nodeType))].sort()
  return { nodes, edges, nodeTypes }
}

export function filterGraphCanvasModel(
  graphCanvas: GraphCanvasModel | null,
  options: GraphFilterOptions
): GraphCanvasModel | null {
  if (!graphCanvas) return null

  const edgeTypeOptions = [...new Set(graphCanvas.edges.map((edge) => edge.edgeType))].sort()
  const allowedEdgeTypes =
    options.edgeTypeFilter.length > 0 ? new Set(options.edgeTypeFilter) : new Set(edgeTypeOptions)
  const allowedNodeTypes =
    options.nodeTypeFilter.length > 0 ? new Set(options.nodeTypeFilter) : new Set(graphCanvas.nodeTypes)

  const edges = graphCanvas.edges.filter((edge) => {
    if (!allowedEdgeTypes.has(edge.edgeType)) return false
    if (!allowedNodeTypes.has(edge.from.nodeType) || !allowedNodeTypes.has(edge.to.nodeType)) {
      return false
    }
    if (edge.weight < options.minWeight) return false
    if (edge.confidence < options.minConfidence) return false
    if (options.onlyEvidenceEdges && !edge.evidenceMemoryId) return false
    return true
  })

  const visibleNodeIds = new Set<string>()
  for (const node of graphCanvas.nodes) {
    if (node.isSelected) {
      visibleNodeIds.add(node.id)
    }
  }
  for (const edge of edges) {
    visibleNodeIds.add(edge.fromId)
    visibleNodeIds.add(edge.toId)
  }

  const nodes = graphCanvas.nodes.filter((node) => {
    if (!node.isSelected && !allowedNodeTypes.has(node.nodeType)) return false
    return visibleNodeIds.has(node.id)
  })

  const nodeTypes = [...new Set(nodes.map((node) => node.nodeType))].sort()
  return { nodes, edges, nodeTypes }
}

export function resolveSelectedGraphEdge(
  filteredGraph: GraphCanvasModel | null,
  selectedEdgeId: string | null
): GraphCanvasEdge | null {
  if (!filteredGraph || filteredGraph.edges.length === 0) return null
  if (!selectedEdgeId) return filteredGraph.edges[0]
  return filteredGraph.edges.find((edge) => edge.id === selectedEdgeId) ?? filteredGraph.edges[0]
}

export function summarizeGraphNodeStats(filteredGraph: GraphCanvasModel | null): GraphNodeStats {
  if (!filteredGraph) {
    return {
      outbound: 0,
      inbound: 0,
      expiring: 0,
      withEvidence: 0,
    }
  }

  let outbound = 0
  let inbound = 0
  let expiring = 0
  let withEvidence = 0

  for (const edge of filteredGraph.edges) {
    if (edge.direction === "outbound") {
      outbound += 1
    } else {
      inbound += 1
    }
    if (edge.expiresAt) {
      expiring += 1
    }
    if (edge.evidenceMemoryId) {
      withEvidence += 1
    }
  }

  return {
    outbound,
    inbound,
    expiring,
    withEvidence,
  }
}
