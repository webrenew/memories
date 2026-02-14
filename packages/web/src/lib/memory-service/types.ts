import { createClient as createTurso } from "@libsql/client"

// Re-export env-derived constants for backward compatibility with existing imports.
export {
  parsePositiveInt,
  parseBooleanFlag,
  MCP_WORKING_MEMORY_TTL_HOURS,
  MCP_WORKING_MEMORY_MAX_ITEMS_PER_USER,
  GRAPH_MAPPING_ENABLED,
  GRAPH_RETRIEVAL_ENABLED,
  GRAPH_LLM_EXTRACTION_ENABLED,
} from "@/lib/env"

export const DEFAULT_RESPONSE_SCHEMA_VERSION = "2026-02-10"

export type TursoClient = ReturnType<typeof createTurso>

export type ToolName =
  | "get_context"
  | "get_rules"
  | "add_memory"
  | "edit_memory"
  | "forget_memory"
  | "search_memories"
  | "list_memories"
  | "bulk_forget_memories"
  | "vacuum_memories"

export type ApiErrorType =
  | "auth_error"
  | "validation_error"
  | "rate_limit_error"
  | "not_found_error"
  | "tool_error"
  | "method_error"
  | "internal_error"
  | "unknown_error"

export interface ApiErrorDetail {
  type: ApiErrorType
  code: string
  message: string
  status: number
  retryable: boolean
  details?: Record<string, unknown>
}

export interface ToolResponseEnvelope<T extends Record<string, unknown>> {
  ok: boolean
  data: T | null
  error: ApiErrorDetail | null
  meta: {
    version: string
    tool: ToolName
    timestamp: string
  }
}

export type ToolStructuredContent<T extends Record<string, unknown>> = ToolResponseEnvelope<T> & T

export interface MemoryRow {
  id: string
  content: string
  type: string
  memory_layer: string | null
  expires_at: string | null
  scope: string
  project_id: string | null
  user_id: string | null
  tags: string | null
  paths: string | null
  category: string | null
  metadata: string | null
  created_at: string
  updated_at: string
}

export type MemoryLayer = "rule" | "working" | "long_term"
export type ContextRetrievalStrategy = "baseline" | "hybrid_graph"

export interface GraphExplainability {
  whyIncluded: "graph_expansion"
  linkedViaNode: string
  edgeType: string
  hopCount: number
  seedMemoryId: string
}

export interface ContextTrace {
  requestedStrategy: ContextRetrievalStrategy
  strategy: ContextRetrievalStrategy
  graphDepth: 0 | 1 | 2
  graphLimit: number
  rolloutMode: "off" | "shadow" | "canary"
  shadowExecuted: boolean
  qualityGateStatus: "pass" | "warn" | "fail" | "insufficient_data" | "unavailable"
  qualityGateBlocked: boolean
  qualityGateReasonCodes: string[]
  baselineCandidates: number
  graphCandidates: number
  graphExpandedCount: number
  fallbackTriggered: boolean
  fallbackReason: string | null
  totalCandidates: number
}

export interface StructuredMemory {
  id: string | null
  content: string
  type: string
  layer: string
  expiresAt: string | null
  scope: string
  projectId: string | null
  tags: string[]
  paths: string[]
  category: string | null
  metadata: Record<string, unknown> | null
  graph?: GraphExplainability
  createdAt: string | null
  updatedAt: string | null
}

export interface ToolExecutionResult {
  content: Array<{ type: string; text: string }>
  structuredContent?: ToolResponseEnvelope<Record<string, unknown>> | Record<string, unknown>
}

export class ToolExecutionError extends Error {
  readonly rpcCode: number
  readonly detail: ApiErrorDetail

  constructor(detail: ApiErrorDetail, options?: { rpcCode?: number }) {
    super(detail.message)
    this.name = "ToolExecutionError"
    this.detail = detail
    this.rpcCode = options?.rpcCode ?? -32603
  }
}

export function apiError(detail: ApiErrorDetail): ApiErrorDetail {
  return detail
}

export function toToolExecutionError(err: unknown, fallbackTool?: string): ToolExecutionError {
  if (err instanceof ToolExecutionError) {
    return err
  }

  if (err instanceof Error) {
    return new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "TOOL_EXECUTION_FAILED",
        message: err.message,
        status: 500,
        retryable: true,
        details: fallbackTool ? { tool: fallbackTool } : undefined,
      })
    )
  }

  return new ToolExecutionError(
    apiError({
      type: "unknown_error",
      code: "UNKNOWN_TOOL_ERROR",
      message: "Tool execution failed",
      status: 500,
      retryable: true,
      details: fallbackTool ? { tool: fallbackTool } : undefined,
    })
  )
}

export const MEMORY_COLUMNS =
  "id, content, type, memory_layer, expires_at, scope, project_id, user_id, tags, paths, category, metadata, created_at, updated_at"

export const MEMORY_COLUMNS_ALIASED =
  "m.id, m.content, m.type, m.memory_layer, m.expires_at, m.scope, m.project_id, m.user_id, m.tags, m.paths, m.category, m.metadata, m.created_at, m.updated_at"

export const VALID_TYPES = new Set(["rule", "decision", "fact", "note", "skill"])
export const VALID_LAYERS = new Set<MemoryLayer>(["rule", "working", "long_term"])

export function defaultLayerForType(type: string): MemoryLayer {
  return type === "rule" ? "rule" : "long_term"
}

function parseList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseMetadata(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function resolveMemoryLayer(row: Partial<MemoryRow>): MemoryLayer {
  if (row.memory_layer === "rule" || row.memory_layer === "working" || row.memory_layer === "long_term") {
    return row.memory_layer
  }
  return row.type === "rule" ? "rule" : "long_term"
}

export function toStructuredMemory(row: Partial<MemoryRow>): StructuredMemory {
  return {
    id: row.id ?? null,
    content: row.content ?? "",
    type: row.type ?? "note",
    layer: resolveMemoryLayer(row),
    expiresAt: row.expires_at ?? null,
    scope: row.scope ?? "global",
    projectId: row.project_id ?? null,
    tags: parseList(row.tags),
    paths: parseList(row.paths),
    category: row.category ?? null,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

export function truncate(str: string, len = 80): string {
  if (str.length <= len) return str
  return str.slice(0, len).trim() + "..."
}

export function formatMemory(row: MemoryRow): string {
  const scope = row.scope === "project" && row.project_id ? `@${row.project_id.split("/").pop()}` : "global"
  const tags = row.tags ? ` [${row.tags}]` : ""
  return `[${row.type}] ${truncate(row.content)} (${scope})${tags}`
}
