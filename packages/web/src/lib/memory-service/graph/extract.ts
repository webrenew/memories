import type { MemoryLayer } from "../types"

export interface GraphMemorySnapshot {
  id: string
  content?: string | null
  type: string
  layer: MemoryLayer
  expiresAt: string | null
  projectId: string | null
  userId: string | null
  tags: string[]
  category: string | null
}

export interface GraphNodeRef {
  nodeType: string
  nodeKey: string
}

interface GraphNodeCandidate {
  nodeType: string
  nodeKey: string
  label: string
  metadata: Record<string, unknown> | null
}

interface GraphEdgeCandidate {
  from: GraphNodeRef
  to: GraphNodeRef
  edgeType: string
  weight: number
  confidence: number
  expiresAt: string | null
}

interface GraphLinkCandidate {
  node: GraphNodeRef
  role: string
}

interface DeterministicGraphExtract {
  nodes: GraphNodeCandidate[]
  edges: GraphEdgeCandidate[]
  links: GraphLinkCandidate[]
}

function normalizeText(value: string): string {
  return value.trim()
}

function truncateLabel(value: string, maxLength = 120): string {
  const normalized = normalizeText(value)
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trim()}...`
}

function normalizeTag(tag: string): string {
  return normalizeText(tag).toLowerCase()
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const rawTag of tags) {
    const tag = normalizeTag(rawTag)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    deduped.push(tag)
  }

  return deduped
}

export function extractDeterministicGraph(snapshot: GraphMemorySnapshot): DeterministicGraphExtract {
  const nodes = new Map<string, GraphNodeCandidate>()
  const links = new Map<string, GraphLinkCandidate>()
  const edges = new Map<string, GraphEdgeCandidate>()

  const edgeExpiresAt = snapshot.layer === "working" ? snapshot.expiresAt : null

  const nodeRefKey = (nodeType: string, nodeKey: string) => `${nodeType}:${nodeKey}`

  function addNode(
    nodeType: string,
    nodeKey: string,
    label: string,
    metadata: Record<string, unknown> | null = null
  ): GraphNodeRef {
    const normalizedType = normalizeText(nodeType)
    const normalizedKey = normalizeText(nodeKey)
    const refKey = nodeRefKey(normalizedType, normalizedKey)

    if (!nodes.has(refKey)) {
      nodes.set(refKey, {
        nodeType: normalizedType,
        nodeKey: normalizedKey,
        label: normalizeText(label),
        metadata,
      })
    }

    return {
      nodeType: normalizedType,
      nodeKey: normalizedKey,
    }
  }

  function addLink(node: GraphNodeRef, role: string): void {
    const key = `${node.nodeType}:${node.nodeKey}:${role}`
    if (!links.has(key)) {
      links.set(key, { node, role })
    }
  }

  function addEdge(from: GraphNodeRef, to: GraphNodeRef, edgeType: string): void {
    const key = `${from.nodeType}:${from.nodeKey}:${to.nodeType}:${to.nodeKey}:${edgeType}`
    if (!edges.has(key)) {
      edges.set(key, {
        from,
        to,
        edgeType,
        weight: 1,
        confidence: 1,
        expiresAt: edgeExpiresAt,
      })
    }
  }

  const memoryNode = addNode("memory", snapshot.id, truncateLabel(snapshot.content ?? "") || snapshot.id, {
    memoryId: snapshot.id,
    type: snapshot.type,
    layer: snapshot.layer,
    scope: snapshot.projectId ? "project" : "global",
    projectId: snapshot.projectId,
    userId: snapshot.userId,
  })
  addLink(memoryNode, "self")

  const typeNode = addNode("memory_type", snapshot.type, snapshot.type, null)
  addLink(typeNode, "type")

  const repoNode = snapshot.projectId
    ? addNode("repo", snapshot.projectId, snapshot.projectId.split("/").pop() || snapshot.projectId, {
        projectId: snapshot.projectId,
      })
    : null
  if (repoNode) addLink(repoNode, "scope")

  const userNode = snapshot.userId
    ? addNode("user", snapshot.userId, snapshot.userId, {
        userId: snapshot.userId,
      })
    : null
  if (userNode) addLink(userNode, "subject")

  const categoryNode = snapshot.category
    ? addNode("category", snapshot.category.toLowerCase(), snapshot.category, {
        category: snapshot.category,
      })
    : null
  if (categoryNode) addLink(categoryNode, "category")

  const tagNodes = dedupeTags(snapshot.tags).map((tag) =>
    addNode("topic", tag, tag, {
      tag,
    })
  )

  for (const tagNode of tagNodes) {
    addLink(tagNode, "tag")
  }

  if (repoNode && userNode) {
    addEdge(repoNode, userNode, "authored_by")
  }
  if (repoNode) {
    addEdge(repoNode, typeNode, "contains_type")
  }
  if (repoNode && categoryNode) {
    addEdge(repoNode, categoryNode, "about")
  }
  if (userNode && categoryNode) {
    addEdge(userNode, categoryNode, "about")
  }
  for (const tagNode of tagNodes) {
    if (repoNode) {
      addEdge(repoNode, tagNode, "about")
    }
    if (userNode) {
      addEdge(userNode, tagNode, "mentions")
    }
    if (categoryNode) {
      addEdge(categoryNode, tagNode, "related_to")
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    links: [...links.values()],
  }
}
