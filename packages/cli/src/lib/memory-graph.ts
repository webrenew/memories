import type { Client } from "@libsql/client";
import { ensureGraphSchema, getDb } from "./db.js";
import { isGraphMappingEnabled } from "./env.js";

type GraphExecutor = Pick<Client, "execute">;
const graphWriteQueues = new WeakMap<Client, Promise<void>>();

async function withGraphWriteLock<T>(client: Client, operation: () => Promise<T>): Promise<T> {
  const previous = graphWriteQueues.get(client) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const settled = run.then(() => undefined, () => undefined);
  graphWriteQueues.set(client, settled);

  try {
    return await run;
  } finally {
    if (graphWriteQueues.get(client) === settled) {
      graphWriteQueues.delete(client);
    }
  }
}

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

async function pruneOrphanNodes(db: GraphExecutor): Promise<void> {
  await db.execute(
    `DELETE FROM graph_nodes
     WHERE id NOT IN (SELECT node_id FROM memory_node_links)
       AND id NOT IN (SELECT from_node_id FROM graph_edges)
       AND id NOT IN (SELECT to_node_id FROM graph_edges)`,
  );
}

async function removeMemoryGraphMappingWithDb(db: GraphExecutor, memoryId: string): Promise<void> {
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

async function loadCurrentMemoryGraphInput(
  db: GraphExecutor,
  memoryId: string,
): Promise<MemoryGraphInput | null> {
  const result = await db.execute({
    sql: `SELECT id, content, type, memory_layer, expires_at, project_id, user_id, tags, category
          FROM memories
          WHERE id = ? AND deleted_at IS NULL
          LIMIT 1`,
    args: [memoryId],
  });
  const row = result.rows[0];
  if (!row) return null;

  const type = String(row.type ?? "note");
  const rawLayer = row.memory_layer as string | null;
  const layer = rawLayer === "rule" || rawLayer === "working" || rawLayer === "long_term"
    ? rawLayer
    : type === "rule"
      ? "rule"
      : "long_term";

  return {
    id: String(row.id),
    content: String(row.content ?? ""),
    type,
    layer,
    expiresAt: (row.expires_at as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    tags: typeof row.tags === "string"
      ? row.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [],
    category: (row.category as string | null) ?? null,
  };
}

export async function syncMemoryGraphMapping(
  input: MemoryGraphInput,
  db?: Client,
): Promise<void> {
  if (!isGraphMappingEnabled()) return;
  const client = db ?? (await getDb());
  await ensureGraphSchema(client);
  return withGraphWriteLock(client, async () => {
    const transaction = await client.transaction("write");

    try {
      const currentInput = await loadCurrentMemoryGraphInput(transaction, input.id);
      await removeMemoryGraphMappingWithDb(transaction, input.id);

      if (!currentInput) {
        await pruneOrphanNodes(transaction);
        await transaction.commit();
        return;
      }

      const extracted = extractMemoryGraph(currentInput);
      const nowIso = new Date().toISOString();

      for (const node of extracted.nodes) {
        await transaction.execute({
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
        await transaction.execute({
          sql: `INSERT INTO memory_node_links (memory_id, node_id, role, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(memory_id, node_id, role) DO UPDATE SET created_at = excluded.created_at`,
          args: [currentInput.id, nodeId(link.node), link.role, nowIso],
        });
      }

      for (const edge of extracted.edges) {
        await transaction.execute({
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
            edgeId(currentInput.id, edge),
            nodeId(edge.from),
            nodeId(edge.to),
            edge.edgeType,
            currentInput.id,
            edge.expiresAt,
            nowIso,
            nowIso,
          ],
        });
      }

      await pruneOrphanNodes(transaction);
      await transaction.commit();
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original graph failure.
      }
      throw error;
    } finally {
      transaction.close();
    }
  });
}

export async function removeMemoryGraphMapping(
  memoryId: string,
  db?: Client,
): Promise<void> {
  if (!isGraphMappingEnabled()) return;
  const client = db ?? (await getDb());
  await ensureGraphSchema(client);
  return withGraphWriteLock(client, async () => {
    const transaction = await client.transaction("write");
    try {
      await removeMemoryGraphMappingWithDb(transaction, memoryId);
      await pruneOrphanNodes(transaction);
      await transaction.commit();
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original graph failure.
      }
      throw error;
    } finally {
      transaction.close();
    }
  });
}

export async function removeMemoryGraphMappings(
  memoryIds: string[],
  db?: Client,
): Promise<void> {
  if (!isGraphMappingEnabled()) return;
  const client = db ?? (await getDb());
  await ensureGraphSchema(client);
  return withGraphWriteLock(client, async () => {
    const transaction = await client.transaction("write");
    try {
      for (const memoryId of [...new Set(memoryIds.filter(Boolean))]) {
        await removeMemoryGraphMappingWithDb(transaction, memoryId);
      }
      await pruneOrphanNodes(transaction);
      await transaction.commit();
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original graph failure.
      }
      throw error;
    } finally {
      transaction.close();
    }
  });
}
