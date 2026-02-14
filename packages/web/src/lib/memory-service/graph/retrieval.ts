import type { TursoClient } from "../types"

interface NodeDetail {
  nodeType: string
  nodeKey: string
}

interface NodeReason {
  hopCount: number
  edgeType: string
  seedMemoryId: string
  score: number
}

interface CandidateScore extends NodeReason {
  memoryId: string
  linkedViaNode: string
}

export interface GraphExpansionReason {
  whyIncluded: "graph_expansion"
  linkedViaNode: string
  edgeType: string
  hopCount: number
  seedMemoryId: string
}

export interface GraphExpansionResult {
  memoryIds: string[]
  reasons: Map<string, GraphExpansionReason>
  totalCandidates: number
}

interface ExpandMemoryGraphParams {
  turso: TursoClient
  seedMemoryIds: string[]
  nowIso: string
  depth: 0 | 1 | 2
  limit: number
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ")
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function buildNodeLabel(nodeDetail: NodeDetail | undefined, fallbackNodeId: string): string {
  if (!nodeDetail) {
    return fallbackNodeId
  }
  return `${nodeDetail.nodeType}:${nodeDetail.nodeKey}`
}

export async function expandMemoryGraph(params: ExpandMemoryGraphParams): Promise<GraphExpansionResult> {
  const { turso, nowIso } = params
  const depth = params.depth
  const limit = Math.max(0, params.limit)
  const seedMemoryIds = Array.from(new Set(params.seedMemoryIds.filter(Boolean)))

  if (seedMemoryIds.length === 0 || depth <= 0 || limit === 0) {
    return { memoryIds: [], reasons: new Map(), totalCandidates: 0 }
  }

  const seedMemoryIdPlaceholders = placeholders(seedMemoryIds.length)
  const seedLinkResult = await turso.execute({
    sql: `SELECT l.memory_id, l.node_id, n.node_type, n.node_key
          FROM memory_node_links l
          JOIN graph_nodes n ON n.id = l.node_id
          WHERE l.memory_id IN (${seedMemoryIdPlaceholders})`,
    args: seedMemoryIds,
  })

  type SeedLinkRow = {
    memory_id: string
    node_id: string
    node_type: string
    node_key: string
  }

  const seedLinkRows = seedLinkResult.rows as unknown as SeedLinkRow[]
  if (seedLinkRows.length === 0) {
    return { memoryIds: [], reasons: new Map(), totalCandidates: 0 }
  }

  const nodeDetails = new Map<string, NodeDetail>()
  const nodeReasons = new Map<string, NodeReason>()
  let frontier = new Set<string>()

  for (const row of seedLinkRows) {
    nodeDetails.set(row.node_id, { nodeType: row.node_type, nodeKey: row.node_key })
    if (!nodeReasons.has(row.node_id)) {
      nodeReasons.set(row.node_id, {
        hopCount: 0,
        edgeType: "seed",
        seedMemoryId: row.memory_id,
        score: 1,
      })
      frontier.add(row.node_id)
    }
  }

  const edgeScanLimit = Math.max(200, limit * 50)

  for (let hop = 1; hop <= depth; hop += 1) {
    if (frontier.size === 0) {
      break
    }

    const frontierIds = [...frontier]
    frontier = new Set<string>()
    const frontierPlaceholders = placeholders(frontierIds.length)

    const edgeResult = await turso.execute({
      sql: `SELECT from_node_id, to_node_id, edge_type, weight, confidence
            FROM graph_edges
            WHERE (expires_at IS NULL OR expires_at > ?)
              AND (from_node_id IN (${frontierPlaceholders}) OR to_node_id IN (${frontierPlaceholders}))
            LIMIT ?`,
      args: [nowIso, ...frontierIds, ...frontierIds, edgeScanLimit],
    })

    type EdgeRow = {
      from_node_id: string
      to_node_id: string
      edge_type: string
      weight: number | null
      confidence: number | null
    }

    const edges = edgeResult.rows as unknown as EdgeRow[]
    const frontierLookup = new Set(frontierIds)

    for (const edge of edges) {
      const relatedPairs: Array<{ current: string; next: string }> = [
        { current: edge.from_node_id, next: edge.to_node_id },
        { current: edge.to_node_id, next: edge.from_node_id },
      ]

      for (const pair of relatedPairs) {
        if (!frontierLookup.has(pair.current)) {
          continue
        }

        const baseReason = nodeReasons.get(pair.current)
        if (!baseReason) {
          continue
        }

        const hopCount = baseReason.hopCount + 1
        if (hopCount > depth) {
          continue
        }

        const weight = toFiniteNumber(edge.weight, 1)
        const confidence = toFiniteNumber(edge.confidence, 1)
        const score = (weight * confidence) / Math.max(1, hopCount)
        const existing = nodeReasons.get(pair.next)
        const isBetter =
          !existing ||
          hopCount < existing.hopCount ||
          (hopCount === existing.hopCount && score > existing.score)

        if (!isBetter) {
          continue
        }

        nodeReasons.set(pair.next, {
          hopCount,
          edgeType: edge.edge_type || "related_to",
          seedMemoryId: baseReason.seedMemoryId,
          score,
        })

        if (hopCount < depth) {
          frontier.add(pair.next)
        }
      }
    }
  }

  const traversalNodeIds = [...nodeReasons.keys()]
  if (traversalNodeIds.length === 0) {
    return { memoryIds: [], reasons: new Map(), totalCandidates: 0 }
  }

  const traversalNodePlaceholders = placeholders(traversalNodeIds.length)
  const seedPlaceholders = placeholders(seedMemoryIds.length)

  const [nodeDetailsResult, candidateLinkResult] = await Promise.all([
    turso.execute({
      sql: `SELECT id, node_type, node_key
            FROM graph_nodes
            WHERE id IN (${traversalNodePlaceholders})`,
      args: traversalNodeIds,
    }),
    turso.execute({
      sql: `SELECT memory_id, node_id
            FROM memory_node_links
            WHERE node_id IN (${traversalNodePlaceholders})
              AND memory_id NOT IN (${seedPlaceholders})`,
      args: [...traversalNodeIds, ...seedMemoryIds],
    }),
  ])

  type NodeDetailRow = {
    id: string
    node_type: string
    node_key: string
  }

  const detailRows = nodeDetailsResult.rows as unknown as NodeDetailRow[]
  for (const row of detailRows) {
    nodeDetails.set(row.id, { nodeType: row.node_type, nodeKey: row.node_key })
  }

  type CandidateLinkRow = {
    memory_id: string
    node_id: string
  }

  const candidateRows = candidateLinkResult.rows as unknown as CandidateLinkRow[]
  const candidateScores = new Map<string, CandidateScore>()

  for (const row of candidateRows) {
    const nodeReason = nodeReasons.get(row.node_id)
    if (!nodeReason) {
      continue
    }

    const sharedNodeReason = nodeReason.hopCount === 0
    const hopCount = sharedNodeReason ? 1 : nodeReason.hopCount
    const edgeType = sharedNodeReason ? "shared_node" : nodeReason.edgeType
    const score = sharedNodeReason ? 1.5 : nodeReason.score
    const linkedViaNode = buildNodeLabel(nodeDetails.get(row.node_id), row.node_id)

    const candidate: CandidateScore = {
      memoryId: row.memory_id,
      linkedViaNode,
      edgeType,
      hopCount,
      seedMemoryId: nodeReason.seedMemoryId,
      score,
    }

    const existing = candidateScores.get(row.memory_id)
    const isBetter =
      !existing ||
      candidate.hopCount < existing.hopCount ||
      (candidate.hopCount === existing.hopCount && candidate.score > existing.score)

    if (isBetter) {
      candidateScores.set(row.memory_id, candidate)
    }
  }

  const rankedCandidates = [...candidateScores.values()].sort(
    (a, b) => b.score - a.score || a.hopCount - b.hopCount || a.memoryId.localeCompare(b.memoryId)
  )
  const selected = rankedCandidates.slice(0, limit)
  const reasons = new Map<string, GraphExpansionReason>()

  for (const candidate of selected) {
    reasons.set(candidate.memoryId, {
      whyIncluded: "graph_expansion",
      linkedViaNode: candidate.linkedViaNode,
      edgeType: candidate.edgeType,
      hopCount: candidate.hopCount,
      seedMemoryId: candidate.seedMemoryId,
    })
  }

  return {
    memoryIds: selected.map((entry) => entry.memoryId),
    reasons,
    totalCandidates: rankedCandidates.length,
  }
}
