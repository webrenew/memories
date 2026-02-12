"use client"

import {
  type PointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import type { GraphStatusPayload } from "@/lib/memory-service/graph/status"

interface MemoryGraphSectionProps {
  status: GraphStatusPayload | null
}

type GraphRolloutMode = GraphStatusPayload["rollout"]["mode"]
type GraphNodeSelection = {
  nodeType: string
  nodeKey: string
  label: string
}

interface GraphExplorerEdge {
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

interface GraphExplorerMemory {
  memoryId: string
  role: string
  type: string
  content: string
  updatedAt: string | null
}

interface GraphExplorerResponse {
  node: GraphNodeSelection | null
  nodes: GraphNodeSelection[]
  edges: GraphExplorerEdge[]
  memories: GraphExplorerMemory[]
}

interface GraphCanvasNode extends GraphNodeSelection {
  id: string
  x: number
  y: number
  degree: number
  isSelected: boolean
}

interface GraphCanvasEdge extends GraphExplorerEdge {
  fromId: string
  toId: string
  path: string
  labelX: number
  labelY: number
}

interface GraphCanvasModel {
  nodes: GraphCanvasNode[]
  edges: GraphCanvasEdge[]
  nodeTypes: string[]
}

const ROLLOUT_MODES: Array<{ value: GraphRolloutMode; label: string; description: string }> = [
  { value: "off", label: "Off", description: "Always serve baseline retrieval." },
  { value: "shadow", label: "Shadow", description: "Run graph retrieval without applying it." },
  { value: "canary", label: "Canary", description: "Apply graph retrieval for hybrid requests." },
]

const GRAPH_WIDTH = 1080
const GRAPH_HEIGHT = 620
const GRAPH_ZOOM_MIN = 0.55
const GRAPH_ZOOM_MAX = 2.6
const GRAPH_ZOOM_STEP = 0.16

interface GraphViewport {
  scale: number
  x: number
  y: number
}

const DEFAULT_GRAPH_VIEWPORT: GraphViewport = {
  scale: 1,
  x: 0,
  y: 0,
}

const NODE_TYPE_STYLES: Record<string, { fill: string; stroke: string; text: string }> = {
  repo: { fill: "rgba(56, 189, 248, 0.16)", stroke: "#38bdf8", text: "#d8f3ff" },
  topic: { fill: "rgba(16, 185, 129, 0.16)", stroke: "#10b981", text: "#dcfce7" },
  category: { fill: "rgba(245, 158, 11, 0.16)", stroke: "#f59e0b", text: "#fef3c7" },
  user: { fill: "rgba(168, 85, 247, 0.16)", stroke: "#a855f7", text: "#f3e8ff" },
  memory_type: { fill: "rgba(99, 102, 241, 0.18)", stroke: "#6366f1", text: "#e0e7ff" },
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function metricCard(
  label: string,
  value: number | string,
  tone?: "neutral" | "danger" | "success"
) {
  const valueClass =
    tone === "danger" ? "text-red-500" : tone === "success" ? "text-emerald-500" : "text-foreground"
  return (
    <div className="border border-border bg-card/10 p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-muted-foreground/70 mb-2">{label}</p>
      <p className={`text-2xl font-mono font-bold ${valueClass}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  )
}

function severityClass(severity: "info" | "warning" | "critical"): string {
  if (severity === "critical") return "text-red-500"
  if (severity === "warning") return "text-amber-500"
  return "text-sky-500"
}

function truncateText(value: string, max = 180): string {
  if (value.length <= max) return value
  return `${value.slice(0, max).trim()}...`
}

function nodeRefId(node: GraphNodeSelection): string {
  return `${node.nodeType}:${node.nodeKey}`
}

function getNodeStyle(nodeType: string): { fill: string; stroke: string; text: string } {
  return NODE_TYPE_STYLES[nodeType] ?? {
    fill: "rgba(148, 163, 184, 0.14)",
    stroke: "#94a3b8",
    text: "#e2e8f0",
  }
}

function formatNodeLabel(node: GraphNodeSelection): string {
  if (node.nodeType === "repo") {
    const tail = node.nodeKey.split("/").pop()
    return tail || node.label
  }
  return node.label || `${node.nodeType}:${node.nodeKey}`
}

function trimMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const slice = Math.max(4, Math.floor((maxLength - 3) / 2))
  return `${value.slice(0, slice)}...${value.slice(-slice)}`
}

function buildEdgeGeometry(from: GraphCanvasNode, to: GraphCanvasNode, curveOffset: number): {
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

function buildGraphCanvasModel(
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

export function MemoryGraphSection({ status }: MemoryGraphSectionProps) {
  const [localStatus, setLocalStatus] = useState(status)
  const [modeError, setModeError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNodeSelection | null>(null)
  const [explorerData, setExplorerData] = useState<GraphExplorerResponse | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [explorerError, setExplorerError] = useState<string | null>(null)
  const [isExplorerLoading, setIsExplorerLoading] = useState(false)
  const [graphViewport, setGraphViewport] = useState<GraphViewport>(DEFAULT_GRAPH_VIEWPORT)
  const [isPanning, setIsPanning] = useState(false)
  const [isPending, startTransition] = useTransition()
  const graphViewportRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null)

  useEffect(() => {
    setLocalStatus(status)
  }, [status])

  useEffect(() => {
    if (!localStatus || localStatus.topConnectedNodes.length === 0) {
      setSelectedNode(null)
      setExplorerData(null)
      setSelectedEdgeId(null)
      setExplorerError(null)
      return
    }

    if (!selectedNode) {
      const node = localStatus.topConnectedNodes[0]
      setSelectedNode({
        nodeType: node.nodeType,
        nodeKey: node.nodeKey,
        label: node.label,
      })
    }
  }, [localStatus, selectedNode])

  useEffect(() => {
    if (!selectedNode) return

    let cancelled = false
    setIsExplorerLoading(true)
    setExplorerError(null)

    void (async () => {
      try {
        const params = new URLSearchParams({
          nodeType: selectedNode.nodeType,
          nodeKey: selectedNode.nodeKey,
          limit: "20",
        })
        const response = await fetch(`/api/graph/explore?${params.toString()}`)
        const body = (await response.json().catch(() => ({}))) as GraphExplorerResponse & {
          error?: string
        }
        if (!response.ok) {
          if (!cancelled) {
            setExplorerError(body.error ?? "Failed to load graph explorer data.")
            setExplorerData(null)
            setSelectedEdgeId(null)
          }
          return
        }

        if (!cancelled) {
          setExplorerData(body)
          setSelectedEdgeId((current) =>
            body.edges.some((edge) => edge.id === current) ? current : (body.edges[0]?.id ?? null)
          )
        }
      } catch {
        if (!cancelled) {
          setExplorerError("Network error while loading graph explorer data.")
          setExplorerData(null)
          setSelectedEdgeId(null)
        }
      } finally {
        if (!cancelled) {
          setIsExplorerLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedNode])

  useEffect(() => {
    setGraphViewport(DEFAULT_GRAPH_VIEWPORT)
    setIsPanning(false)
    panStartRef.current = null
  }, [selectedNode?.nodeType, selectedNode?.nodeKey])

  const activeStatus = localStatus
  const fallbackRate = activeStatus?.shadowMetrics.fallbackRate ?? 0
  const fallbackTone = fallbackRate >= 0.15 ? "danger" : fallbackRate === 0 ? "success" : "neutral"
  const graphCanvas = useMemo(
    () => buildGraphCanvasModel(selectedNode, explorerData),
    [selectedNode, explorerData]
  )
  const selectedEdge = useMemo(() => {
    if (!explorerData || explorerData.edges.length === 0) return null
    if (!selectedEdgeId) return explorerData.edges[0]
    return explorerData.edges.find((edge) => edge.id === selectedEdgeId) ?? explorerData.edges[0]
  }, [explorerData, selectedEdgeId])
  const selectedNodeStats = useMemo(() => {
    if (!explorerData) {
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
    for (const edge of explorerData.edges) {
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
  }, [explorerData])

  const applyScaleAtPoint = useCallback((nextScale: number, anchor: { x: number; y: number }) => {
    setGraphViewport((current) => {
      const clampedScale = clamp(nextScale, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX)
      if (clampedScale === current.scale) {
        return current
      }

      const ratio = clampedScale / current.scale
      return {
        scale: clampedScale,
        x: anchor.x - (anchor.x - current.x) * ratio,
        y: anchor.y - (anchor.y - current.y) * ratio,
      }
    })
  }, [])

  const zoomFromCenter = useCallback((scaleMultiplier: number) => {
    const anchor = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 }
    setGraphViewport((current) => {
      const clampedScale = clamp(current.scale * scaleMultiplier, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX)
      if (clampedScale === current.scale) {
        return current
      }

      const ratio = clampedScale / current.scale
      return {
        scale: clampedScale,
        x: anchor.x - (anchor.x - current.x) * ratio,
        y: anchor.y - (anchor.y - current.y) * ratio,
      }
    })
  }, [])

  const resetViewport = useCallback(() => {
    setGraphViewport(DEFAULT_GRAPH_VIEWPORT)
    setIsPanning(false)
    panStartRef.current = null
  }, [])

  const handleGraphWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      event.preventDefault()
      const container = graphViewportRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const px = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH
      const py = ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT
      const direction = event.deltaY > 0 ? -1 : 1
      const scaleMultiplier = 1 + GRAPH_ZOOM_STEP * direction
      const nextScale = graphViewport.scale * scaleMultiplier
      applyScaleAtPoint(nextScale, { x: px, y: py })
    },
    [applyScaleAtPoint, graphViewport.scale]
  )

  const stopPanning = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const panState = panStartRef.current
    if (panState && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panStartRef.current = null
    setIsPanning(false)
  }, [])

  const handleGraphPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    panStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPanning(true)
  }, [])

  const handleGraphPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const panState = panStartRef.current
    if (!panState || panState.pointerId !== event.pointerId) return

    const container = graphViewportRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const deltaX = ((event.clientX - panState.clientX) / rect.width) * GRAPH_WIDTH
    const deltaY = ((event.clientY - panState.clientY) / rect.height) * GRAPH_HEIGHT

    setGraphViewport((current) => ({
      ...current,
      x: current.x + deltaX,
      y: current.y + deltaY,
    }))

    panStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    }
  }, [])

  const updateRolloutMode = (mode: GraphRolloutMode) => {
    if (!activeStatus || activeStatus.rollout.mode === mode) {
      return
    }

    setModeError(null)
    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/graph/rollout", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode }),
          })
          const body = await response.json().catch(() => ({} as { error?: string }))
          if (!response.ok) {
            setModeError(body.error ?? "Failed to update graph rollout mode.")
            return
          }

          const nextStatus = body.status as GraphStatusPayload | undefined
          if (nextStatus) {
            setLocalStatus(nextStatus)
          } else {
            setModeError("Rollout update returned an invalid payload.")
          }
        } catch {
          setModeError("Network error while updating rollout mode.")
        }
      })()
    })
  }

  return (
    <section className="border border-border bg-card/10 p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Memory Graph</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Node and edge health for this workspace memory graph.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
            Status
          </p>
          <p className="text-xs font-mono mt-1">
            {activeStatus?.health === "ok"
              ? "Healthy"
              : activeStatus?.health === "schema_missing"
              ? "Schema Missing"
              : "Unavailable"}
          </p>
        </div>
      </div>

      {!activeStatus ? (
        <div className="border border-border bg-card/20 p-6 text-sm text-muted-foreground">
          Graph metrics are currently unavailable.
        </div>
      ) : (
        <>
          <div className="border border-border bg-card/5 p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground">Rollout Controls</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Workspace-level gating for hybrid graph retrieval.
                </p>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Full hybrid switch = request <span className="font-mono text-foreground">strategy: hybrid_graph</span> and
                  rollout mode <span className="font-mono text-foreground">canary</span>.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                Updated:{" "}
                <span className="font-mono text-foreground">
                  {new Date(activeStatus.rollout.updatedAt).toLocaleString()}
                </span>
                {activeStatus.rollout.updatedBy ? (
                  <>
                    {" "}
                    by <span className="font-mono text-foreground">{activeStatus.rollout.updatedBy}</span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {ROLLOUT_MODES.map((mode) => {
                const isActive = activeStatus.rollout.mode === mode.value
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => updateRolloutMode(mode.value)}
                    disabled={isPending || isActive}
                    className={`border p-3 text-left transition-colors ${
                      isActive
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-card/10 hover:bg-card/30"
                    } ${isPending ? "cursor-not-allowed opacity-70" : ""}`}
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.18em]">{mode.label}</p>
                    <p className="text-xs text-muted-foreground mt-2">{mode.description}</p>
                  </button>
                )
              })}
            </div>

            {isPending ? (
              <p className="text-xs text-muted-foreground">Updating rollout mode...</p>
            ) : null}
            {modeError ? (
              <p className="text-xs text-red-500">{modeError}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {metricCard("Requests (24h)", activeStatus.shadowMetrics.totalRequests)}
            {metricCard("Hybrid Requested", activeStatus.shadowMetrics.hybridRequested)}
            {metricCard("Canary Applied", activeStatus.shadowMetrics.canaryApplied, "success")}
            {metricCard("Shadow Executed", activeStatus.shadowMetrics.shadowExecutions)}
            {metricCard(
              "Fallback Rate",
              `${(activeStatus.shadowMetrics.fallbackRate * 100).toFixed(1)}%`,
              fallbackTone
            )}
            {metricCard(
              "Graph Error Fallbacks",
              activeStatus.shadowMetrics.graphErrorFallbacks,
              activeStatus.shadowMetrics.graphErrorFallbacks > 0 ? "danger" : "neutral"
            )}
          </div>

          <div className="border border-border bg-card/5 p-4">
            <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground mb-4">Fallback Alarms</h3>
            {activeStatus.alarms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active fallback alarms.</p>
            ) : (
              <div className="space-y-3">
                {activeStatus.alarms.map((alarm) => (
                  <div key={`${alarm.code}:${alarm.triggeredAt}`} className="border border-border bg-card/20 p-3">
                    <p className={`text-xs font-mono font-bold ${severityClass(alarm.severity)}`}>
                      {alarm.severity.toUpperCase()}
                    </p>
                    <p className="text-sm mt-1">{alarm.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                      {alarm.code} • {new Date(alarm.triggeredAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {metricCard("Nodes", activeStatus.counts.nodes)}
            {metricCard("Edges", activeStatus.counts.edges)}
            {metricCard("Memory Links", activeStatus.counts.memoryLinks)}
            {metricCard("Active Edges", activeStatus.counts.activeEdges, "success")}
            {metricCard(
              "Expired Edges",
              activeStatus.counts.expiredEdges,
              activeStatus.counts.expiredEdges > 0 ? "danger" : "neutral"
            )}
            {metricCard(
              "Orphan Nodes",
              activeStatus.counts.orphanNodes,
              activeStatus.counts.orphanNodes > 0 ? "danger" : "neutral"
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="border border-border bg-card/5 p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground">Top Nodes</h3>
                <p className="text-[11px] text-muted-foreground">Click a node to explore connections</p>
              </div>
              {activeStatus.topConnectedNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No connected nodes yet.</p>
              ) : (
                <div className="space-y-2">
                  {activeStatus.topConnectedNodes.slice(0, 6).map((node) => (
                    <button
                      key={`${node.nodeType}:${node.nodeKey}`}
                      type="button"
                      onClick={() =>
                        setSelectedNode({
                          nodeType: node.nodeType,
                          nodeKey: node.nodeKey,
                          label: node.label,
                        })}
                      className={`w-full flex items-center justify-between text-sm border p-2 text-left transition-colors ${
                        selectedNode?.nodeType === node.nodeType && selectedNode?.nodeKey === node.nodeKey
                          ? "border-primary/40 bg-primary/10"
                          : "border-border bg-card/10 hover:bg-card/30"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{node.label}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {node.nodeType}:{node.nodeKey}
                        </p>
                      </div>
                      <div className="text-right ml-3">
                        <p className="font-mono font-bold">{node.degree}</p>
                        <p className="text-[11px] text-muted-foreground">degree</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-border bg-card/5 p-4">
              <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground mb-4">Recent Errors</h3>
              {activeStatus.recentErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent graph errors.</p>
              ) : (
                <div className="space-y-3">
                  {activeStatus.recentErrors.slice(0, 5).map((error) => (
                    <div key={`${error.code}:${error.timestamp}`} className="border border-border bg-card/20 p-3">
                      <p className="text-xs font-mono font-bold">{error.code}</p>
                      <p className="text-sm mt-1">{error.message}</p>
                      <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                        {error.source} • {new Date(error.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-card/5 ring-1 ring-border/45 p-5 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground">Graph Explorer</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Traverse adjacent edges and linked memories for a selected node. Scroll to zoom and drag to pan.
                </p>
              </div>
              {selectedNode ? (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Selected Node</p>
                  <p className="text-[11px] font-mono text-foreground mt-1">
                    {selectedNode.nodeType}:{selectedNode.nodeKey}
                  </p>
                </div>
              ) : null}
            </div>

            {!selectedNode ? (
              <p className="text-sm text-muted-foreground">
                Select a node from Top Nodes to start exploration.
              </p>
            ) : isExplorerLoading ? (
              <p className="text-sm text-muted-foreground">Loading graph neighborhood...</p>
            ) : explorerError ? (
              <p className="text-sm text-red-500">{explorerError}</p>
            ) : !explorerData || !graphCanvas ? (
              <p className="text-sm text-muted-foreground">No explorer data available.</p>
            ) : (
              <div className="grid xl:grid-cols-[2fr_1fr] gap-4">
                <div className="rounded-xl bg-card/15 ring-1 ring-border/35 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
                        Relationship Graph
                      </h4>
                      <p className="text-[11px] font-mono text-muted-foreground mt-1">
                        {graphCanvas.nodes.length} nodes • {graphCanvas.edges.length} edges • zoom {(graphViewport.scale * 100).toFixed(0)}%
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => zoomFromCenter(1 + GRAPH_ZOOM_STEP)}
                        className="h-8 min-w-8 px-2 rounded-md ring-1 ring-border/50 bg-card/40 text-xs font-bold hover:bg-card/70 transition-colors"
                        aria-label="Zoom in"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => zoomFromCenter(1 - GRAPH_ZOOM_STEP)}
                        className="h-8 min-w-8 px-2 rounded-md ring-1 ring-border/50 bg-card/40 text-xs font-bold hover:bg-card/70 transition-colors"
                        aria-label="Zoom out"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={resetViewport}
                        className="h-8 px-2 rounded-md ring-1 ring-border/50 bg-card/40 text-[10px] uppercase tracking-[0.12em] font-bold hover:bg-card/70 transition-colors"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] font-bold">
                    <span className="px-2 py-1 rounded-md bg-card/25 ring-1 ring-border/40 text-muted-foreground">
                      outbound {selectedNodeStats.outbound}
                    </span>
                    <span className="px-2 py-1 rounded-md bg-card/25 ring-1 ring-border/40 text-muted-foreground">
                      inbound {selectedNodeStats.inbound}
                    </span>
                    <span className="px-2 py-1 rounded-md bg-card/25 ring-1 ring-border/40 text-muted-foreground">
                      expiring {selectedNodeStats.expiring}
                    </span>
                    <span className="px-2 py-1 rounded-md bg-card/25 ring-1 ring-border/40 text-muted-foreground">
                      evidence links {selectedNodeStats.withEvidence}
                    </span>
                    <span className="px-2 py-1 rounded-md bg-card/25 ring-1 ring-border/40 text-muted-foreground">
                      linked memories {explorerData.memories.length}
                    </span>
                  </div>

                  {graphCanvas.edges.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-1 py-2">
                      No active edges for this node yet.
                    </p>
                  ) : (
                    <div
                      ref={graphViewportRef}
                      className={`relative overflow-hidden rounded-lg ring-1 ring-border/35 touch-none select-none bg-[radial-gradient(110%_100%_at_50%_0%,rgba(59,130,246,0.16),rgba(15,23,42,0.08)_44%,rgba(2,6,23,0.45))] ${
                        isPanning ? "cursor-grabbing" : "cursor-grab"
                      }`}
                      onWheel={handleGraphWheel}
                      onPointerDown={handleGraphPointerDown}
                      onPointerMove={handleGraphPointerMove}
                      onPointerUp={stopPanning}
                      onPointerCancel={stopPanning}
                      onPointerLeave={stopPanning}
                    >
                      <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="w-full h-[420px] sm:h-[500px]">
                        <defs>
                          <marker
                            id="graph-arrow-head"
                            markerWidth="8"
                            markerHeight="8"
                            refX="7"
                            refY="4"
                            orient="auto"
                            markerUnits="strokeWidth"
                          >
                            <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
                          </marker>
                        </defs>

                        <g transform={`translate(${graphViewport.x} ${graphViewport.y}) scale(${graphViewport.scale})`}>
                          {graphCanvas.edges.map((edge) => {
                            const isSelectedEdge = selectedEdge?.id === edge.id
                            const showEdgeLabel = isSelectedEdge || graphViewport.scale >= 0.92
                            return (
                              <g key={edge.id}>
                                <path
                                  d={edge.path}
                                  fill="none"
                                  stroke={isSelectedEdge ? "#f43f5e" : "#64748b"}
                                  strokeOpacity={isSelectedEdge ? 0.95 : 0.55}
                                  strokeWidth={isSelectedEdge ? 2.3 : 1.35}
                                  strokeDasharray={edge.expiresAt ? "5 4" : undefined}
                                  markerEnd="url(#graph-arrow-head)"
                                  className="cursor-pointer transition-all duration-200"
                                  onClick={() => setSelectedEdgeId(edge.id)}
                                >
                                  <title>{`${edge.from.nodeType}:${edge.from.nodeKey} -> ${edge.to.nodeType}:${edge.to.nodeKey} | ${edge.edgeType} | ${edge.direction} | weight ${edge.weight.toFixed(2)} | confidence ${edge.confidence.toFixed(2)}`}</title>
                                </path>
                                {showEdgeLabel ? (
                                  <text
                                    x={edge.labelX}
                                    y={edge.labelY}
                                    textAnchor="middle"
                                    fill={isSelectedEdge ? "#fda4af" : "#94a3b8"}
                                    fontSize={11}
                                    fontFamily="var(--font-geist-mono)"
                                    pointerEvents="none"
                                  >
                                    {edge.edgeType}
                                  </text>
                                ) : null}
                              </g>
                            )
                          })}

                          {graphCanvas.nodes.map((node) => {
                            const style = getNodeStyle(node.nodeType)
                            const radius = node.isSelected
                              ? 18
                              : Math.min(16, 10 + Math.log2((node.degree || 0) + 1) * 2.3)
                            const showLabel = node.isSelected || graphCanvas.nodes.length <= 14 || node.degree > 1

                            return (
                              <g
                                key={node.id}
                                className="cursor-pointer"
                                onClick={() =>
                                  setSelectedNode({
                                    nodeType: node.nodeType,
                                    nodeKey: node.nodeKey,
                                    label: node.label,
                                  })}
                              >
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r={radius + (node.isSelected ? 4 : 2)}
                                  fill="transparent"
                                  stroke={style.stroke}
                                  strokeOpacity={node.isSelected ? 0.55 : 0.22}
                                  strokeWidth={1}
                                />
                                <circle
                                  cx={node.x}
                                  cy={node.y}
                                  r={radius}
                                  fill={style.fill}
                                  stroke={style.stroke}
                                  strokeWidth={node.isSelected ? 2.3 : 1.4}
                                >
                                  <title>{`${node.nodeType}:${node.nodeKey} | label ${node.label} | degree ${node.degree}`}</title>
                                </circle>
                                {showLabel ? (
                                  <>
                                    <text
                                      x={node.x}
                                      y={node.y + radius + 14}
                                      textAnchor="middle"
                                      fill={style.text}
                                      fontSize={11}
                                      fontWeight={node.isSelected ? 700 : 600}
                                      fontFamily="var(--font-geist-mono)"
                                      pointerEvents="none"
                                    >
                                      {trimMiddle(formatNodeLabel(node), 24)}
                                    </text>
                                    <text
                                      x={node.x}
                                      y={node.y + radius + 28}
                                      textAnchor="middle"
                                      fill="#94a3b8"
                                      fontSize={9}
                                      fontFamily="var(--font-geist-mono)"
                                      pointerEvents="none"
                                    >
                                      {node.nodeType}
                                    </text>
                                  </>
                                ) : null}
                              </g>
                            )
                          })}
                        </g>
                      </svg>
                    </div>
                  )}

                  {graphCanvas.nodeTypes.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {graphCanvas.nodeTypes.map((nodeType) => {
                        const style = getNodeStyle(nodeType)
                        return (
                          <span
                            key={nodeType}
                            className="text-[10px] uppercase tracking-[0.16em] font-bold px-2 py-1 rounded-md ring-1"
                            style={{
                              boxShadow: `inset 0 0 0 1px ${style.stroke}`,
                              color: style.text,
                              background: style.fill,
                            }}
                          >
                            {nodeType}
                          </span>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl bg-card/15 ring-1 ring-border/35 p-4">
                    <h4 className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-3">
                      Selected Edge
                    </h4>
                    {!selectedEdge ? (
                      <p className="text-sm text-muted-foreground">Select an edge to inspect relationship metadata.</p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs font-mono">
                          {selectedEdge.from.nodeType}:{trimMiddle(selectedEdge.from.nodeKey, 24)}{" "}
                          <span className="text-muted-foreground">→</span>{" "}
                          {selectedEdge.to.nodeType}:{trimMiddle(selectedEdge.to.nodeKey, 24)}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                          <p className="text-muted-foreground">type</p>
                          <p>{selectedEdge.edgeType}</p>
                          <p className="text-muted-foreground">direction</p>
                          <p>{selectedEdge.direction}</p>
                          <p className="text-muted-foreground">weight</p>
                          <p>{selectedEdge.weight.toFixed(2)}</p>
                          <p className="text-muted-foreground">confidence</p>
                          <p>{selectedEdge.confidence.toFixed(2)}</p>
                          <p className="text-muted-foreground">expires</p>
                          <p>{selectedEdge.expiresAt ? new Date(selectedEdge.expiresAt).toLocaleString() : "never"}</p>
                          <p className="text-muted-foreground">evidence</p>
                          <p>{selectedEdge.evidenceMemoryId ?? "none"}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-card/15 ring-1 ring-border/35 p-4">
                    <h4 className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-3">
                      Relationships
                    </h4>
                    {graphCanvas.edges.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No relationships for this node.</p>
                    ) : (
                      <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
                        {graphCanvas.edges.map((edge) => {
                          const isActive = selectedEdge?.id === edge.id
                          return (
                            <button
                              key={edge.id}
                              type="button"
                              onClick={() => setSelectedEdgeId(edge.id)}
                              className={`w-full text-left rounded-lg p-2 transition-colors ring-1 ${
                                isActive
                                  ? "ring-primary/55 bg-primary/10"
                                  : "ring-border/30 bg-card/20 hover:bg-card/35"
                              }`}
                            >
                              <p className="text-[11px] font-mono">
                                {edge.edgeType} • {edge.direction}
                              </p>
                              <p className="text-[11px] text-muted-foreground font-mono mt-1">
                                {trimMiddle(edge.from.nodeKey, 18)} → {trimMiddle(edge.to.nodeKey, 18)}
                              </p>
                              <p className="text-[11px] text-muted-foreground font-mono mt-1">
                                w={edge.weight.toFixed(2)} c={edge.confidence.toFixed(2)}
                                {edge.expiresAt ? " • expiring" : ""}
                              </p>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-card/15 ring-1 ring-border/35 p-4">
                    <h4 className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-3">
                      Linked Memories
                    </h4>
                    {explorerData.memories.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No memory links for this node.</p>
                    ) : (
                      <div className="space-y-2 max-h-[330px] overflow-y-auto pr-1">
                        {explorerData.memories.slice(0, 20).map((memory) => {
                          const isEvidence = Boolean(
                            selectedEdge?.evidenceMemoryId &&
                              memory.memoryId === selectedEdge.evidenceMemoryId
                          )
                          return (
                            <div
                              key={`${memory.memoryId}:${memory.role}`}
                              className={`rounded-lg p-2 ring-1 ${
                                isEvidence
                                  ? "bg-primary/8 ring-primary/40"
                                  : "bg-card/20 ring-border/30"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-mono">
                                  {memory.type} • {memory.role}
                                </p>
                                {isEvidence ? (
                                  <span className="text-[10px] uppercase tracking-[0.12em] text-primary font-bold">
                                    edge evidence
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-sm mt-1">{truncateText(memory.content || "[memory not available]")}</p>
                              <p className="text-[11px] text-muted-foreground font-mono mt-1">
                                {memory.memoryId}
                                {memory.updatedAt ? ` • ${new Date(memory.updatedAt).toLocaleString()}` : ""}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
