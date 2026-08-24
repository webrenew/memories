import type { Client } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { ensureGraphSchema, getDb } from "./db.js";

export interface MemoryGraphInput {
  id: string;
  content: string;
  type: string;
  layer: "rule" | "working" | "long_term";
  expiresAt: string | null;
  projectId: string | null;
  userId: string | null;
  tags: string[];
  category: string | null;
}

interface GraphNodeRef {
  nodeType: string;
  nodeKey: string;
}

interface GraphNodeCandidate extends GraphNodeRef {
  label: string;
  metadata: Record<string, unknown> | null;
}

interface GraphLinkCandidate {
  node: GraphNodeRef;
  role: string;
}

interface GraphEdgeCandidate {
  from: GraphNodeRef;
  to: GraphNodeRef;
  edgeType: string;
  expiresAt: string | null;
}

function normalizeText(value: string): string {
  return value.trim();
}

function truncateLabel(value: string, maxLength = 120): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trim()}...`;
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawTag of tags) {
    const tag = normalizeText(rawTag).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }

  return normalized;
}

function extractMemoryGraph(input: MemoryGraphInput): {
  nodes: GraphNodeCandidate[];
  links: GraphLinkCandidate[];
  edges: GraphEdgeCandidate[];
} {
  const nodes = new Map<string, GraphNodeCandidate>();
  const links = new Map<string, GraphLinkCandidate>();
  const edges = new Map<string, GraphEdgeCandidate>();
  const edgeExpiresAt = input.layer === "working" ? input.expiresAt : null;

  function refKey(ref: GraphNodeRef): string {
    return `${ref.nodeType}:${ref.nodeKey}`;
  }

  function addNode(
    nodeType: string,
    nodeKey: string,
    label: string,
    metadata: Record<string, unknown> | null = null,
  ): GraphNodeRef {
    const ref = { nodeType: normalizeText(nodeType), nodeKey: normalizeText(nodeKey) };
    const key = refKey(ref);
    if (!nodes.has(key)) {
      nodes.set(key, { ...ref, label: normalizeText(label), metadata });
    }
    return ref;
  }

  function addLink(node: GraphNodeRef, role: string): void {
    const key = `${refKey(node)}:${role}`;
    if (!links.has(key)) links.set(key, { node, role });
  }

  function addEdge(from: GraphNodeRef, to: GraphNodeRef, edgeType: string): void {
    const key = `${refKey(from)}:${refKey(to)}:${edgeType}`;
    if (!edges.has(key)) {
      edges.set(key, { from, to, edgeType, expiresAt: edgeExpiresAt });
    }
  }

  const memoryNode = addNode("memory", input.id, truncateLabel(input.content) || input.id, {
    memoryId: input.id,
    type: input.type,
    layer: input.layer,
    scope: input.projectId ? "project" : "global",
    projectId: input.projectId,
    userId: input.userId,
  });
  addLink(memoryNode, "self");

  const typeNode = addNode("memory_type", input.type, input.type);
  addLink(typeNode, "type");

  const repoNode = input.projectId
    ? addNode("repo", input.projectId, input.projectId.split("/").pop() || input.projectId, {
        projectId: input.projectId,
      })
    : null;
  if (repoNode) addLink(repoNode, "scope");

  const userNode = input.userId
    ? addNode("user", input.userId, input.userId, { userId: input.userId })
    : null;
  if (userNode) addLink(userNode, "subject");

  const categoryNode = input.category
    ? addNode("category", input.category.toLowerCase(), input.category, { category: input.category })
    : null;
  if (categoryNode) addLink(categoryNode, "category");

  const tagNodes = dedupeTags(input.tags).map((tag) =>
    addNode("topic", tag, tag, { tag }),
  );
  for (const tagNode of tagNodes) addLink(tagNode, "tag");

  addEdge(memoryNode, typeNode, "typed_as");
  if (repoNode) addEdge(memoryNode, repoNode, "scoped_to");
  if (userNode) addEdge(memoryNode, userNode, "owned_by");
  if (categoryNode) addEdge(memoryNode, categoryNode, "categorized_as");
  for (const tagNode of tagNodes) addEdge(memoryNode, tagNode, "tagged_with");

  if (repoNode && userNode) addEdge(repoNode, userNode, "authored_by");
  if (repoNode) addEdge(repoNode, typeNode, "contains_type");
  if (repoNode && categoryNode) addEdge(repoNode, categoryNode, "about");
  if (userNode && categoryNode) addEdge(userNode, categoryNode, "about");
  for (const tagNode of tagNodes) {
    if (repoNode) addEdge(repoNode, tagNode, "about");
    if (userNode) addEdge(userNode, tagNode, "mentions");
    if (categoryNode) addEdge(categoryNode, tagNode, "related_to");
  }

  return {
    nodes: [...nodes.values()],
    links: [...links.values()],
    edges: [...edges.values()],
  };
}

function nodeId(ref: GraphNodeRef): string {
  return `graph-node:${ref.nodeType}:${ref.nodeKey}`;
}

function edgeId(memoryId: string, edge: GraphEdgeCandidate): string {
  return `graph-edge:${memoryId}:${edge.edgeType}:${nodeId(edge.from)}:${nodeId(edge.to)}`;
}

async function pruneOrphanNodes(db: Client): Promise<void> {
  await db.execute(
    `DELETE FROM graph_nodes
     WHERE id NOT IN (SELECT node_id FROM memory_node_links)
       AND id NOT IN (SELECT from_node_id FROM graph_edges)
       AND id NOT IN (SELECT to_node_id FROM graph_edges)`,
  );
}

async function removeMemoryGraphMappingWithDb(db: Client, memoryId: string): Promise<void> {
  const memoryNodes = await db.execute({
    sql: "SELECT id FROM graph_nodes WHERE node_type = 'memory' AND node_key = ?",
    args: [memoryId],
  });
  const memoryNodeIds = memoryNodes.rows
    .map((row) => row.id as string | null)
    .filter((id): id is string => Boolean(id));

  await db.execute({
    sql: "DELETE FROM memory_node_links WHERE memory_id = ?",
    args: [memoryId],
  });
  await db.execute({
    sql: "DELETE FROM graph_edges WHERE evidence_memory_id = ?",
    args: [memoryId],
  });

  for (const memoryNodeId of memoryNodeIds) {
    await db.execute({
      sql: "DELETE FROM graph_edges WHERE from_node_id = ? OR to_node_id = ?",
      args: [memoryNodeId, memoryNodeId],
    });
  }
}

export async function syncMemoryGraphMapping(
  input: MemoryGraphInput,
  db?: Client,
): Promise<void> {
  const client = db ?? (await getDb());
  await ensureGraphSchema(client);
  const savepoint = `graph_sync_${randomUUID().replace(/-/g, "")}`;
  await client.execute(`SAVEPOINT ${savepoint}`);

  try {
    await removeMemoryGraphMappingWithDb(client, input.id);
    const extracted = extractMemoryGraph(input);
    const nowIso = new Date().toISOString();

    for (const node of extracted.nodes) {
      await client.execute({
        sql: `INSERT INTO graph_nodes (id, node_type, node_key, label, metadata, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(node_type, node_key) DO UPDATE SET
                label = excluded.label,
                metadata = COALESCE(excluded.metadata, graph_nodes.metadata),
                updated_at = excluded.updated_at`,
        args: [
          nodeId(node),
          node.nodeType,
          node.nodeKey,
          node.label,
          node.metadata ? JSON.stringify(node.metadata) : null,
          nowIso,
          nowIso,
        ],
      });
    }

    for (const link of extracted.links) {
      await client.execute({
        sql: `INSERT INTO memory_node_links (memory_id, node_id, role, created_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(memory_id, node_id, role) DO UPDATE SET created_at = excluded.created_at`,
        args: [input.id, nodeId(link.node), link.role, nowIso],
      });
    }

    for (const edge of extracted.edges) {
      await client.execute({
        sql: `INSERT INTO graph_edges (
                id, from_node_id, to_node_id, edge_type, weight, confidence,
                evidence_memory_id, expires_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                weight = excluded.weight,
                confidence = excluded.confidence,
                evidence_memory_id = excluded.evidence_memory_id,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at`,
        args: [
          edgeId(input.id, edge),
          nodeId(edge.from),
          nodeId(edge.to),
          edge.edgeType,
          input.id,
          edge.expiresAt,
          nowIso,
          nowIso,
        ],
      });
    }

    await pruneOrphanNodes(client);
    await client.execute(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    try {
      await client.execute(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.execute(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {
      // Preserve the original graph failure.
    }
    throw error;
  }
}

export async function removeMemoryGraphMapping(
  memoryId: string,
  db?: Client,
): Promise<void> {
  const client = db ?? (await getDb());
  await ensureGraphSchema(client);
  await removeMemoryGraphMappingWithDb(client, memoryId);
  await pruneOrphanNodes(client);
}

export async function removeMemoryGraphMappings(
  memoryIds: string[],
  db?: Client,
): Promise<void> {
  const client = db ?? (await getDb());
  await ensureGraphSchema(client);
  for (const memoryId of [...new Set(memoryIds.filter(Boolean))]) {
    await removeMemoryGraphMappingWithDb(client, memoryId);
  }
  await pruneOrphanNodes(client);
}
