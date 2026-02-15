import {
  apiError,
  MCP_WORKING_MEMORY_TTL_HOURS,
  type MemoryLayer,
  ToolExecutionError,
  VALID_LAYERS,
} from "./types"

// ─── Time Helpers ─────────────────────────────────────────────────────────────

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString()
}

export function workingMemoryExpiresAt(nowIso: string): string {
  return addHours(nowIso, MCP_WORKING_MEMORY_TTL_HOURS)
}

// ─── Input Parsers ────────────────────────────────────────────────────────────

export function parseTenantId(args: Record<string, unknown>): string | null {
  if (args.tenant_id === undefined || args.tenant_id === null) {
    return null
  }

  if (typeof args.tenant_id !== "string" || args.tenant_id.trim().length === 0) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "TENANT_ID_INVALID",
        message: "tenant_id must be a non-empty string",
        status: 400,
        retryable: false,
        details: { field: "tenant_id" },
      }),
      { rpcCode: -32602 }
    )
  }

  return args.tenant_id.trim()
}

export function parseUserId(args: Record<string, unknown>): string | null {
  if (args.user_id === undefined || args.user_id === null) {
    return null
  }

  if (typeof args.user_id !== "string" || args.user_id.trim().length === 0) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "USER_ID_INVALID",
        message: "user_id must be a non-empty string",
        status: 400,
        retryable: false,
        details: { field: "user_id" },
      }),
      { rpcCode: -32602 }
    )
  }

  return args.user_id.trim()
}

export function parseMemoryLayer(args: Record<string, unknown>, field = "layer"): MemoryLayer | null {
  const value = args[field]
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== "string") {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "MEMORY_LAYER_INVALID",
        message: `${field} must be one of: rule, working, long_term`,
        status: 400,
        retryable: false,
        details: { field },
      }),
      { rpcCode: -32602 }
    )
  }

  const normalized = value.trim() as MemoryLayer
  if (!VALID_LAYERS.has(normalized)) {
    throw new ToolExecutionError(
      apiError({
        type: "validation_error",
        code: "MEMORY_LAYER_INVALID",
        message: `${field} must be one of: rule, working, long_term`,
        status: 400,
        retryable: false,
        details: { field, value },
      }),
      { rpcCode: -32602 }
    )
  }

  return normalized
}

// ─── SQL Clause Builders ──────────────────────────────────────────────────────

export function buildLayerFilterClause(
  layer: MemoryLayer | null,
  columnPrefix = ""
): { clause: string } {
  if (!layer) {
    return { clause: "1 = 1" }
  }

  const layerColumn = `${columnPrefix}memory_layer`
  const typeColumn = `${columnPrefix}type`
  if (layer === "rule") {
    return { clause: `(${layerColumn} = 'rule' OR ${typeColumn} = 'rule')` }
  }
  if (layer === "working") {
    return { clause: `${layerColumn} = 'working'` }
  }
  return { clause: `(${layerColumn} IS NULL OR ${layerColumn} = 'long_term')` }
}

export function buildNotExpiredFilter(nowIso: string, columnPrefix = ""): { clause: string; args: string[] } {
  const expiresAtColumn = `${columnPrefix}expires_at`
  return {
    clause: `(${expiresAtColumn} IS NULL OR ${expiresAtColumn} > ?)`,
    args: [nowIso],
  }
}

export function buildUserScopeFilter(
  userId: string | null,
  columnPrefix = ""
): { clause: string; args: string[] } {
  const userColumn = `${columnPrefix}user_id`
  if (userId) {
    return {
      clause: `(${userColumn} IS NULL OR ${userColumn} = ?)`,
      args: [userId],
    }
  }
  return {
    clause: `${userColumn} IS NULL`,
    args: [],
  }
}
