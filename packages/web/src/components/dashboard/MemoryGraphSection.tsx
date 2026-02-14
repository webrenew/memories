"use client"

import React, {
  type PointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { extractErrorMessage } from "@/lib/client-errors"
import { applyGraphUrlState, graphUrlToRelativePath, parseGraphUrlState } from "@/lib/graph-url-state"
import type { GraphStatusPayload } from "@/lib/memory-service/graph/status"
import {
  type GraphExplorerResponse,
  type GraphNodeSelection,
  type GraphRolloutMode,
  type GraphViewport,
  buildGraphCanvasModel,
  clamp,
  DEFAULT_GRAPH_VIEWPORT,
  formatNodeLabel,
  getNodeStyle,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  GRAPH_ZOOM_MAX,
  GRAPH_ZOOM_MIN,
  GRAPH_ZOOM_STEP,
  qualityStatusClass,
  qualityStatusLabel,
  ROLLOUT_MODES,
  severityClass,
  trimMiddle,
  truncateText,
} from "./memory-graph-helpers"

interface MemoryGraphSectionProps {
  status: GraphStatusPayload | null
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

export function MemoryGraphSection({ status }: MemoryGraphSectionProps): React.JSX.Element {
  const [localStatus, setLocalStatus] = useState(status)
  const [modeError, setModeError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNodeSelection | null>(null)
  const [explorerData, setExplorerData] = useState<GraphExplorerResponse | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [explorerError, setExplorerError] = useState<string | null>(null)
  const [isExplorerLoading, setIsExplorerLoading] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [urlHydrated, setUrlHydrated] = useState(false)
  const [edgeTypeFilter, setEdgeTypeFilter] = useState<string[]>([])
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string[]>([])
  const [minWeight, setMinWeight] = useState(0)
  const [minConfidence, setMinConfidence] = useState(0)
  const [onlyEvidenceEdges, setOnlyEvidenceEdges] = useState(false)
  const [graphViewport, setGraphViewport] = useState<GraphViewport>(DEFAULT_GRAPH_VIEWPORT)
  const [isPanning, setIsPanning] = useState(false)
  const [isPending, startTransition] = useTransition()
  const graphViewportRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null)
  const pendingEdgeIdFromUrlRef = useRef<string | null>(null)

  useEffect(() => {
    setLocalStatus(status)
  }, [status])

  useEffect(() => {
    if (typeof window === "undefined") return

    const urlState = parseGraphUrlState(window.location.search)

    if (urlState.selectedNode) {
      setSelectedNode(urlState.selectedNode)
    }

    if (urlState.selectedEdgeId) {
      pendingEdgeIdFromUrlRef.current = urlState.selectedEdgeId
      setSelectedEdgeId(urlState.selectedEdgeId)
    }

    setIsFocusMode(urlState.isFocusMode)

    setUrlHydrated(true)
  }, [])

  useEffect(() => {
    if (!urlHydrated) return

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
  }, [localStatus, selectedNode, urlHydrated])

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
            setExplorerError(
              extractErrorMessage(body, `Failed to load graph explorer data (HTTP ${response.status})`),
            )
            setExplorerData(null)
            setSelectedEdgeId(null)
          }
          return
        }

        if (!cancelled) {
          setExplorerData(body)
          const preferredEdgeId = pendingEdgeIdFromUrlRef.current
          const preferredExists = Boolean(
            preferredEdgeId && body.edges.some((edge) => edge.id === preferredEdgeId)
          )
          setSelectedEdgeId((current) => {
            if (preferredExists) return preferredEdgeId
            return body.edges.some((edge) => edge.id === current) ? current : (body.edges[0]?.id ?? null)
          })
          if (preferredExists) {
            pendingEdgeIdFromUrlRef.current = null
          }
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
  const edgeTypeOptions = useMemo(
    () =>
      graphCanvas
        ? [...new Set(graphCanvas.edges.map((edge) => edge.edgeType))].sort()
        : [],
    [graphCanvas]
  )
  const nodeTypeOptions = useMemo(() => graphCanvas?.nodeTypes ?? [], [graphCanvas])
  const filteredGraph = useMemo(() => {
    if (!graphCanvas) return null

    const allowedEdgeTypes =
      edgeTypeFilter.length > 0 ? new Set(edgeTypeFilter) : new Set(edgeTypeOptions)
    const allowedNodeTypes =
      nodeTypeFilter.length > 0 ? new Set(nodeTypeFilter) : new Set(nodeTypeOptions)

    const edges = graphCanvas.edges.filter((edge) => {
      if (!allowedEdgeTypes.has(edge.edgeType)) return false
      if (!allowedNodeTypes.has(edge.from.nodeType) || !allowedNodeTypes.has(edge.to.nodeType)) {
        return false
      }
      if (edge.weight < minWeight) return false
      if (edge.confidence < minConfidence) return false
      if (onlyEvidenceEdges && !edge.evidenceMemoryId) return false
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
  }, [
    edgeTypeFilter,
    edgeTypeOptions,
    graphCanvas,
    minConfidence,
    minWeight,
    nodeTypeFilter,
    nodeTypeOptions,
    onlyEvidenceEdges,
  ])
  const selectedEdge = useMemo(() => {
    if (!filteredGraph || filteredGraph.edges.length === 0) return null
    if (!selectedEdgeId) return filteredGraph.edges[0]
    return filteredGraph.edges.find((edge) => edge.id === selectedEdgeId) ?? filteredGraph.edges[0]
  }, [filteredGraph, selectedEdgeId])

  useEffect(() => {
    if (!graphCanvas) {
      setEdgeTypeFilter([])
      setNodeTypeFilter([])
      return
    }

    setEdgeTypeFilter((current) => {
      if (current.length === 0) return edgeTypeOptions
      const next = current.filter((edgeType) => edgeTypeOptions.includes(edgeType))
      return next.length > 0 ? next : edgeTypeOptions
    })

    setNodeTypeFilter((current) => {
      if (current.length === 0) return nodeTypeOptions
      const next = current.filter((nodeType) => nodeTypeOptions.includes(nodeType))
      return next.length > 0 ? next : nodeTypeOptions
    })
  }, [edgeTypeOptions, graphCanvas, nodeTypeOptions])

  useEffect(() => {
    if (!filteredGraph || filteredGraph.edges.length === 0) {
      if (selectedEdgeId !== null) {
        setSelectedEdgeId(null)
      }
      return
    }

    if (!filteredGraph.edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(filteredGraph.edges[0]?.id ?? null)
    }
  }, [filteredGraph, selectedEdgeId])

  useEffect(() => {
    if (!urlHydrated || typeof window === "undefined") return

    const nextUrl = new URL(window.location.href)
    applyGraphUrlState(nextUrl, {
      selectedNode,
      selectedEdgeId,
      isFocusMode,
    })

    const nextPath = graphUrlToRelativePath(nextUrl)
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextPath !== currentPath) {
      window.history.replaceState({}, "", nextPath)
    }
  }, [
    isFocusMode,
    selectedEdgeId,
    selectedNode,
    selectedNode?.label,
    selectedNode?.nodeKey,
    selectedNode?.nodeType,
    urlHydrated,
  ])

  const selectedNodeStats = useMemo(() => {
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
  }, [filteredGraph])

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

  const fitGraphToView = useCallback(() => {
    if (!filteredGraph || filteredGraph.nodes.length === 0) {
      resetViewport()
      return
    }

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const node of filteredGraph.nodes) {
      minX = Math.min(minX, node.x)
      maxX = Math.max(maxX, node.x)
      minY = Math.min(minY, node.y)
      maxY = Math.max(maxY, node.y)
    }

    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    const padding = 110
    const scaleX = GRAPH_WIDTH / (width + padding * 2)
    const scaleY = GRAPH_HEIGHT / (height + padding * 2)
    const scale = clamp(Math.min(scaleX, scaleY), GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    setGraphViewport({
      scale,
      x: GRAPH_WIDTH / 2 - centerX * scale,
      y: GRAPH_HEIGHT / 2 - centerY * scale,
    })
    setIsPanning(false)
    panStartRef.current = null
  }, [filteredGraph, resetViewport])

  useEffect(() => {
    fitGraphToView()
  }, [fitGraphToView, selectedNode?.nodeKey, selectedNode?.nodeType])

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

  const toggleEdgeType = useCallback(
    (edgeType: string) => {
      setEdgeTypeFilter((current) => {
        if (current.includes(edgeType)) {
          if (current.length <= 1) return current
          return current.filter((value) => value !== edgeType)
        }
        return [...current, edgeType]
      })
    },
    []
  )

  const toggleNodeType = useCallback(
    (nodeType: string) => {
      setNodeTypeFilter((current) => {
        if (current.includes(nodeType)) {
          if (current.length <= 1) return current
          return current.filter((value) => value !== nodeType)
        }
        return [...current, nodeType]
      })
    },
    []
  )

  const clearGraphFilters = useCallback(() => {
    setEdgeTypeFilter(edgeTypeOptions)
    setNodeTypeFilter(nodeTypeOptions)
    setMinWeight(0)
    setMinConfidence(0)
    setOnlyEvidenceEdges(false)
  }, [edgeTypeOptions, nodeTypeOptions])

  const miniMapViewport = useMemo(() => {
    if (!filteredGraph || filteredGraph.nodes.length === 0) return null

    const width = 172
    const height = 98
    const viewportWidth = GRAPH_WIDTH / graphViewport.scale
    const viewportHeight = GRAPH_HEIGHT / graphViewport.scale
    const rawViewportX = (-graphViewport.x) / graphViewport.scale
    const rawViewportY = (-graphViewport.y) / graphViewport.scale
    const maxViewportX = Math.max(0, GRAPH_WIDTH - viewportWidth)
    const maxViewportY = Math.max(0, GRAPH_HEIGHT - viewportHeight)

    const viewportX = clamp(rawViewportX, 0, maxViewportX)
    const viewportY = clamp(rawViewportY, 0, maxViewportY)

    return {
      width,
      height,
      viewportX,
      viewportY,
      viewportWidth,
      viewportHeight,
    }
  }, [filteredGraph, graphViewport.scale, graphViewport.x, graphViewport.y])

  const updateRolloutMode = (mode: GraphRolloutMode) => {
    if (!activeStatus || activeStatus.rollout.mode === mode) {
      return
    }

    if (mode === "canary" && activeStatus.qualityGate.canaryBlocked) {
      const blockingCodes = activeStatus.qualityGate.reasons
        .filter((reason) => reason.blocking)
        .map((reason) => reason.code)
      const message = blockingCodes.length > 0
        ? `Canary blocked by retrieval quality gate: ${blockingCodes.join(", ")}`
        : "Canary blocked by retrieval quality gate."
      setModeError(message)
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
          const body = await response.json().catch(() => null)
          if (!response.ok) {
            setModeError(
              extractErrorMessage(body, `Failed to update graph rollout mode (HTTP ${response.status})`),
            )
            return
          }

          const nextStatus =
            body && typeof body === "object"
              ? ((body as { status?: GraphStatusPayload }).status ?? undefined)
              : undefined
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
                const isCanaryBlocked =
                  mode.value === "canary" && activeStatus.qualityGate.canaryBlocked && !isActive
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => updateRolloutMode(mode.value)}
                    disabled={isPending || isActive || isCanaryBlocked}
                    className={`border p-3 text-left transition-colors ${
                      isActive
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-card/10 hover:bg-card/30"
                    } ${(isPending || isCanaryBlocked) ? "cursor-not-allowed opacity-70" : ""}`}
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.18em]">{mode.label}</p>
                    <p className="text-xs text-muted-foreground mt-2">{mode.description}</p>
                    {isCanaryBlocked ? (
                      <p className="mt-2 text-[11px] font-mono text-red-500">Blocked by quality gate</p>
                    ) : null}
                  </button>
                )
              })}
            </div>

            <div className="border border-border bg-card/10 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
                  Retrieval Quality Gate
                </p>
                <p
                  className={`text-[11px] font-mono font-bold ${qualityStatusClass(
                    activeStatus.qualityGate.status,
                    activeStatus.qualityGate.canaryBlocked
                  )}`}
                >
                  {activeStatus.qualityGate.canaryBlocked ? "BLOCKED" : qualityStatusLabel(activeStatus.qualityGate.status)}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">
                Window {activeStatus.qualityGate.windowHours}h • hybrid {activeStatus.qualityGate.current.hybridRequested} •
                canary {activeStatus.qualityGate.current.canaryApplied} • fallback{" "}
                {(activeStatus.qualityGate.current.fallbackRate * 100).toFixed(1)}%
              </p>
              {activeStatus.qualityGate.reasons.length > 0 ? (
                <div className="space-y-1">
                  {activeStatus.qualityGate.reasons.slice(0, 3).map((reason) => (
                    <p key={reason.code} className="text-[11px] text-muted-foreground">
                      <span className={`font-mono ${reason.blocking ? "text-red-500" : "text-amber-500"}`}>
                        {reason.code}
                      </span>{" "}
                      {reason.message}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No active quality regressions.</p>
              )}
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
              <div className="flex items-center gap-2">
                {selectedNode ? (
                  <div className="text-right mr-1">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Selected Node</p>
                    <p className="text-[11px] font-mono text-foreground mt-1">
                      {selectedNode.nodeType}:{selectedNode.nodeKey}
                    </p>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsFocusMode((current) => !current)}
                  className="h-8 px-2 rounded-md ring-1 ring-border/50 bg-card/40 text-[10px] uppercase tracking-[0.12em] font-bold hover:bg-card/70 transition-colors"
                >
                  {isFocusMode ? "Show Sidebar" : "Focus Graph"}
                </button>
              </div>
            </div>

            {!selectedNode ? (
              <p className="text-sm text-muted-foreground">
                Select a node from Top Nodes to start exploration.
              </p>
            ) : isExplorerLoading ? (
              <p className="text-sm text-muted-foreground">Loading graph neighborhood...</p>
            ) : explorerError ? (
              <p className="text-sm text-red-500">{explorerError}</p>
            ) : !explorerData || !graphCanvas || !filteredGraph ? (
              <p className="text-sm text-muted-foreground">No explorer data available.</p>
            ) : (
              <div className={`grid gap-4 ${isFocusMode ? "grid-cols-1" : "xl:grid-cols-[2fr_1fr]"}`}>
                <div className="rounded-xl bg-card/15 ring-1 ring-border/35 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-[11px] uppercase tracking-[0.18em] font-bold text-muted-foreground">
                        Relationship Graph
                      </h4>
                      <p className="text-[11px] font-mono text-muted-foreground mt-1">
                        {filteredGraph.nodes.length}/{graphCanvas.nodes.length} nodes •{" "}
                        {filteredGraph.edges.length}/{graphCanvas.edges.length} edges • zoom{" "}
                        {(graphViewport.scale * 100).toFixed(0)}%
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
                      <button
                        type="button"
                        onClick={fitGraphToView}
                        className="h-8 px-2 rounded-md ring-1 ring-border/50 bg-card/40 text-[10px] uppercase tracking-[0.12em] font-bold hover:bg-card/70 transition-colors"
                      >
                        Fit
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg bg-card/20 ring-1 ring-border/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
                        Filters
                      </p>
                      <button
                        type="button"
                        onClick={clearGraphFilters}
                        className="text-[10px] uppercase tracking-[0.12em] font-bold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        reset filters
                      </button>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2">
                        Edge Type
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {edgeTypeOptions.map((edgeType) => {
                          const active = edgeTypeFilter.includes(edgeType)
                          return (
                            <button
                              key={edgeType}
                              type="button"
                              onClick={() => toggleEdgeType(edgeType)}
                              className={`px-2 py-1 rounded-md ring-1 text-[10px] uppercase tracking-[0.12em] font-bold transition-colors ${
                                active
                                  ? "bg-primary/12 ring-primary/45 text-primary"
                                  : "bg-card/30 ring-border/35 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {edgeType}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-2">
                        Node Type
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {nodeTypeOptions.map((nodeType) => {
                          const active = nodeTypeFilter.includes(nodeType)
                          return (
                            <button
                              key={nodeType}
                              type="button"
                              onClick={() => toggleNodeType(nodeType)}
                              className={`px-2 py-1 rounded-md ring-1 text-[10px] uppercase tracking-[0.12em] font-bold transition-colors ${
                                active
                                  ? "bg-primary/12 ring-primary/45 text-primary"
                                  : "bg-card/30 ring-border/35 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {nodeType}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
                          Min Weight {minWeight.toFixed(2)}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={minWeight}
                          onChange={(event) => setMinWeight(Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
                          Min Confidence {minConfidence.toFixed(2)}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={minConfidence}
                          onChange={(event) => setMinConfidence(Number(event.target.value))}
                          className="w-full"
                        />
                      </label>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={onlyEvidenceEdges}
                        onChange={(event) => setOnlyEvidenceEdges(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border bg-background"
                      />
                      Only show edges with evidence memory
                    </label>
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

                  {filteredGraph.edges.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-1 py-2">
                      No relationships match the current filters.
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
                          {filteredGraph.edges.map((edge) => {
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

                          {filteredGraph.nodes.map((node) => {
                            const style = getNodeStyle(node.nodeType)
                            const radius = node.isSelected
                              ? 18
                              : Math.min(16, 10 + Math.log2((node.degree || 0) + 1) * 2.3)
                            const showLabel = node.isSelected || filteredGraph.nodes.length <= 14 || node.degree > 1

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

                      {miniMapViewport ? (
                        <div
                          className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-background/70 backdrop-blur-sm ring-1 ring-border/45 p-1.5"
                          style={{ width: miniMapViewport.width, height: miniMapViewport.height }}
                        >
                          <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="h-full w-full">
                            {filteredGraph.edges.map((edge) => (
                              <path
                                key={`mini-${edge.id}`}
                                d={edge.path}
                                fill="none"
                                stroke="#64748b"
                                strokeOpacity={0.5}
                                strokeWidth={2.2}
                              />
                            ))}
                            {filteredGraph.nodes.map((node) => (
                              <circle
                                key={`mini-node-${node.id}`}
                                cx={node.x}
                                cy={node.y}
                                r={node.isSelected ? 14 : 10}
                                fill={node.isSelected ? "#6366f1" : "#94a3b8"}
                                fillOpacity={node.isSelected ? 0.88 : 0.5}
                                stroke={node.isSelected ? "#e0e7ff" : "transparent"}
                                strokeWidth={node.isSelected ? 3.2 : 0}
                              />
                            ))}
                            <rect
                              x={miniMapViewport.viewportX}
                              y={miniMapViewport.viewportY}
                              width={miniMapViewport.viewportWidth}
                              height={miniMapViewport.viewportHeight}
                              fill="rgba(99,102,241,0.12)"
                              stroke="#818cf8"
                              strokeWidth={4}
                              rx={6}
                              ry={6}
                            />
                          </svg>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {filteredGraph.nodeTypes.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {filteredGraph.nodeTypes.map((nodeType) => {
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

                {!isFocusMode ? <div className="space-y-3">
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
                    {filteredGraph.edges.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No relationships for this node.</p>
                    ) : (
                      <div className="space-y-2 max-h-[210px] overflow-y-auto overflow-x-hidden scrollbar-ghost pr-0">
                        {filteredGraph.edges.map((edge) => {
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
                      <div className="space-y-2 max-h-[330px] overflow-y-auto overflow-x-hidden scrollbar-ghost pr-0">
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
                </div> : null}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
