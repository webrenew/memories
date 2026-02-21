interface GraphUrlNodeSelection {
  nodeType: string
  nodeKey: string
  label: string
}

interface GraphUrlFilterState {
  edgeTypes: string[] | null
  nodeTypes: string[] | null
  minWeight: number
  minConfidence: number
  onlyEvidenceEdges: boolean
}

interface GraphUrlState {
  selectedNode: GraphUrlNodeSelection | null
  selectedEdgeId: string | null
  isFocusMode: boolean
  filters: GraphUrlFilterState
}

const NODE_TYPE_PARAM = "graph_node_type"
const NODE_KEY_PARAM = "graph_node_key"
const NODE_LABEL_PARAM = "graph_node_label"
const EDGE_ID_PARAM = "graph_edge_id"
const FOCUS_PARAM = "graph_focus"
const EDGE_TYPES_PARAM = "graph_et"
const NODE_TYPES_PARAM = "graph_nt"
const MIN_WEIGHT_PARAM = "graph_mw"
const MIN_CONFIDENCE_PARAM = "graph_mc"
const EVIDENCE_ONLY_PARAM = "graph_ev"

function parseListParam(value: string | null): string[] | null {
  if (!value) return null
  const values = value.split(",").map((item) => item.trim()).filter(Boolean)
  if (values.length === 0) return null
  return [...new Set(values)]
}

function parseNormalizedRatio(value: string | null): number {
  if (!value) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(1, parsed))
}

function toCompactRatioString(value: number): string {
  return Number(value.toFixed(2)).toString()
}

export function parseGraphUrlState(search: string): GraphUrlState {
  const params = new URLSearchParams(search)
  const nodeType = params.get(NODE_TYPE_PARAM)
  const nodeKey = params.get(NODE_KEY_PARAM)
  const nodeLabel = params.get(NODE_LABEL_PARAM)

  const selectedNode =
    nodeType && nodeKey
      ? {
          nodeType,
          nodeKey,
          label: nodeLabel || `${nodeType}:${nodeKey}`,
        }
      : null

  return {
    selectedNode,
    selectedEdgeId: params.get(EDGE_ID_PARAM),
    isFocusMode: params.get(FOCUS_PARAM) === "1",
    filters: {
      edgeTypes: parseListParam(params.get(EDGE_TYPES_PARAM)),
      nodeTypes: parseListParam(params.get(NODE_TYPES_PARAM)),
      minWeight: parseNormalizedRatio(params.get(MIN_WEIGHT_PARAM)),
      minConfidence: parseNormalizedRatio(params.get(MIN_CONFIDENCE_PARAM)),
      onlyEvidenceEdges: params.get(EVIDENCE_ONLY_PARAM) === "1",
    },
  }
}

export function applyGraphUrlState(url: URL, state: GraphUrlState): void {
  if (state.selectedNode) {
    url.searchParams.set(NODE_TYPE_PARAM, state.selectedNode.nodeType)
    url.searchParams.set(NODE_KEY_PARAM, state.selectedNode.nodeKey)
    url.searchParams.set(NODE_LABEL_PARAM, state.selectedNode.label)
  } else {
    url.searchParams.delete(NODE_TYPE_PARAM)
    url.searchParams.delete(NODE_KEY_PARAM)
    url.searchParams.delete(NODE_LABEL_PARAM)
  }

  if (state.selectedEdgeId) {
    url.searchParams.set(EDGE_ID_PARAM, state.selectedEdgeId)
  } else {
    url.searchParams.delete(EDGE_ID_PARAM)
  }

  if (state.isFocusMode) {
    url.searchParams.set(FOCUS_PARAM, "1")
  } else {
    url.searchParams.delete(FOCUS_PARAM)
  }

  if (state.filters.edgeTypes && state.filters.edgeTypes.length > 0) {
    url.searchParams.set(EDGE_TYPES_PARAM, state.filters.edgeTypes.join(","))
  } else {
    url.searchParams.delete(EDGE_TYPES_PARAM)
  }

  if (state.filters.nodeTypes && state.filters.nodeTypes.length > 0) {
    url.searchParams.set(NODE_TYPES_PARAM, state.filters.nodeTypes.join(","))
  } else {
    url.searchParams.delete(NODE_TYPES_PARAM)
  }

  if (state.filters.minWeight > 0) {
    url.searchParams.set(MIN_WEIGHT_PARAM, toCompactRatioString(state.filters.minWeight))
  } else {
    url.searchParams.delete(MIN_WEIGHT_PARAM)
  }

  if (state.filters.minConfidence > 0) {
    url.searchParams.set(MIN_CONFIDENCE_PARAM, toCompactRatioString(state.filters.minConfidence))
  } else {
    url.searchParams.delete(MIN_CONFIDENCE_PARAM)
  }

  if (state.filters.onlyEvidenceEdges) {
    url.searchParams.set(EVIDENCE_ONLY_PARAM, "1")
  } else {
    url.searchParams.delete(EVIDENCE_ONLY_PARAM)
  }
}

export function graphUrlToRelativePath(url: URL): string {
  const query = url.searchParams.toString()
  return query ? `${url.pathname}?${query}${url.hash}` : `${url.pathname}${url.hash}`
}
