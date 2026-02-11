import {
  apiError,
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
import { addMemoryPayload, editMemoryPayload, forgetMemoryPayload } from "./mutations"

export {
  apiError,
  DEFAULT_RESPONSE_SCHEMA_VERSION,
  type ApiErrorDetail,
  type ApiErrorType,
  type MemoryLayer,
  type MemoryRow,
  type StructuredMemory,
  type ToolName,
  type ToolResponseEnvelope,
  type ToolStructuredContent,
  ToolExecutionError,
  toToolExecutionError,
} from "./types"

export { ensureMemoryUserIdSchema, parseMemoryLayer, parseTenantId, parseUserId, resolveTenantTurso } from "./scope"

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
      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
          ? Math.floor(args.limit)
          : 5
      const payload = await getContextPayload({ turso, projectId, userId, nowIso, query, limit })
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
      const payload = await searchMemoriesPayload({ turso, args, projectId, userId, nowIso })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("search_memories", payload.data, responseSchemaVersion),
      }
    }

    case "list_memories": {
      const payload = await listMemoriesPayload({ turso, args, projectId, userId, nowIso })
      return {
        content: [{ type: "text", text: payload.text }],
        structuredContent: buildToolEnvelope("list_memories", payload.data, responseSchemaVersion),
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
