import { z } from "zod"
import { parseContextResponse, parseMemoryListResponse } from "./parsers"
import { buildSystemPrompt } from "./system-prompt"
import type {
  BuildSystemPromptInput,
  ContextGetInput,
  ContextGetOptions,
  ContextMode,
  ContextResult,
  MemoriesErrorData,
  MemoriesResponseEnvelope,
  MemoryAddInput,
  MemoryEditInput,
  MemoryListOptions,
  MemoryRecord,
  MemorySearchOptions,
  MutationResult,
} from "./types"

export interface MemoriesClientOptions {
  apiKey?: string
  baseUrl?: string
  userId?: string
  tenantId?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
}

interface RpcErrorPayload {
  code: number
  message: string
  data?: unknown
}

interface RpcResponsePayload {
  result?: unknown
  error?: RpcErrorPayload
}

const baseUrlSchema = z.string().url()
const apiErrorSchema = z.object({
  type: z.string(),
  code: z.string(),
  message: z.string(),
  status: z.number().int().optional(),
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
})

const responseEnvelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().nullable(),
  error: apiErrorSchema.nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

const legacyHttpErrorSchema = z.object({
  error: z.union([z.string(), apiErrorSchema]).optional(),
  errorDetail: apiErrorSchema.optional(),
  message: z.string().optional(),
})

const structuredMemorySchema = z.object({
  id: z.string().nullable().optional(),
  content: z.string(),
  type: z.string(),
  layer: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  scope: z.string(),
  projectId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
})

const contextStructuredSchema = z.object({
  rules: z.array(structuredMemorySchema).optional().default([]),
  memories: z.array(structuredMemorySchema).optional().default([]),
  workingMemories: z.array(structuredMemorySchema).optional().default([]),
  longTermMemories: z.array(structuredMemorySchema).optional().default([]),
})

const memoriesStructuredSchema = z.object({
  memories: z.array(structuredMemorySchema).optional().default([]),
})

const mutationEnvelopeDataSchema = z.object({
  message: z.string().optional(),
})

function errorTypeForStatus(status: number): MemoriesErrorData["type"] {
  if (status === 400) return "validation_error"
  if (status === 401 || status === 403) return "auth_error"
  if (status === 404) return "not_found_error"
  if (status === 429) return "rate_limit_error"
  if (status >= 500) return "internal_error"
  return "http_error"
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function toTypedHttpError(status: number, payload: unknown): MemoriesErrorData {
  const parsed = legacyHttpErrorSchema.safeParse(payload)
  if (!parsed.success) {
    return {
      type: errorTypeForStatus(status),
      code: `HTTP_${status}`,
      message: `HTTP ${status}`,
      status,
      retryable: isRetryableStatus(status),
      details: payload,
    }
  }

  if (parsed.data.errorDetail) {
    return {
      ...parsed.data.errorDetail,
      status: parsed.data.errorDetail.status ?? status,
      retryable: parsed.data.errorDetail.retryable ?? isRetryableStatus(status),
    }
  }

  if (typeof parsed.data.error !== "string" && parsed.data.error) {
    return {
      ...parsed.data.error,
      status: parsed.data.error.status ?? status,
      retryable: parsed.data.error.retryable ?? isRetryableStatus(status),
    }
  }

  const message = typeof parsed.data.error === "string"
    ? parsed.data.error
    : parsed.data.message ?? `HTTP ${status}`

  return {
    type: errorTypeForStatus(status),
    code: `HTTP_${status}`,
    message,
    status,
    retryable: isRetryableStatus(status),
  }
}

export class MemoriesClientError extends Error {
  readonly status?: number
  readonly code?: number
  readonly data?: unknown
  readonly type?: MemoriesErrorData["type"]
  readonly errorCode?: string
  readonly retryable?: boolean
  readonly details?: unknown

  constructor(
    message: string,
    options?: {
      status?: number
      code?: number
      data?: unknown
      type?: MemoriesErrorData["type"]
      errorCode?: string
      retryable?: boolean
      details?: unknown
    }
  ) {
    super(message)
    this.name = "MemoriesClientError"
    this.status = options?.status
    this.code = options?.code
    this.type = options?.type
    this.errorCode = options?.errorCode
    this.retryable = options?.retryable
    this.details = options?.details
    this.data = options?.data ?? options?.details
  }
}

function readDefaultApiKey(): string | undefined {
  if (typeof process === "undefined") return undefined
  return process.env.MEMORIES_API_KEY
}

function normalizeMemoryType(type: string): MemoryRecord["type"] {
  if (type === "rule" || type === "decision" || type === "fact" || type === "note" || type === "skill") {
    return type
  }
  return "note"
}

function normalizeMemoryLayer(layer: string | undefined, type: MemoryRecord["type"]): MemoryRecord["layer"] {
  if (layer === "rule" || layer === "working" || layer === "long_term") {
    return layer
  }
  return type === "rule" ? "rule" : "long_term"
}

function normalizeMemoryScope(scope: string): MemoryRecord["scope"] {
  if (scope === "global" || scope === "project" || scope === "unknown") {
    return scope
  }
  return "unknown"
}

function toMemoryRecord(memory: z.infer<typeof structuredMemorySchema>): MemoryRecord {
  const type = normalizeMemoryType(memory.type)
  return {
    id: memory.id ?? null,
    content: memory.content,
    type,
    layer: normalizeMemoryLayer(memory.layer, type),
    expiresAt: memory.expiresAt ?? null,
    scope: normalizeMemoryScope(memory.scope),
    projectId: memory.projectId ?? null,
    tags: memory.tags ?? [],
  }
}

function dedupeMemories(records: z.infer<typeof structuredMemorySchema>[]): z.infer<typeof structuredMemorySchema>[] {
  const seen = new Set<string>()
  const deduped: z.infer<typeof structuredMemorySchema>[] = []

  for (const memory of records) {
    const key = memory.id ?? `${memory.type}:${memory.scope}:${memory.content}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(memory)
  }

  return deduped
}

const contextModes = new Set<ContextMode>(["all", "working", "long_term", "rules_only"])

interface ContextBuckets {
  working: z.infer<typeof structuredMemorySchema>[]
  longTerm: z.infer<typeof structuredMemorySchema>[]
}

interface NormalizedContextInput extends ContextGetInput {
  mode: ContextMode
}

type ContextGetMethod = {
  (input?: ContextGetInput): Promise<ContextResult>
  (query?: string, options?: ContextGetOptions): Promise<ContextResult>
}

function normalizeContextMode(mode: unknown): ContextMode {
  if (typeof mode === "string" && contextModes.has(mode as ContextMode)) {
    return mode as ContextMode
  }
  return "all"
}

function normalizeContextInput(
  inputOrQuery?: string | ContextGetInput,
  options: ContextGetOptions = {}
): NormalizedContextInput {
  const fromObject =
    inputOrQuery && typeof inputOrQuery === "object"
      ? inputOrQuery
      : { query: typeof inputOrQuery === "string" ? inputOrQuery : undefined, ...options }

  return {
    ...fromObject,
    mode: normalizeContextMode(fromObject.mode),
  }
}

function partitionByLayer(records: z.infer<typeof structuredMemorySchema>[]): ContextBuckets {
  const working: z.infer<typeof structuredMemorySchema>[] = []
  const longTerm: z.infer<typeof structuredMemorySchema>[] = []

  for (const record of records) {
    const type = normalizeMemoryType(record.type)
    const layer = normalizeMemoryLayer(record.layer, type)
    if (layer === "working") {
      working.push(record)
      continue
    }
    if (layer === "long_term") {
      longTerm.push(record)
    }
  }

  return { working, longTerm }
}

function pickMemoriesForMode(
  mode: ContextMode,
  structured: z.infer<typeof contextStructuredSchema>
): z.infer<typeof structuredMemorySchema>[] {
  const fallbackBuckets = partitionByLayer(structured.memories)
  const working = dedupeMemories([...structured.workingMemories, ...fallbackBuckets.working])
  const longTerm = dedupeMemories([...structured.longTermMemories, ...fallbackBuckets.longTerm])

  if (mode === "rules_only") {
    return []
  }
  if (mode === "working") {
    return working
  }
  if (mode === "long_term") {
    return longTerm
  }
  return dedupeMemories([...working, ...longTerm])
}

interface ParsedToolResult {
  raw: string
  structured: unknown
  envelope: MemoriesResponseEnvelope<unknown> | null
}

function toClientError(error: MemoriesErrorData, options?: { status?: number; rpcCode?: number }) {
  return new MemoriesClientError(error.message, {
    status: error.status ?? options?.status,
    code: options?.rpcCode,
    type: error.type,
    errorCode: error.code,
    retryable: error.retryable,
    details: error.details,
  })
}

function parseToolResult(result: unknown): ParsedToolResult {
  const parsed = z
    .object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      structuredContent: z.unknown().optional(),
    })
    .passthrough()
    .safeParse(result)

  if (!parsed.success) {
    return { raw: "", structured: null, envelope: null }
  }

  const textChunk = parsed.data.content?.find((entry) => entry.type === "text" && entry.text)
  const envelope = responseEnvelopeSchema.safeParse(parsed.data.structuredContent)

  if (envelope.success) {
    const parsedEnvelope: MemoriesResponseEnvelope<unknown> = {
      ok: envelope.data.ok,
      data: envelope.data.data,
      error: envelope.data.error,
      meta: envelope.data.meta,
    }
    return {
      raw: textChunk?.text ?? "",
      structured: parsedEnvelope.data,
      envelope: parsedEnvelope,
    }
  }

  return {
    raw: textChunk?.text ?? "",
    structured: parsed.data.structuredContent ?? null,
    envelope: null,
  }
}

function messageFromEnvelope(envelope: MemoriesResponseEnvelope<unknown> | null): string | null {
  if (!envelope?.data || typeof envelope.data !== "object") return null
  const parsed = mutationEnvelopeDataSchema.safeParse(envelope.data)
  if (!parsed.success || typeof parsed.data.message !== "string") return null
  return parsed.data.message
}

export class MemoriesClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly userId: string | undefined
  private readonly tenantId: string | undefined
  private readonly fetcher: typeof fetch
  private readonly defaultHeaders: Record<string, string>

  constructor(options: MemoriesClientOptions = {}) {
    const apiKey = options.apiKey ?? readDefaultApiKey()
    if (!apiKey) {
      throw new MemoriesClientError("Missing API key. Pass apiKey or set MEMORIES_API_KEY.")
    }

    const baseUrl = options.baseUrl ?? "https://memories.sh/api/mcp"
    const parsedBaseUrl = baseUrlSchema.safeParse(baseUrl)
    if (!parsedBaseUrl.success) {
      throw new MemoriesClientError("Invalid baseUrl. Expected a valid URL.")
    }

    if (typeof fetch !== "function" && !options.fetch) {
      throw new MemoriesClientError("No fetch implementation available.")
    }

    const tenantId = options.tenantId?.trim()
    if (options.tenantId !== undefined && !tenantId) {
      throw new MemoriesClientError("Invalid tenantId. Expected a non-empty string when provided.")
    }

    this.apiKey = apiKey
    this.baseUrl = parsedBaseUrl.data
    this.userId = options.userId
    this.tenantId = tenantId
    this.fetcher = options.fetch ?? fetch
    this.defaultHeaders = options.headers ?? {}
  }

  readonly context: { get: ContextGetMethod } = {
    get: async (
      inputOrQuery?: string | ContextGetInput,
      options: ContextGetOptions = {}
    ): Promise<ContextResult> => {
      const input = normalizeContextInput(inputOrQuery, options)
      const toolResult = await this.callTool("get_context", {
        query: input.query,
        limit: input.limit,
        project_id: input.projectId,
        user_id: input.userId,
        tenant_id: input.tenantId,
      })

      const structured = contextStructuredSchema.safeParse(toolResult.structured)
      if (structured.success) {
        const orderedMemories = pickMemoriesForMode(input.mode, structured.data)
        const parsedFromStructured: ContextResult = {
          rules: structured.data.rules.map(toMemoryRecord),
          memories: orderedMemories.map(toMemoryRecord),
          raw: toolResult.raw,
        }
        if (input.includeRules === false) {
          return { ...parsedFromStructured, rules: [] }
        }
        return parsedFromStructured
      }

      const parsed = parseContextResponse(toolResult.raw)
      const modeFiltered = input.mode === "rules_only" ? { ...parsed, memories: [] } : parsed
      if (input.includeRules === false) {
        return { ...modeFiltered, rules: [] }
      }
      return modeFiltered
    },
  }

  readonly memories = {
    add: async (input: MemoryAddInput): Promise<MutationResult> => {
      const toolResult = await this.callTool("add_memory", {
        content: input.content,
        type: input.type,
        layer: input.layer,
        tags: input.tags,
        paths: input.paths,
        category: input.category,
        metadata: input.metadata,
        project_id: input.projectId,
      })

      const message = (messageFromEnvelope(toolResult.envelope) ?? toolResult.raw) || "Memory stored"
      return {
        ok: true,
        message,
        raw: toolResult.raw,
        envelope: toolResult.envelope ?? undefined,
      }
    },

    search: async (query: string, options: MemorySearchOptions = {}): Promise<MemoryRecord[]> => {
      const toolResult = await this.callTool("search_memories", {
        query,
        type: options.type,
        layer: options.layer,
        limit: options.limit,
        project_id: options.projectId,
      })

      const structured = memoriesStructuredSchema.safeParse(toolResult.structured)
      if (structured.success) {
        return structured.data.memories.map(toMemoryRecord)
      }

      return parseMemoryListResponse(toolResult.raw)
    },

    list: async (options: MemoryListOptions = {}): Promise<MemoryRecord[]> => {
      const toolResult = await this.callTool("list_memories", {
        type: options.type,
        layer: options.layer,
        tags: options.tags,
        limit: options.limit,
        project_id: options.projectId,
      })

      const structured = memoriesStructuredSchema.safeParse(toolResult.structured)
      if (structured.success) {
        return structured.data.memories.map(toMemoryRecord)
      }

      return parseMemoryListResponse(toolResult.raw)
    },

    edit: async (id: string, updates: MemoryEditInput): Promise<MutationResult> => {
      const toolResult = await this.callTool("edit_memory", {
        id,
        content: updates.content,
        type: updates.type,
        layer: updates.layer,
        tags: updates.tags,
        paths: updates.paths,
        category: updates.category,
        metadata: updates.metadata,
      })
      const message = (messageFromEnvelope(toolResult.envelope) ?? toolResult.raw) || `Updated memory ${id}`
      return {
        ok: true,
        message,
        raw: toolResult.raw,
        envelope: toolResult.envelope ?? undefined,
      }
    },

    forget: async (id: string): Promise<MutationResult> => {
      const toolResult = await this.callTool("forget_memory", { id })
      const message = (messageFromEnvelope(toolResult.envelope) ?? toolResult.raw) || `Deleted memory ${id}`
      return {
        ok: true,
        message,
        raw: toolResult.raw,
        envelope: toolResult.envelope ?? undefined,
      }
    },
  }

  buildSystemPrompt(input: BuildSystemPromptInput): string {
    return buildSystemPrompt(input)
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const payload = {
      jsonrpc: "2.0",
      method,
      id: crypto.randomUUID(),
      params,
    }

    let response: Response
    try {
      response = await this.fetcher(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...this.defaultHeaders,
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      throw new MemoriesClientError("Network request failed", {
        type: "network_error",
        errorCode: "NETWORK_ERROR",
        retryable: true,
        details: error,
      })
    }

    let json: RpcResponsePayload | null = null
    try {
      json = (await response.json()) as RpcResponsePayload
    } catch {
      json = null
    }

    if (!response.ok) {
      const typedError = toTypedHttpError(response.status, json)
      throw toClientError(typedError, { status: response.status })
    }

    if (!json) {
      throw new MemoriesClientError("Invalid RPC response: missing JSON body", {
        status: response.status,
        type: "rpc_error",
        errorCode: "INVALID_RPC_RESPONSE",
        retryable: false,
      })
    }

    if (json.error) {
      const typedRpcError = apiErrorSchema.safeParse(json.error.data)
      if (typedRpcError.success) {
        throw toClientError(typedRpcError.data, {
          status: typedRpcError.data.status ?? response.status,
          rpcCode: json.error.code,
        })
      }

      throw new MemoriesClientError(json.error.message, {
        status: response.status,
        code: json.error.code,
        type: "rpc_error",
        errorCode: "RPC_ERROR",
        retryable: false,
        details: json.error.data,
      })
    }

    if (!("result" in json)) {
      throw new MemoriesClientError("Invalid RPC response: missing result", {
        status: response.status,
        type: "rpc_error",
        errorCode: "INVALID_RPC_RESPONSE",
        retryable: false,
      })
    }

    return json.result
  }

  private withDefaultScope(args: Record<string, unknown>): Record<string, unknown> {
    let scoped: Record<string, unknown> = args
    if (this.userId && scoped.user_id === undefined) {
      scoped = { ...scoped, user_id: this.userId }
    }
    if (this.tenantId && scoped.tenant_id === undefined) {
      scoped = { ...scoped, tenant_id: this.tenantId }
    }
    return scoped
  }

  private async callTool(toolName: string, args: Record<string, unknown>): Promise<ParsedToolResult> {
    const result = await this.rpc("tools/call", {
      name: toolName,
      arguments: this.withDefaultScope(args),
    })
    const parsed = parseToolResult(result)

    if (parsed.envelope && !parsed.envelope.ok) {
      const envelopeError = parsed.envelope.error ?? {
        type: "tool_error",
        code: "TOOL_ERROR",
        message: `Tool execution failed: ${toolName}`,
        retryable: false,
      }
      throw toClientError(envelopeError)
    }

    return parsed
  }
}
