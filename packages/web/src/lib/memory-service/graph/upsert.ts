import type { MemoryLayer, TursoClient } from "../types"
import { extractDeterministicGraph, type GraphMemorySnapshot, type GraphNodeRef } from "./extract"

interface GraphMemoryInput {
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

export interface GraphEdgeWrite {
  from: GraphNodeRef
  to: GraphNodeRef
  edgeType: string
  weight?: number
  confidence?: number
  evidenceMemoryId?: string | null
  expiresAt?: string | null
}

function nodeIdFallback(ref: GraphNodeRef): string {
  return `graph-node:${ref.nodeType}:${ref.nodeKey}`
}

function edgeId(memoryId: string, edgeType: string, fromNodeId: string, toNodeId: string): string {
  return `graph-edge:${memoryId}:${edgeType}:${fromNodeId}:${toNodeId}`
}

function edgeIdForNodes(edgeType: string, fromNodeId: string, toNodeId: string): string {
  return `graph-edge:${edgeType}:${fromNodeId}:${toNodeId}`
}

function toSnapshot(input: GraphMemoryInput): GraphMemorySnapshot {
  return {
    id: input.id,
    content: input.content,
    type: input.type,
    layer: input.layer,
    expiresAt: input.expiresAt,
    projectId: input.projectId,
    userId: input.userId,
    tags: input.tags,
    category: input.category,
  }
}

export async function ensureGraphTables(turso: TursoClient): Promise<void> {
  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      node_key TEXT NOT NULL,
      label TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
  await turso.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_type_key ON graph_nodes(node_type, node_key)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type)")

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 1.0,
      evidence_memory_id TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_edges_from_node_id ON graph_edges(from_node_id)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_edges_to_node_id ON graph_edges(to_node_id)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_edges_type_from_node_id ON graph_edges(edge_type, from_node_id)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_graph_edges_expires_at ON graph_edges(expires_at)")

  await turso.execute(
    `CREATE TABLE IF NOT EXISTS memory_node_links (
      memory_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (memory_id, node_id, role)
    )`
  )
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memory_node_links_node_id ON memory_node_links(node_id)")
  await turso.execute("CREATE INDEX IF NOT EXISTS idx_memory_node_links_memory_id ON memory_node_links(memory_id)")
}

async function resolveNodeId(turso: TursoClient, ref: GraphNodeRef): Promise<string | null> {
  const result = await turso.execute({
    sql: "SELECT id FROM graph_nodes WHERE node_type = ? AND node_key = ? LIMIT 1",
    args: [ref.nodeType, ref.nodeKey],
  })
  return (result.rows[0]?.id as string | undefined) ?? null
}

async function pruneOrphanGraphNodes(turso: TursoClient): Promise<void> {
  await turso.execute(
    `DELETE FROM graph_nodes
     WHERE id NOT IN (SELECT node_id FROM memory_node_links)
       AND id NOT IN (SELECT from_node_id FROM graph_edges)
       AND id NOT IN (SELECT to_node_id FROM graph_edges)`
  )
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ")
}

async function resolveMemoryNodeIds(turso: TursoClient, memoryIds: string[]): Promise<string[]> {
  if (memoryIds.length === 0) return []

  const ids = Array.from(new Set(memoryIds.filter(Boolean)))
  if (ids.length === 0) return []

  const result = await turso.execute({
    sql: `SELECT id
          FROM graph_nodes
          WHERE node_type = 'memory'
            AND node_key IN (${placeholders(ids.length)})`,
    args: ids,
  })

  return result.rows
    .map((row) => row.id as string | null)
    .filter((id): id is string => Boolean(id))
}

async function removeEdgesForNodeIds(turso: TursoClient, nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return

  const ids = Array.from(new Set(nodeIds.filter(Boolean)))
  if (ids.length === 0) return

  await turso.execute({
    sql: `DELETE FROM graph_edges
          WHERE from_node_id IN (${placeholders(ids.length)})
             OR to_node_id IN (${placeholders(ids.length)})`,
    args: [...ids, ...ids],
  })
}

export async function removeMemoryGraphMapping(turso: TursoClient, memoryId: string): Promise<void> {
  const memoryNodeIds = await resolveMemoryNodeIds(turso, [memoryId])

  await turso.execute({
    sql: "DELETE FROM memory_node_links WHERE memory_id = ?",
    args: [memoryId],
  })
  await turso.execute({
    sql: "DELETE FROM graph_edges WHERE evidence_memory_id = ?",
    args: [memoryId],
  })
  await removeEdgesForNodeIds(turso, memoryNodeIds)
  await pruneOrphanGraphNodes(turso)
}

const GRAPH_BATCH_SIZE = 200

export async function bulkRemoveMemoryGraphMappings(turso: TursoClient, memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return

  for (let i = 0; i < memoryIds.length; i += GRAPH_BATCH_SIZE) {
    const batch = memoryIds.slice(i, i + GRAPH_BATCH_SIZE)
    const memoryNodeIds = await resolveMemoryNodeIds(turso, batch)
    const marker = placeholders(batch.length)
    await turso.batch([
      { sql: `DELETE FROM memory_node_links WHERE memory_id IN (${marker})`, args: batch },
      { sql: `DELETE FROM graph_edges WHERE evidence_memory_id IN (${marker})`, args: batch },
    ])
    await removeEdgesForNodeIds(turso, memoryNodeIds)
  }

  await pruneOrphanGraphNodes(turso)
}

export async function upsertGraphEdges(
  turso: TursoClient,
  edges: GraphEdgeWrite[],
  options: { nowIso?: string } = {}
): Promise<void> {
  if (edges.length === 0) return
  await ensureGraphTables(turso)

  const nowIso = options.nowIso ?? new Date().toISOString()
  const nodeIdByRef = new Map<string, string>()
  const nodeRefs = new Map<string, GraphNodeRef>()

  for (const edge of edges) {
    const fromKey = `${edge.from.nodeType}:${edge.from.nodeKey}`
    const toKey = `${edge.to.nodeType}:${edge.to.nodeKey}`
    nodeRefs.set(fromKey, edge.from)
    nodeRefs.set(toKey, edge.to)
  }

  for (const [refKey, ref] of nodeRefs.entries()) {
    const resolved = await resolveNodeId(turso, ref)
    if (resolved) {
      nodeIdByRef.set(refKey, resolved)
    }
  }

  for (const edge of edges) {
    const fromKey = `${edge.from.nodeType}:${edge.from.nodeKey}`
    const toKey = `${edge.to.nodeType}:${edge.to.nodeKey}`
    const fromNodeId = nodeIdByRef.get(fromKey)
    const toNodeId = nodeIdByRef.get(toKey)
    if (!fromNodeId || !toNodeId) continue

    await turso.execute({
      sql: `INSERT INTO graph_edges (
              id,
              from_node_id,
              to_node_id,
              edge_type,
              weight,
              confidence,
              evidence_memory_id,
              expires_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              weight = excluded.weight,
              confidence = excluded.confidence,
              evidence_memory_id = excluded.evidence_memory_id,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at`,
      args: [
        edgeIdForNodes(edge.edgeType, fromNodeId, toNodeId),
        fromNodeId,
        toNodeId,
        edge.edgeType,
        edge.weight ?? 1,
        edge.confidence ?? 1,
        edge.evidenceMemoryId ?? null,
        edge.expiresAt ?? null,
        nowIso,
        nowIso,
      ],
    })
  }
}

export async function replaceMemorySimilarityEdges(
  turso: TursoClient,
  memoryId: string,
  edges: GraphEdgeWrite[],
  options: { nowIso?: string } = {}
): Promise<void> {
  await replaceMemoryRelationshipEdges(turso, memoryId, edges, {
    nowIso: options.nowIso,
    edgeTypes: ["similar_to"],
  })
}

export async function replaceMemoryRelationshipEdges(
  turso: TursoClient,
  memoryId: string,
  edges: GraphEdgeWrite[],
  options: { nowIso?: string; edgeTypes?: string[] } = {}
): Promise<void> {
  await ensureGraphTables(turso)
  const edgeTypes = Array.from(new Set((options.edgeTypes ?? []).map((value) => value.trim()).filter(Boolean)))
  const hasTypedDelete = edgeTypes.length > 0

  const memoryNodeIds = await resolveMemoryNodeIds(turso, [memoryId])
  if (memoryNodeIds.length > 0) {
    const typeMarkers = hasTypedDelete ? placeholders(edgeTypes.length) : ""
    const memoryMarkers = placeholders(memoryNodeIds.length)
    const edgeTypeFilter = hasTypedDelete ? `edge_type IN (${typeMarkers}) AND ` : ""
    await turso.execute({
      sql: `DELETE FROM graph_edges
            WHERE ${edgeTypeFilter}(from_node_id IN (${memoryMarkers})
                   OR to_node_id IN (${memoryMarkers}))`,
      args: [...edgeTypes, ...memoryNodeIds, ...memoryNodeIds],
    })
  }

  await upsertGraphEdges(turso, edges, options)
  await pruneOrphanGraphNodes(turso)
}

export async function syncMemoryGraphMapping(turso: TursoClient, input: GraphMemoryInput): Promise<void> {
  await ensureGraphTables(turso)
  await removeMemoryGraphMapping(turso, input.id)

  const nowIso = new Date().toISOString()
  const extracted = extractDeterministicGraph(toSnapshot(input))
  const nodeIds = new Map<string, string>()

  const nodeRefKey = (ref: GraphNodeRef) => `${ref.nodeType}:${ref.nodeKey}`

  for (const node of extracted.nodes) {
    const metadata = node.metadata ? JSON.stringify(node.metadata) : null
    await turso.execute({
      sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(node_type, node_key) DO UPDATE SET
              label = excluded.label,
              metadata = COALESCE(excluded.metadata, graph_nodes.metadata),
              updated_at = excluded.updated_at`,
      args: [nodeIdFallback(node), node.nodeType, node.nodeKey, node.label, metadata, nowIso, nowIso],
    })

    const resolved = await resolveNodeId(turso, node)
    if (resolved) {
      nodeIds.set(nodeRefKey(node), resolved)
    }
  }

  for (const link of extracted.links) {
    const nodeId = nodeIds.get(nodeRefKey(link.node))
    if (!nodeId) continue

    await turso.execute({
      sql: `INSERT INTO memory_node_links (memory_id, node_id, role, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(memory_id, node_id, role) DO UPDATE SET
              created_at = excluded.created_at`,
      args: [input.id, nodeId, link.role, nowIso],
    })
  }

  for (const edge of extracted.edges) {
    const fromNodeId = nodeIds.get(nodeRefKey(edge.from))
    const toNodeId = nodeIds.get(nodeRefKey(edge.to))
    if (!fromNodeId || !toNodeId) continue

    await turso.execute({
      sql: `INSERT INTO graph_edges (
              id,
              from_node_id,
              to_node_id,
              edge_type,
              weight,
              confidence,
              evidence_memory_id,
              expires_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              weight = excluded.weight,
              confidence = excluded.confidence,
              evidence_memory_id = excluded.evidence_memory_id,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at`,
      args: [
        edgeId(input.id, edge.edgeType, fromNodeId, toNodeId),
        fromNodeId,
        toNodeId,
        edge.edgeType,
        edge.weight,
        edge.confidence,
        input.id,
        edge.expiresAt,
        nowIso,
        nowIso,
      ],
    })
  }

  await pruneOrphanGraphNodes(turso)
}
