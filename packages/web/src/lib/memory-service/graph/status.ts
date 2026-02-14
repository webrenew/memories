import {
  defaultLayerForType,
  GRAPH_LLM_EXTRACTION_ENABLED,
  GRAPH_MAPPING_ENABLED,
  GRAPH_RETRIEVAL_ENABLED,
  type MemoryLayer,
  type TursoClient,
} from "../types"
import {
  emptyGraphRolloutQualitySummary,
  evaluateGraphRolloutQuality,
  getGraphRolloutConfig,
  getGraphRolloutMetricsSummary,
  type GraphRolloutConfig,
  type GraphRolloutMetricsSummary,
  type GraphRolloutQualitySummary,
} from "./rollout"
import { removeMemoryGraphMapping, syncMemoryGraphMapping } from "./upsert"

interface GraphTopNodeRow {
  node_type: string
  node_key: string
  label: string
  memory_links: number
  outbound_edges: number
  inbound_edges: number
}

interface GraphSyncMemoryRow {
  id: string
  type: string
  memory_layer: string | null
  expires_at: string | null
  project_id: string | null
  user_id: string | null
  tags: string | null
  category: string | null
}

export interface GraphStatusTopNode {
  nodeType: string
  nodeKey: string
  label: string
  memoryLinks: number
  outboundEdges: number
  inboundEdges: number
  degree: number
}

export interface GraphStatusError {
  code: string
  message: string
  source: string
  timestamp: string
}

export interface GraphStatusAlarm {
  code: string
  severity: "info" | "warning" | "critical"
  message: string
  triggeredAt: string
}

export interface GraphStatusShadowMetrics {
  windowHours: number
  totalRequests: number
  hybridRequested: number
  canaryApplied: number
  shadowExecutions: number
  fallbackCount: number
  fallbackRate: number
  graphErrorFallbacks: number
  avgGraphCandidates: number
  avgGraphExpandedCount: number
  lastFallbackAt: string | null
  lastFallbackReason: string | null
}

export interface GraphStatusPayload {
  enabled: boolean
  flags: {
    mappingEnabled: boolean
    retrievalEnabled: boolean
    llmExtractionEnabled: boolean
  }
  health: "ok" | "schema_missing"
  tables: {
    graphNodes: boolean
    graphEdges: boolean
    memoryNodeLinks: boolean
  }
  counts: {
    nodes: number
    edges: number
    memoryLinks: number
    activeEdges: number
    expiredEdges: number
    orphanNodes: number
  }
  rollout: GraphRolloutConfig
  shadowMetrics: GraphStatusShadowMetrics
  qualityGate: GraphRolloutQualitySummary
  alarms: GraphStatusAlarm[]
  topConnectedNodes: GraphStatusTopNode[]
  recentErrors: GraphStatusError[]
  sampledAt: string
}

interface GraphStatusInput {
  turso: TursoClient
  nowIso: string
  topNodesLimit: number
  syncMappings?: boolean
}

const GRAPH_STATUS_SYNC_BATCH_LIMIT = 250

async function scalarCount(turso: TursoClient, sql: string, args: (string | number)[] = []): Promise<number> {
  const result = await turso.execute({ sql, args })
  return Number(result.rows[0]?.count ?? 0)
}

async function tableExists(turso: TursoClient, table: string): Promise<boolean> {
  return (
    (await scalarCount(
      turso,
      `SELECT COUNT(*) as count
       FROM sqlite_master
       WHERE type = 'table' AND name = ?`,
      [table]
    )) > 0
  )
}

function normalizeTopNodesLimit(value: number): number {
  if (!Number.isFinite(value)) return 10
  return Math.max(1, Math.min(Math.floor(value), 50))
}

function parseLayer(type: string, memoryLayer: string | null): MemoryLayer {
  if (memoryLayer === "rule" || memoryLayer === "working" || memoryLayer === "long_term") {
    return memoryLayer
  }
  return defaultLayerForType(type)
}

function parseTagList(tags: string | null): string[] {
  if (!tags) return []
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function isMissingDeletedAtColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return message.includes("no such column") && message.includes("deleted_at")
}

async function listUnmappedMemories(turso: TursoClient): Promise<GraphSyncMemoryRow[]> {
  const queryWithDeletedAt = {
    sql: `SELECT
            m.id,
            m.type,
            m.memory_layer,
            m.expires_at,
            m.project_id,
            m.user_id,
            m.tags,
            m.category
          FROM memories m
          WHERE m.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM memory_node_links l WHERE l.memory_id = m.id)
          ORDER BY m.updated_at DESC, m.created_at DESC
          LIMIT ?`,
    args: [GRAPH_STATUS_SYNC_BATCH_LIMIT],
  }

  try {
    const result = await turso.execute(queryWithDeletedAt)
    return result.rows as unknown as GraphSyncMemoryRow[]
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) throw error
  }

  const fallbackResult = await turso.execute({
    sql: `SELECT
            m.id,
            m.type,
            m.memory_layer,
            m.expires_at,
            m.project_id,
            m.user_id,
            m.tags,
            m.category
          FROM memories m
          WHERE NOT EXISTS (SELECT 1 FROM memory_node_links l WHERE l.memory_id = m.id)
          ORDER BY m.updated_at DESC, m.created_at DESC
          LIMIT ?`,
    args: [GRAPH_STATUS_SYNC_BATCH_LIMIT],
  })

  return fallbackResult.rows as unknown as GraphSyncMemoryRow[]
}

async function listStaleLinkedMemoryIds(turso: TursoClient): Promise<string[]> {
  const queryWithDeletedAt = {
    sql: `SELECT DISTINCT l.memory_id
          FROM memory_node_links l
          LEFT JOIN memories m ON m.id = l.memory_id
          WHERE m.id IS NULL OR m.deleted_at IS NOT NULL
          LIMIT ?`,
    args: [GRAPH_STATUS_SYNC_BATCH_LIMIT],
  }

  try {
    const result = await turso.execute(queryWithDeletedAt)
    return result.rows
      .map((row) => row.memory_id as string | null)
      .filter((id): id is string => Boolean(id))
  } catch (error) {
    if (!isMissingDeletedAtColumnError(error)) throw error
  }

  const fallbackResult = await turso.execute({
    sql: `SELECT DISTINCT l.memory_id
          FROM memory_node_links l
          LEFT JOIN memories m ON m.id = l.memory_id
          WHERE m.id IS NULL
          LIMIT ?`,
    args: [GRAPH_STATUS_SYNC_BATCH_LIMIT],
  })

  return fallbackResult.rows
    .map((row) => row.memory_id as string | null)
    .filter((id): id is string => Boolean(id))
}

async function opportunisticGraphSync(
  turso: TursoClient,
  recentErrors: GraphStatusError[]
): Promise<void> {
  if (!(await tableExists(turso, "memories"))) {
    return
  }

  let syncFailures = 0
  let cleanupFailures = 0

  const unmappedMemories = await listUnmappedMemories(turso)
  for (const row of unmappedMemories) {
    try {
      await syncMemoryGraphMapping(turso, {
        id: row.id,
        type: row.type,
        layer: parseLayer(row.type, row.memory_layer),
        expiresAt: row.expires_at,
        projectId: row.project_id,
        userId: row.user_id,
        tags: parseTagList(row.tags),
        category: row.category,
      })
    } catch (error) {
      syncFailures += 1
      console.error("Failed opportunistic graph sync for memory:", row.id, error)
    }
  }

  const staleLinkedMemoryIds = await listStaleLinkedMemoryIds(turso)
  for (const memoryId of staleLinkedMemoryIds) {
    try {
      await removeMemoryGraphMapping(turso, memoryId)
    } catch (error) {
      cleanupFailures += 1
      console.error("Failed opportunistic graph cleanup for memory:", memoryId, error)
    }
  }

  if (syncFailures > 0) {
    recentErrors.push({
      code: "GRAPH_MAPPING_SYNC_FAILED",
      message: `${syncFailures} memory mapping sync operation${syncFailures === 1 ? "" : "s"} failed.`,
      source: "mapping",
      timestamp: new Date().toISOString(),
    })
  }

  if (cleanupFailures > 0) {
    recentErrors.push({
      code: "GRAPH_MAPPING_CLEANUP_FAILED",
      message: `${cleanupFailures} stale graph mapping cleanup operation${cleanupFailures === 1 ? "" : "s"} failed.`,
      source: "mapping",
      timestamp: new Date().toISOString(),
    })
  }
}

export async function getGraphStatusPayload(input: GraphStatusInput): Promise<GraphStatusPayload> {
  const { turso, nowIso } = input
  const topNodesLimit = normalizeTopNodesLimit(input.topNodesLimit)
  const syncMappings = input.syncMappings ?? true
  const flags = {
    mappingEnabled: GRAPH_MAPPING_ENABLED,
    retrievalEnabled: GRAPH_RETRIEVAL_ENABLED,
    llmExtractionEnabled: GRAPH_LLM_EXTRACTION_ENABLED,
  }
  const enabled = flags.mappingEnabled || flags.retrievalEnabled || flags.llmExtractionEnabled

  const tables = {
    graphNodes: await tableExists(turso, "graph_nodes"),
    graphEdges: await tableExists(turso, "graph_edges"),
    memoryNodeLinks: await tableExists(turso, "memory_node_links"),
  }
  const recentErrors: GraphStatusError[] = []
  let rollout: GraphRolloutConfig = {
    mode: GRAPH_RETRIEVAL_ENABLED ? "canary" : "off",
    updatedAt: nowIso,
    updatedBy: null,
  }
  let shadowMetrics: GraphRolloutMetricsSummary = {
    windowHours: 24,
    totalRequests: 0,
    hybridRequested: 0,
    canaryApplied: 0,
    shadowExecutions: 0,
    fallbackCount: 0,
    fallbackRate: 0,
    graphErrorFallbacks: 0,
    avgGraphCandidates: 0,
    avgGraphExpandedCount: 0,
    lastFallbackAt: null,
    lastFallbackReason: null,
  }
  let qualityGate = emptyGraphRolloutQualitySummary({
    nowIso,
    windowHours: 24,
  })
  const alarms: GraphStatusAlarm[] = []

  try {
    rollout = await getGraphRolloutConfig(turso, nowIso)
    shadowMetrics = await getGraphRolloutMetricsSummary(turso, {
      nowIso,
      windowHours: 24,
    })
    qualityGate = await evaluateGraphRolloutQuality(turso, {
      nowIso,
      windowHours: 24,
    })
  } catch (err) {
    recentErrors.push({
      code: "GRAPH_ROLLOUT_STATE_UNAVAILABLE",
      message: "Could not load graph rollout controls, metrics, or quality gate.",
      source: "rollout",
      timestamp: nowIso,
    })
    console.error("Failed to load graph rollout status:", err)
  }

  if (shadowMetrics.totalRequests >= 20 && shadowMetrics.fallbackRate >= 0.15) {
    alarms.push({
      code: "HIGH_FALLBACK_RATE",
      severity: "critical",
      message: `Fallback rate is ${(shadowMetrics.fallbackRate * 100).toFixed(1)}% over last ${shadowMetrics.windowHours}h.`,
      triggeredAt: nowIso,
    })
  } else if (shadowMetrics.totalRequests >= 10 && shadowMetrics.fallbackRate >= 0.05) {
    alarms.push({
      code: "ELEVATED_FALLBACK_RATE",
      severity: "warning",
      message: `Fallback rate is ${(shadowMetrics.fallbackRate * 100).toFixed(1)}% over last ${shadowMetrics.windowHours}h.`,
      triggeredAt: nowIso,
    })
  }

  if (shadowMetrics.graphErrorFallbacks >= 3) {
    alarms.push({
      code: "GRAPH_EXPANSION_ERRORS",
      severity: "critical",
      message: `${shadowMetrics.graphErrorFallbacks} graph expansion error fallback${shadowMetrics.graphErrorFallbacks === 1 ? "" : "s"} in last ${shadowMetrics.windowHours}h.`,
      triggeredAt: nowIso,
    })
  }

  if (qualityGate.canaryBlocked) {
    const reasonSummary = qualityGate.reasons
      .filter((reason) => reason.blocking)
      .map((reason) => reason.code)
      .slice(0, 3)
      .join(", ")
    alarms.push({
      code: "CANARY_QUALITY_GATE_BLOCKED",
      severity: "critical",
      message: reasonSummary
        ? `Canary rollout blocked by retrieval quality gate (${reasonSummary}).`
        : "Canary rollout blocked by retrieval quality gate.",
      triggeredAt: nowIso,
    })
  } else if (qualityGate.status === "warn") {
    alarms.push({
      code: "CANARY_QUALITY_GATE_WARNING",
      severity: "warning",
      message: "Retrieval quality gate detected warning-level drift; monitor before enabling canary.",
      triggeredAt: nowIso,
    })
  }

  const hasSchema = tables.graphNodes && tables.graphEdges && tables.memoryNodeLinks

  if (!hasSchema) {
    recentErrors.push({
      code: "GRAPH_SCHEMA_MISSING",
      message: "Graph tables are missing in this workspace database.",
      source: "schema",
      timestamp: nowIso,
    })
    return {
      enabled,
      flags,
      health: "schema_missing",
      tables,
      counts: {
        nodes: 0,
        edges: 0,
        memoryLinks: 0,
        activeEdges: 0,
        expiredEdges: 0,
        orphanNodes: 0,
      },
      rollout,
      shadowMetrics,
      qualityGate,
      alarms,
      topConnectedNodes: [],
      recentErrors,
      sampledAt: nowIso,
    }
  }

  if (syncMappings) {
    try {
      await opportunisticGraphSync(turso, recentErrors)
    } catch (error) {
      recentErrors.push({
        code: "GRAPH_MAPPING_SYNC_UNAVAILABLE",
        message: "Graph mapping sync did not complete for this status sample.",
        source: "mapping",
        timestamp: nowIso,
      })
      console.error("Failed opportunistic graph sync:", error)
    }
  }

  const [nodes, edges, memoryLinks, activeEdges, expiredEdges, orphanNodes, topNodesResult] = await Promise.all([
    scalarCount(turso, "SELECT COUNT(*) as count FROM graph_nodes"),
    scalarCount(turso, "SELECT COUNT(*) as count FROM graph_edges"),
    scalarCount(turso, "SELECT COUNT(*) as count FROM memory_node_links"),
    scalarCount(
      turso,
      "SELECT COUNT(*) as count FROM graph_edges WHERE expires_at IS NULL OR expires_at > ?",
      [nowIso]
    ),
    scalarCount(
      turso,
      "SELECT COUNT(*) as count FROM graph_edges WHERE expires_at IS NOT NULL AND expires_at <= ?",
      [nowIso]
    ),
    scalarCount(
      turso,
      `SELECT COUNT(*) as count
       FROM graph_nodes n
       WHERE NOT EXISTS (SELECT 1 FROM memory_node_links l WHERE l.node_id = n.id)
         AND NOT EXISTS (
           SELECT 1 FROM graph_edges e
           WHERE (e.from_node_id = n.id OR e.to_node_id = n.id)
             AND (e.expires_at IS NULL OR e.expires_at > ?)
         )`,
      [nowIso]
    ),
    turso.execute({
      sql: `SELECT
              n.node_type,
              n.node_key,
              n.label,
              (SELECT COUNT(*) FROM memory_node_links l WHERE l.node_id = n.id) AS memory_links,
              (SELECT COUNT(*) FROM graph_edges e WHERE e.from_node_id = n.id AND (e.expires_at IS NULL OR e.expires_at > ?)) AS outbound_edges,
              (SELECT COUNT(*) FROM graph_edges e WHERE e.to_node_id = n.id AND (e.expires_at IS NULL OR e.expires_at > ?)) AS inbound_edges
            FROM graph_nodes n
            ORDER BY (memory_links + outbound_edges + inbound_edges) DESC, n.node_type ASC, n.node_key ASC
            LIMIT ?`,
      args: [nowIso, nowIso, topNodesLimit],
    }),
  ])

  const topConnectedNodes = (topNodesResult.rows as unknown as GraphTopNodeRow[]).map((row) => {
    const memoryLinksCount = Number(row.memory_links ?? 0)
    const outboundEdgesCount = Number(row.outbound_edges ?? 0)
    const inboundEdgesCount = Number(row.inbound_edges ?? 0)
    return {
      nodeType: row.node_type,
      nodeKey: row.node_key,
      label: row.label,
      memoryLinks: memoryLinksCount,
      outboundEdges: outboundEdgesCount,
      inboundEdges: inboundEdgesCount,
      degree: memoryLinksCount + outboundEdgesCount + inboundEdgesCount,
    }
  })

  if (orphanNodes > 0) {
    recentErrors.push({
      code: "ORPHAN_NODES_DETECTED",
      message: `${orphanNodes} orphan graph node${orphanNodes === 1 ? "" : "s"} detected.`,
      source: "consistency",
      timestamp: nowIso,
    })
  }

  if (expiredEdges > 0) {
    recentErrors.push({
      code: "EXPIRED_EDGES_PRESENT",
      message: `${expiredEdges} expired graph edge${expiredEdges === 1 ? "" : "s"} pending cleanup.`,
      source: "ttl",
      timestamp: nowIso,
    })
  }

  for (const alarm of alarms) {
    recentErrors.push({
      code: alarm.code,
      message: alarm.message,
      source: "alarm",
      timestamp: alarm.triggeredAt,
    })
  }

  return {
    enabled,
    flags,
    health: "ok",
    tables,
    counts: {
      nodes,
      edges,
      memoryLinks,
      activeEdges,
      expiredEdges,
      orphanNodes,
    },
    rollout,
    shadowMetrics,
    qualityGate,
    alarms,
    topConnectedNodes,
    recentErrors,
    sampledAt: nowIso,
  }
}
