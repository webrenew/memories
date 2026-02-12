import { resolveActiveMemoryContext } from "@/lib/active-memory-context"
import { ensureMemoryUserIdSchema } from "@/lib/memory-service/scope"
import { createClient } from "@/lib/supabase/server"
import { createClient as createTurso } from "@libsql/client"
import { NextRequest, NextResponse } from "next/server"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const EMPTY_EXPLORER_PAYLOAD = {
  node: null,
  nodes: [],
  edges: [],
  memories: [],
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

async function graphSchemaExists(turso: ReturnType<typeof createTurso>): Promise<boolean> {
  const result = await turso.execute(
    `SELECT COUNT(*) as count
     FROM sqlite_master
     WHERE type = 'table'
       AND name IN ('graph_nodes', 'graph_edges', 'memory_node_links')`
  )
  return Number(result.rows[0]?.count ?? 0) === 3
}

async function resolveWorkspaceTurso() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const context = await resolveActiveMemoryContext(supabase, user.id)
  if (!context?.turso_db_url || !context?.turso_db_token) {
    return NextResponse.json({ error: "Turso not configured" }, { status: 400 })
  }

  return {
    schemaCacheKey: context.turso_db_name ?? context.turso_db_url,
    turso: createTurso({
      url: context.turso_db_url,
      authToken: context.turso_db_token,
    }),
  }
}

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveWorkspaceTurso()
    if (resolved instanceof NextResponse) return resolved
    const { turso, schemaCacheKey } = resolved

    try {
      await ensureMemoryUserIdSchema(turso, { cacheKey: schemaCacheKey })
    } catch (error) {
      console.warn("Graph explorer schema init skipped:", error)
    }

    if (!(await graphSchemaExists(turso))) {
      return NextResponse.json(EMPTY_EXPLORER_PAYLOAD)
    }

    const url = new URL(request.url)
    const nodeType = url.searchParams.get("nodeType")?.trim() ?? ""
    const nodeKey = url.searchParams.get("nodeKey")?.trim() ?? ""
    const limit = parseLimit(url.searchParams.get("limit"))

    if (!nodeType || !nodeKey) {
      const result = await turso.execute({
        sql: `SELECT
                n.node_type,
                n.node_key,
                n.label,
                (SELECT COUNT(*) FROM memory_node_links l WHERE l.node_id = n.id) AS memory_links,
                (SELECT COUNT(*) FROM graph_edges e WHERE e.from_node_id = n.id OR e.to_node_id = n.id) AS edge_count
              FROM graph_nodes n
              ORDER BY (memory_links + edge_count) DESC, n.node_type ASC, n.node_key ASC
              LIMIT ?`,
        args: [limit],
      })

      return NextResponse.json({
        node: null,
        nodes: result.rows.map((row) => ({
          nodeType: row.node_type as string,
          nodeKey: row.node_key as string,
          label: row.label as string,
          memoryLinks: Number(row.memory_links ?? 0),
          edgeCount: Number(row.edge_count ?? 0),
        })),
        edges: [],
        memories: [],
      })
    }

    const nodeResult = await turso.execute({
      sql: `SELECT id, node_type, node_key, label
            FROM graph_nodes
            WHERE node_type = ? AND node_key = ?
            LIMIT 1`,
      args: [nodeType, nodeKey],
    })
    const nodeRow = nodeResult.rows[0]
    if (!nodeRow) {
      return NextResponse.json(EMPTY_EXPLORER_PAYLOAD)
    }

    const nodeId = nodeRow.id as string
    const nowIso = new Date().toISOString()

    const [edgesResult, memoriesResult] = await Promise.all([
      turso.execute({
        sql: `SELECT
                e.id,
                e.edge_type,
                e.weight,
                e.confidence,
                e.expires_at,
                e.evidence_memory_id,
                from_n.node_type AS from_node_type,
                from_n.node_key AS from_node_key,
                from_n.label AS from_label,
                to_n.node_type AS to_node_type,
                to_n.node_key AS to_node_key,
                to_n.label AS to_label
              FROM graph_edges e
              JOIN graph_nodes from_n ON from_n.id = e.from_node_id
              JOIN graph_nodes to_n ON to_n.id = e.to_node_id
              WHERE (e.from_node_id = ? OR e.to_node_id = ?)
                AND (e.expires_at IS NULL OR e.expires_at > ?)
              ORDER BY e.updated_at DESC, e.created_at DESC
              LIMIT ?`,
        args: [nodeId, nodeId, nowIso, limit],
      }),
      turso.execute({
        sql: `SELECT
                l.memory_id,
                l.role,
                m.type,
                m.content,
                m.updated_at
              FROM memory_node_links l
              LEFT JOIN memories m ON m.id = l.memory_id AND m.deleted_at IS NULL
              WHERE l.node_id = ?
              ORDER BY l.created_at DESC
              LIMIT ?`,
        args: [nodeId, limit],
      }),
    ])

    return NextResponse.json({
      node: {
        nodeType: nodeRow.node_type as string,
        nodeKey: nodeRow.node_key as string,
        label: nodeRow.label as string,
      },
      nodes: [],
      edges: edgesResult.rows.map((row) => ({
        id: row.id as string,
        edgeType: row.edge_type as string,
        weight: Number(row.weight ?? 1),
        confidence: Number(row.confidence ?? 1),
        expiresAt: (row.expires_at as string | null) ?? null,
        evidenceMemoryId: (row.evidence_memory_id as string | null) ?? null,
        direction: (row.from_node_type as string) === nodeType && (row.from_node_key as string) === nodeKey
          ? "outbound"
          : "inbound",
        from: {
          nodeType: row.from_node_type as string,
          nodeKey: row.from_node_key as string,
          label: row.from_label as string,
        },
        to: {
          nodeType: row.to_node_type as string,
          nodeKey: row.to_node_key as string,
          label: row.to_label as string,
        },
      })),
      memories: memoriesResult.rows.map((row) => ({
        memoryId: row.memory_id as string,
        role: row.role as string,
        type: (row.type as string | null) ?? "unknown",
        content: (row.content as string | null) ?? "",
        updatedAt: (row.updated_at as string | null) ?? null,
      })),
    })
  } catch (error) {
    console.error("Failed to load graph exploration payload:", error)
    return NextResponse.json({ error: "Failed to load graph exploration payload" }, { status: 500 })
  }
}
