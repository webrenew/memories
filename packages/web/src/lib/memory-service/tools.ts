import {
  apiError,
  type ContextRetrievalStrategy,
  type ToolName,
  type ToolExecutionResult,
  type ToolStructuredContent,
  type ToolResponseEnvelope,
  ToolExecutionError,
  type TursoClient,
  DEFAULT_RESPONSE_SCHEMA_VERSION,
} from "./types"
import { parseUserId } from "./scope"
import {
  getContextPayload,
  getRulesPayload,
  listMemoriesPayload,
  searchMemoriesPayload,
} from "./queries"
import { addMemoryPayload, editMemoryPayload, forgetMemoryPayload, bulkForgetMemoriesPayload, vacuumMemoriesPayload } from "./mutations"

export {
  apiError,
  type ApiErrorDetail,
  ToolExecutionError,
  toToolExecutionError,
} from "./types"

export { ensureMemoryUserIdSchema, parseTenantId, parseUserId, resolveTenantTurso } from "./scope"

function parseRetrievalStrategy(args: Record<string, unknown>): ContextRetrievalStrategy {
  const raw = args.retrieval_strategy
  if (raw === "hybrid_graph") {
    return "hybrid_graph"
  }
  return "baseline"
}

function parseGraphDepth(args: Record<string, unknown>): 0 | 1 | 2 {
  const raw = args.graph_depth
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 1
  }
  const parsed = Math.floor(raw)
  if (parsed === 0 || parsed === 1 || parsed === 2) {
    return parsed
  }
  return 1
}

function parseGraphLimit(args: Record<string, unknown>): number {
  const raw = args.graph_limit
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 8
  }
  return Math.max(1, Math.min(Math.floor(raw), 50))
}

function parseLimit(
  value: unknown,
  options: {
    fallback: number
    max: number
  }
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return options.fallback
  }
  return Math.max(1, Math.min(Math.floor(value), options.max))
}

function buildToolEnvelope<T extends Record<string, unknown>>(
  tool: ToolName,
  data: T,
  responseSchemaVersion: string
): ToolStructuredContent<T> {
  const envelope: ToolResponseEnvelope<T> = {
    ok: true,
    data,
    error: null,
    meta: {
      version: responseSchemaVersion,
      tool,
      timestamp: new Date().toISOString(),
    },
  }

  return {
    ...envelope,
    ...data,
  }
}

export async function executeMemoryTool(
  toolName: string,
  args: Record<string, unknown>,
  turso: TursoClient,
  options?: { responseSchemaVersion?: string }
): Promise<ToolExecutionResult> {
  const responseSchemaVersion = options?.responseSchemaVersion ?? DEFAULT_RESPONSE_SCHEMA_VERSION
  const projectId = args.project_id as string | undefined
  const userId = parseUserId(args)
  const nowIso = new Date().toISOString()

  switch (toolName) {
    case "get_context": {
      const query = typeof args.query === "string" ? args.query.trim() : ""
      const limit = parseLimit(args.limit, { fallback: 5, max: 50 })
      const retrievalStrategy = parseRetrievalStrategy(args)
      const graphDepth = parseGraphDepth(args)
      const graphLimit = parseGraphLimit(args)
      const payload = await getContextPayload({
        turso,
        projectId,
        userId,
        nowIso,
        query,
        limit,
        retrievalStrategy,
        graphDepth,
        graphLimit,
      })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("get_context", payload.data, responseSchemaVersion),
      }
    }

    case "get_rules": {
      const payload = await getRulesPayload({ turso, projectId, userId, nowIso })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("get_rules", payload.data, responseSchemaVersion),
      }
    }

    case "add_memory": {
      const payload = await addMemoryPayload({ turso, args, projectId, userId, nowIso })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("add_memory", payload.data, responseSchemaVersion),
      }
    }

    case "edit_memory": {
      const payload = await editMemoryPayload({ turso, args, userId, nowIso })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("edit_memory", payload.data, responseSchemaVersion),
      }
    }

    case "forget_memory": {
      const payload = await forgetMemoryPayload({ turso, args, userId, nowIso })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("forget_memory", payload.data, responseSchemaVersion),
      }
    }

    case "search_memories": {
      const limit = parseLimit(args.limit, { fallback: 10, max: 50 })
      const payload = await searchMemoriesPayload({
        turso,
        args: { ...args, limit },
        projectId,
        userId,
        nowIso,
      })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("search_memories", payload.data, responseSchemaVersion),
      }
    }

    case "list_memories": {
      const limit = parseLimit(args.limit, { fallback: 20, max: 100 })
      const payload = await listMemoriesPayload({
        turso,
        args: { ...args, limit },
        projectId,
        userId,
        nowIso,
      })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("list_memories", payload.data, responseSchemaVersion),
      }
    }

    case "bulk_forget_memories": {
      const payload = await bulkForgetMemoriesPayload({ turso, args, userId, nowIso })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("bulk_forget_memories", payload.data, responseSchemaVersion),
      }
    }

    case "vacuum_memories": {
      const payload = await vacuumMemoriesPayload({ turso, userId })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("vacuum_memories", payload.data, responseSchemaVersion),
      }
    }

    default:
      throw new ToolExecutionError(
        apiError({
          type: "tool_error",
          code: "TOOL_NOT_FOUND",
          message: `Unknown tool: ${toolName}`,
          status: 404,
          retryable: false,
          details: { tool: toolName },
        }),
        { rpcCode: -32601 }
      )
  }
}
