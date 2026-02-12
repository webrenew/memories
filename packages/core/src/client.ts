import { z } from "zod"
import { parseContextResponse, parseMemoryListResponse } from "./parsers"
import { buildSystemPrompt } from "./system-prompt"
import type {
  BuildSystemPromptInput,
  ContextGetInput,
  ContextGetOptions,
  ContextMode,
  ContextStrategy,
  ContextResult,
  ManagementKeyCreateInput,
  ManagementKeyCreateResult,
  ManagementKeyRevokeResult,
  ManagementKeyStatus,
  ManagementTenantDisableResult,
  ManagementTenantListResult,
  ManagementTenantUpsertInput,
  ManagementTenantUpsertResult,
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
  transport?: "sdk_http" | "mcp" | "auto"
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
  graph: z
    .object({
      whyIncluded: z.literal("graph_expansion"),
      linkedViaNode: z.string(),
      edgeType: z.string(),
      hopCount: z.number().int().nonnegative(),
      seedMemoryId: z.string(),
    })
    .nullable()
    .optional(),
})

const contextStructuredSchema = z.object({
  rules: z.array(structuredMemorySchema).optional().default([]),
  memories: z.array(structuredMemorySchema).optional().default([]),
  workingMemories: z.array(structuredMemorySchema).optional().default([]),
  longTermMemories: z.array(structuredMemorySchema).optional().default([]),
  trace: z
    .object({
      requestedStrategy: z.union([z.literal("baseline"), z.literal("hybrid_graph")]).optional(),
      strategy: z.union([z.literal("baseline"), z.literal("hybrid_graph")]),
      graphDepth: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      graphLimit: z.number().int().nonnegative(),
      rolloutMode: z.union([z.literal("off"), z.literal("shadow"), z.literal("canary")]).optional(),
      shadowExecuted: z.boolean().optional(),
      baselineCandidates: z.number().int().nonnegative(),
      graphCandidates: z.number().int().nonnegative(),
      graphExpandedCount: z.number().int().nonnegative(),
      fallbackTriggered: z.boolean().optional(),
      fallbackReason: z.string().nullable().optional(),
      totalCandidates: z.number().int().nonnegative(),
    })
    .optional(),
})

const memoriesStructuredSchema = z.object({
  memories: z.array(structuredMemorySchema).optional().default([]),
})

const mutationEnvelopeDataSchema = z.object({
  message: z.string().optional(),
})

const managementKeyStatusSchema = z.object({
  hasKey: z.boolean(),
  keyPreview: z.string().optional(),
  createdAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  isExpired: z.boolean().optional(),
})

const managementKeyCreateSchema = z.object({
  apiKey: z.string(),
  keyPreview: z.string().optional(),
  createdAt: z.string().optional(),
  expiresAt: z.string().optional(),
  message: z.string().optional(),
})

const managementKeyRevokeSchema = z.object({
  ok: z.boolean(),
})

const managementTenantSchema = z.object({
  tenantId: z.string(),
  tursoDbUrl: z.string(),
  tursoDbName: z.string().nullable().optional(),
  status: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastVerifiedAt: z.string().nullable().optional(),
})

const managementTenantListSchema = z.object({
  tenantDatabases: z.array(managementTenantSchema),
  count: z.number().int(),
})

const managementTenantUpsertSchema = z.object({
  tenantDatabase: managementTenantSchema,
  provisioned: z.boolean(),
  mode: z.string(),
})

const managementTenantDisableSchema = z.object({
  ok: z.boolean(),
  tenantId: z.string(),
  status: z.string(),
  updatedAt: z.string(),
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
    graph: memory.graph ?? null,
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
const contextStrategies = new Set<ContextStrategy>(["baseline", "hybrid_graph"])

interface ContextBuckets {
  working: z.infer<typeof structuredMemorySchema>[]
  longTerm: z.infer<typeof structuredMemorySchema>[]
}

interface NormalizedContextInput extends ContextGetInput {
  mode: ContextMode
  strategy: ContextStrategy
  graphDepth: 0 | 1 | 2
  graphLimit: number
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

function normalizeContextStrategy(strategy: unknown): ContextStrategy {
  if (typeof strategy === "string" && contextStrategies.has(strategy as ContextStrategy)) {
    return strategy as ContextStrategy
  }
  return "baseline"
}

function normalizeGraphDepth(depth: unknown): 0 | 1 | 2 {
  if (depth === 0 || depth === 1 || depth === 2) {
    return depth
  }
  return 1
}

function normalizeGraphLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 8
  }
  return Math.max(1, Math.min(Math.floor(limit), 50))
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
    strategy: normalizeContextStrategy(fromObject.strategy),
    graphDepth: normalizeGraphDepth(fromObject.graphDepth),
    graphLimit: normalizeGraphLimit(fromObject.graphLimit),
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

function parseStructuredData<T>(
  schema: z.ZodType<T>,
  endpoint: string,
  structured: unknown
): T {
  const parsed = schema.safeParse(structured)
  if (parsed.success) {
    return parsed.data
  }

  throw new MemoriesClientError(`Invalid SDK response data for ${endpoint}`, {
    type: "http_error",
    errorCode: "INVALID_RESPONSE_DATA",
    retryable: false,
    details: structured,
  })
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function deriveSdkBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/api/mcp")) {
    return baseUrl.slice(0, -"/api/mcp".length)
  }
  if (baseUrl.endsWith("/api/sdk/v1")) {
    return baseUrl.slice(0, -"/api/sdk/v1".length)
  }
  return baseUrl
}

function deriveMcpUrl(baseUrl: string, sdkBaseUrl: string): string {
  if (baseUrl.endsWith("/api/mcp")) {
    return baseUrl
  }
  return `${sdkBaseUrl}/api/mcp`
}

export class MemoriesClient {
  private readonly apiKey: string
  private readonly mcpUrl: string
  private readonly sdkBaseUrl: string
  private readonly transport: "sdk_http" | "mcp"
  private readonly userId: string | undefined
  private readonly tenantId: string | undefined
  private readonly fetcher: typeof fetch
  private readonly defaultHeaders: Record<string, string>

  constructor(options: MemoriesClientOptions = {}) {
    const apiKey = options.apiKey ?? readDefaultApiKey()
    if (!apiKey) {
      throw new MemoriesClientError("Missing API key. Pass apiKey or set MEMORIES_API_KEY.")
    }

    const baseUrl = options.baseUrl ?? "https://memories.sh"
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

    const normalizedBaseUrl = stripTrailingSlash(parsedBaseUrl.data)
    const sdkBaseUrl = deriveSdkBaseUrl(normalizedBaseUrl)
    const mcpUrl = deriveMcpUrl(normalizedBaseUrl, sdkBaseUrl)
    const inferredTransport = normalizedBaseUrl.endsWith("/api/mcp") ? "mcp" : "sdk_http"
    const resolvedTransport = options.transport === "auto" || options.transport === undefined
      ? inferredTransport
      : options.transport

    this.apiKey = apiKey
    this.mcpUrl = mcpUrl
    this.sdkBaseUrl = sdkBaseUrl
    this.transport = resolvedTransport
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
      const rawScope = this.withDefaultScopeSdk({
        projectId: input.projectId,
        userId: input.userId,
        tenantId: input.tenantId,
      })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined

      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/context/get", {
            query: input.query,
            limit: input.limit,
            includeRules: input.includeRules,
            mode: input.mode,
            strategy: input.strategy,
            graphDepth: input.graphDepth,
            graphLimit: input.graphLimit,
            scope: sdkScope,
          })
        : await this.callTool("get_context", {
            query: input.query,
            limit: input.limit,
            project_id: input.projectId,
            user_id: input.userId,
            tenant_id: input.tenantId,
            retrieval_strategy: input.strategy,
            graph_depth: input.graphDepth,
            graph_limit: input.graphLimit,
          })

      const structured = contextStructuredSchema.safeParse(result.structured)
      if (structured.success) {
        const orderedMemories = pickMemoriesForMode(input.mode, structured.data)
        const parsedFromStructured: ContextResult = {
          rules: structured.data.rules.map(toMemoryRecord),
          memories: orderedMemories.map(toMemoryRecord),
          trace: structured.data.trace,
          raw: result.raw,
        }
        if (input.includeRules === false) {
          return { ...parsedFromStructured, rules: [] }
        }
        return parsedFromStructured
      }

      const parsed = parseContextResponse(result.raw)
      const modeFiltered = input.mode === "rules_only" ? { ...parsed, memories: [] } : parsed
      if (input.includeRules === false) {
        return { ...modeFiltered, rules: [] }
      }
      return modeFiltered
    },
  }

  readonly memories = {
    add: async (input: MemoryAddInput): Promise<MutationResult> => {
      const rawScope = this.withDefaultScopeSdk({ projectId: input.projectId })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/add", {
            content: input.content,
            type: input.type,
            layer: input.layer,
            tags: input.tags,
            paths: input.paths,
            category: input.category,
            metadata: input.metadata,
            scope: sdkScope,
          })
        : await this.callTool("add_memory", {
            content: input.content,
            type: input.type,
            layer: input.layer,
            tags: input.tags,
            paths: input.paths,
            category: input.category,
            metadata: input.metadata,
            project_id: input.projectId,
          })

      const message = (messageFromEnvelope(result.envelope) ?? result.raw) || "Memory stored"
      return {
        ok: true,
        message,
        raw: result.raw,
        envelope: result.envelope ?? undefined,
      }
    },

    search: async (query: string, options: MemorySearchOptions = {}): Promise<MemoryRecord[]> => {
      const rawScope = this.withDefaultScopeSdk({ projectId: options.projectId })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/search", {
            query,
            type: options.type,
            layer: options.layer,
            limit: options.limit,
            scope: sdkScope,
          })
        : await this.callTool("search_memories", {
            query,
            type: options.type,
            layer: options.layer,
            limit: options.limit,
            project_id: options.projectId,
          })

      const structured = memoriesStructuredSchema.safeParse(result.structured)
      if (structured.success) {
        return structured.data.memories.map(toMemoryRecord)
      }

      return parseMemoryListResponse(result.raw)
    },

    list: async (options: MemoryListOptions = {}): Promise<MemoryRecord[]> => {
      const rawScope = this.withDefaultScopeSdk({ projectId: options.projectId })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/list", {
            type: options.type,
            layer: options.layer,
            tags: options.tags,
            limit: options.limit,
            scope: sdkScope,
          })
        : await this.callTool("list_memories", {
            type: options.type,
            layer: options.layer,
            tags: options.tags,
            limit: options.limit,
            project_id: options.projectId,
          })

      const structured = memoriesStructuredSchema.safeParse(result.structured)
      if (structured.success) {
        return structured.data.memories.map(toMemoryRecord)
      }

      return parseMemoryListResponse(result.raw)
    },

    edit: async (id: string, updates: MemoryEditInput): Promise<MutationResult> => {
      const rawScope = this.withDefaultScopeSdk()
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/edit", {
            id,
            content: updates.content,
            type: updates.type,
            layer: updates.layer,
            tags: updates.tags,
            paths: updates.paths,
            category: updates.category,
            metadata: updates.metadata,
            scope: sdkScope,
          })
        : await this.callTool("edit_memory", {
            id,
            content: updates.content,
            type: updates.type,
            layer: updates.layer,
            tags: updates.tags,
            paths: updates.paths,
            category: updates.category,
            metadata: updates.metadata,
          })
      const message = (messageFromEnvelope(result.envelope) ?? result.raw) || `Updated memory ${id}`
      return {
        ok: true,
        message,
        raw: result.raw,
        envelope: result.envelope ?? undefined,
      }
    },

    forget: async (id: string): Promise<MutationResult> => {
      const rawScope = this.withDefaultScopeSdk()
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/forget", { id, scope: sdkScope })
        : await this.callTool("forget_memory", { id })
      const message = (messageFromEnvelope(result.envelope) ?? result.raw) || `Deleted memory ${id}`
      return {
        ok: true,
        message,
        raw: result.raw,
        envelope: result.envelope ?? undefined,
      }
    },
  }

  readonly management = {
    keys: {
      get: async (): Promise<ManagementKeyStatus> => {
        const endpoint = "/api/sdk/v1/management/keys"
        const result = await this.callSdkRequest(endpoint, { method: "GET" })
        return parseStructuredData(managementKeyStatusSchema, endpoint, result.structured)
      },

      create: async (input: ManagementKeyCreateInput): Promise<ManagementKeyCreateResult> => {
        const endpoint = "/api/sdk/v1/management/keys"
        const expiresAt = input?.expiresAt?.trim()
        if (!expiresAt) {
          throw new MemoriesClientError("expiresAt is required", {
            type: "validation_error",
            errorCode: "INVALID_MANAGEMENT_INPUT",
            retryable: false,
            details: { field: "expiresAt" },
          })
        }

        const result = await this.callSdkRequest(endpoint, {
          method: "POST",
          body: { expiresAt },
        })

        return parseStructuredData(managementKeyCreateSchema, endpoint, result.structured)
      },

      revoke: async (): Promise<ManagementKeyRevokeResult> => {
        const endpoint = "/api/sdk/v1/management/keys"
        const result = await this.callSdkRequest(endpoint, { method: "DELETE" })
        return parseStructuredData(managementKeyRevokeSchema, endpoint, result.structured)
      },
    },

    tenants: {
      list: async (): Promise<ManagementTenantListResult> => {
        const endpoint = "/api/sdk/v1/management/tenants"
        const result = await this.callSdkRequest(endpoint, { method: "GET" })
        return parseStructuredData(managementTenantListSchema, endpoint, result.structured)
      },

      upsert: async (input: ManagementTenantUpsertInput): Promise<ManagementTenantUpsertResult> => {
        const endpoint = "/api/sdk/v1/management/tenants"
        const result = await this.callSdkRequest(endpoint, {
          method: "POST",
          body: {
            tenantId: input.tenantId,
            mode: input.mode,
            tursoDbUrl: input.tursoDbUrl,
            tursoDbToken: input.tursoDbToken,
            tursoDbName: input.tursoDbName,
            metadata: input.metadata,
          },
        })
        return parseStructuredData(managementTenantUpsertSchema, endpoint, result.structured)
      },

      disable: async (tenantId: string): Promise<ManagementTenantDisableResult> => {
        const endpoint = "/api/sdk/v1/management/tenants"
        const normalizedTenantId = tenantId?.trim()
        if (!normalizedTenantId) {
          throw new MemoriesClientError("tenantId is required", {
            type: "validation_error",
            errorCode: "INVALID_MANAGEMENT_INPUT",
            retryable: false,
            details: { field: "tenantId" },
          })
        }

        const result = await this.callSdkRequest(endpoint, {
          method: "DELETE",
          query: { tenantId: normalizedTenantId },
        })

        return parseStructuredData(managementTenantDisableSchema, endpoint, result.structured)
      },
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
      response = await this.fetcher(this.mcpUrl, {
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

  private withDefaultScopeSdk(
    scope?: {
      tenantId?: string
      userId?: string
      projectId?: string
    }
  ): {
    tenantId?: string
    userId?: string
    projectId?: string
  } {
    const scoped: {
      tenantId?: string
      userId?: string
      projectId?: string
    } = {}
    const tenantId = scope?.tenantId ?? this.tenantId
    const userId = scope?.userId ?? this.userId
    if (tenantId) {
      scoped.tenantId = tenantId
    }
    if (userId) {
      scoped.userId = userId
    }
    if (scope?.projectId) {
      scoped.projectId = scope.projectId
    }
    return scoped
  }

  private async callSdkRequest(
    path: string,
    options: {
      method?: "GET" | "POST" | "DELETE"
      body?: Record<string, unknown>
      query?: Record<string, string | number | boolean | null | undefined>
    } = {}
  ): Promise<ParsedToolResult> {
    const method = options.method ?? "POST"
    const url = new URL(`${this.sdkBaseUrl}${path}`)

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null) continue
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
    }

    let body: string | undefined
    if (options.body !== undefined) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await this.fetcher(url.toString(), {
        method,
        headers,
        body,
      })
    } catch (error) {
      throw new MemoriesClientError("Network request failed", {
        type: "network_error",
        errorCode: "NETWORK_ERROR",
        retryable: true,
        details: error,
      })
    }

    let json: unknown = null
    try {
      json = await response.json()
    } catch {
      json = null
    }

    const parsedEnvelope = responseEnvelopeSchema.safeParse(json)

    if (!response.ok) {
      if (parsedEnvelope.success && parsedEnvelope.data.error) {
        throw toClientError(parsedEnvelope.data.error, { status: response.status })
      }
      const typedError = toTypedHttpError(response.status, json)
      throw toClientError(typedError, { status: response.status })
    }

    if (!parsedEnvelope.success) {
      throw new MemoriesClientError("Invalid SDK response envelope", {
        status: response.status,
        type: "http_error",
        errorCode: "INVALID_RESPONSE_ENVELOPE",
        retryable: false,
        details: json,
      })
    }

    const envelope: MemoriesResponseEnvelope<unknown> = {
      ok: parsedEnvelope.data.ok,
      data: parsedEnvelope.data.data,
      error: parsedEnvelope.data.error,
      meta: parsedEnvelope.data.meta,
    }

    if (!envelope.ok) {
      const envelopeError = envelope.error ?? {
        type: "tool_error",
        code: "SDK_ENDPOINT_ERROR",
        message: "SDK endpoint returned an error",
        retryable: false,
      }
      throw toClientError(envelopeError, { status: response.status })
    }

    return {
      raw: typeof envelope.data === "string" ? envelope.data : JSON.stringify(envelope.data ?? {}),
      structured: envelope.data,
      envelope,
    }
  }

  private async callSdkEndpoint(path: string, body: Record<string, unknown>): Promise<ParsedToolResult> {
    return this.callSdkRequest(path, { method: "POST", body })
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
