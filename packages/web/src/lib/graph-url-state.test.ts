import { describe, expect, it } from "vitest"
import { applyGraphUrlState, graphUrlToRelativePath, parseGraphUrlState } from "./graph-url-state"

describe("graph-url-state", () => {
  it("parses selected node, edge, and focus state from search params", () => {
    const state = parseGraphUrlState(
      "?graph_node_type=skill&graph_node_key=lint&graph_node_label=Lint+Skill&graph_edge_id=edge-1&graph_focus=1&graph_et=similar_to,contradicts&graph_nt=repo,topic&graph_mw=0.5&graph_mc=0.75&graph_ev=1",
    )

    expect(state).toEqual({
      selectedNode: {
        nodeType: "skill",
        nodeKey: "lint",
        label: "Lint Skill",
      },
      selectedEdgeId: "edge-1",
      isFocusMode: true,
      filters: {
        edgeTypes: ["similar_to", "contradicts"],
        nodeTypes: ["repo", "topic"],
        minWeight: 0.5,
        minConfidence: 0.75,
        onlyEvidenceEdges: true,
      },
    })
  })

  it("uses a deterministic fallback label when none is provided", () => {
    const state = parseGraphUrlState("?graph_node_type=repo&graph_node_key=memories")

    expect(state.selectedNode).toEqual({
      nodeType: "repo",
      nodeKey: "memories",
      label: "repo:memories",
    })
    expect(state.filters).toEqual({
      edgeTypes: null,
      nodeTypes: null,
      minWeight: 0,
      minConfidence: 0,
      onlyEvidenceEdges: false,
    })
  })

  it("normalizes invalid ratio filters to defaults", () => {
    const state = parseGraphUrlState("?graph_mw=-1&graph_mc=wat")
    expect(state.filters).toEqual({
      edgeTypes: null,
      nodeTypes: null,
      minWeight: 0,
      minConfidence: 0,
      onlyEvidenceEdges: false,
    })
  })

  it("writes graph state to URL and preserves unrelated params", () => {
    const url = new URL("https://example.com/app/graph-explorer?tab=overview#graph")

    applyGraphUrlState(url, {
      selectedNode: {
        nodeType: "repo",
        nodeKey: "github.com/memories",
        label: "Memories Repo",
      },
      selectedEdgeId: "edge-7",
      isFocusMode: true,
      filters: {
        edgeTypes: ["similar_to", "contradicts"],
        nodeTypes: ["repo", "topic"],
        minWeight: 0.5,
        minConfidence: 0.75,
        onlyEvidenceEdges: true,
      },
    })

    expect(graphUrlToRelativePath(url)).toBe(
      "/app/graph-explorer?tab=overview&graph_node_type=repo&graph_node_key=github.com%2Fmemories&graph_node_label=Memories+Repo&graph_edge_id=edge-7&graph_focus=1&graph_et=similar_to%2Ccontradicts&graph_nt=repo%2Ctopic&graph_mw=0.5&graph_mc=0.75&graph_ev=1#graph",
    )
  })

  it("clears graph params when state is reset", () => {
    const url = new URL(
      "https://example.com/app/graph-explorer?graph_node_type=repo&graph_node_key=memories&graph_node_label=Memories&graph_edge_id=e1&graph_focus=1&graph_et=similar_to&graph_nt=repo&graph_mw=0.4&graph_mc=0.3&graph_ev=1&tab=overview",
    )

    applyGraphUrlState(url, {
      selectedNode: null,
      selectedEdgeId: null,
      isFocusMode: false,
      filters: {
        edgeTypes: null,
        nodeTypes: null,
        minWeight: 0,
        minConfidence: 0,
        onlyEvidenceEdges: false,
      },
    })

    expect(graphUrlToRelativePath(url)).toBe("/app/graph-explorer?tab=overview")
  })
})
