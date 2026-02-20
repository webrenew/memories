import { z } from "zod"
import { parseContextResponse, parseMemoryListResponse } from "./parsers"
import { buildSystemPrompt } from "./system-prompt"
import type {
  BuildSystemPromptInput,
  BulkForgetFilter,
  BulkForgetResult,
  ContextGetInput,
  ContextGetOptions,
  ContextResult,
  ManagementKeyCreateInput,
  ManagementKeyCreateResult,
  ManagementEmbeddingModelListOptions,
  ManagementEmbeddingModelListResult,
  ManagementEmbeddingUsageOptions,
  ManagementEmbeddingUsageResult,
  ManagementKeyRevokeResult,
  ManagementKeyStatus,
  ManagementTenantDisableResult,
  ManagementTenantListResult,
  ManagementTenantUpsertInput,
  ManagementTenantUpsertResult,
  MemoriesErrorData,
  MemoriesResponseEnvelope,
  MemoryAddInput,
  SkillFileDeleteInput,
  SkillFileListOptions,
  SkillFileRecord,
  SkillFileUpsertInput,
  MemoryEditInput,
  MemoryListOptions,
  MemoryRecord,
  MemorySearchOptions,
  MutationResult,
  VacuumResult,
} from "./types"
import {
  apiErrorSchema,
  baseUrlSchema,
  bulkForgetResultSchema,
  contextStructuredSchema,
  managementKeyCreateSchema,
  managementEmbeddingModelsSchema,
  managementEmbeddingUsageSchema,
  managementKeyRevokeSchema,
  managementKeyStatusSchema,
  managementTenantDisableSchema,
  managementTenantListSchema,
  managementTenantUpsertSchema,
  memoriesStructuredSchema,
  responseEnvelopeSchema,
  skillFilesStructuredSchema,
  vacuumResultSchema,
} from "./client-schemas"
import {
  type ContextGetMethod,
  type ParsedToolResult,
  type RpcResponsePayload,
  deriveMcpUrl,
  deriveSdkBaseUrl,
  messageFromEnvelope,
  normalizeContextInput,
  parseStructuredData,
  parseToolResult,
  pickMemoriesForMode,
  readDefaultApiKey,
  stripTrailingSlash,
  toMcpContextStrategy,
  toClientError,
  toSdkContextStrategy,
  toMemoryRecord,
  toSkillFileRecord,
  toTypedHttpError,
} from "./client-helpers"
import { MemoriesClientError } from "./client-error"

export { MemoriesClientError } from "./client-error"

export interface MemoriesClientOptions {
  apiKey?: string
  baseUrl?: string
  transport?: "sdk_http" | "mcp" | "auto"
  userId?: string
  tenantId?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
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
      const strategy = toSdkContextStrategy(input.strategy)
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
            includeSkillFiles: input.includeSkillFiles,
            mode: input.mode,
            strategy,
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
            retrieval_strategy: toMcpContextStrategy(input.strategy),
            graph_depth: input.graphDepth,
            graph_limit: input.graphLimit,
          })

      const structured = contextStructuredSchema.safeParse(result.structured)
      if (structured.success) {
        const orderedMemories = pickMemoriesForMode(input.mode, structured.data)
        const parsedFromStructured: ContextResult = {
          rules: structured.data.rules.map(toMemoryRecord),
          memories: orderedMemories.map(toMemoryRecord),
          skillFiles: structured.data.skillFiles.map(toSkillFileRecord),
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
            embeddingModel: input.embeddingModel,
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
            embedding_model: input.embeddingModel,
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
      const strategy = options.strategy ? toSdkContextStrategy(options.strategy) : undefined
      const rawScope = this.withDefaultScopeSdk({ projectId: options.projectId })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/search", {
            query,
            type: options.type,
            layer: options.layer,
            strategy,
            limit: options.limit,
            scope: sdkScope,
          })
        : await this.callTool("search_memories", {
            query,
            type: options.type,
            layer: options.layer,
            limit: options.limit,
            ...(strategy ? { retrieval_strategy: toMcpContextStrategy(strategy) } : {}),
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
            embeddingModel: updates.embeddingModel,
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
            embedding_model: updates.embeddingModel,
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

    bulkForget: async (filters: BulkForgetFilter, options?: { dryRun?: boolean }): Promise<BulkForgetResult> => {
      const rawScope = this.withDefaultScopeSdk({})
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const dryRun = options?.dryRun ?? false

      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/bulk-forget", {
            filters: {
              types: filters.types,
              tags: filters.tags,
              olderThanDays: filters.olderThanDays,
              pattern: filters.pattern,
              projectId: filters.projectId,
              all: filters.all,
            },
            dryRun,
            scope: sdkScope,
          })
        : await this.callTool("bulk_forget_memories", {
            types: filters.types,
            tags: filters.tags,
            older_than_days: filters.olderThanDays,
            pattern: filters.pattern,
            project_id: filters.projectId,
            all: filters.all,
            dry_run: dryRun,
          })

      const structured = bulkForgetResultSchema.safeParse(result.structured)
      if (structured.success) {
        return {
          ok: true,
          count: structured.data.count,
          ids: structured.data.ids,
          memories: structured.data.memories,
          message: structured.data.message,
          raw: result.raw,
          envelope: result.envelope ?? undefined,
        }
      }

      const message = (messageFromEnvelope(result.envelope) ?? result.raw) || "Bulk forget completed"
      return {
        ok: true,
        count: 0,
        message,
        raw: result.raw,
        envelope: result.envelope ?? undefined,
      }
    },

    vacuum: async (): Promise<VacuumResult> => {
      const rawScope = this.withDefaultScopeSdk()
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined

      const result = this.transport === "sdk_http"
        ? await this.callSdkEndpoint("/api/sdk/v1/memories/vacuum", { scope: sdkScope })
        : await this.callTool("vacuum_memories", {})

      const structured = vacuumResultSchema.safeParse(result.structured)
      if (structured.success) {
        return {
          ok: true,
          purged: structured.data.purged,
          message: structured.data.message,
          raw: result.raw,
          envelope: result.envelope ?? undefined,
        }
      }

      const message = (messageFromEnvelope(result.envelope) ?? result.raw) || "Vacuum completed"
      return {
        ok: true,
        purged: 0,
        message,
        raw: result.raw,
        envelope: result.envelope ?? undefined,
      }
    },
  }

  readonly skills = {
    upsertFile: async (input: SkillFileUpsertInput): Promise<MutationResult> => {
      const rawScope = this.withDefaultScopeSdk({
        projectId: input.projectId,
        userId: input.userId,
        tenantId: input.tenantId,
      })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = await this.callSdkEndpoint("/api/sdk/v1/skills/files/upsert", {
        path: input.path,
        content: input.content,
        scope: sdkScope,
      })

      const message = (messageFromEnvelope(result.envelope) ?? result.raw) || `Upserted skill file ${input.path}`
      return {
        ok: true,
        message,
        raw: result.raw,
        envelope: result.envelope ?? undefined,
      }
    },

    listFiles: async (options: SkillFileListOptions = {}): Promise<SkillFileRecord[]> => {
      const rawScope = this.withDefaultScopeSdk({
        projectId: options.projectId,
        userId: options.userId,
        tenantId: options.tenantId,
      })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = await this.callSdkEndpoint("/api/sdk/v1/skills/files/list", {
        limit: options.limit,
        scope: sdkScope,
      })

      const structured = skillFilesStructuredSchema.safeParse(result.structured)
      if (!structured.success) {
        return []
      }

      return structured.data.skillFiles.map(toSkillFileRecord)
    },

    deleteFile: async (input: SkillFileDeleteInput): Promise<MutationResult> => {
      const rawScope = this.withDefaultScopeSdk({
        projectId: input.projectId,
        userId: input.userId,
        tenantId: input.tenantId,
      })
      const sdkScope = rawScope && Object.keys(rawScope).length > 0 ? rawScope : undefined
      const result = await this.callSdkEndpoint("/api/sdk/v1/skills/files/delete", {
        path: input.path,
        scope: sdkScope,
      })

      const message = (messageFromEnvelope(result.envelope) ?? result.raw) || `Deleted skill file ${input.path}`
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
        const endpoint = "/api/sdk/v1/management/tenant-overrides"
        const result = await this.callSdkRequest(endpoint, { method: "GET" })
        return parseStructuredData(managementTenantListSchema, endpoint, result.structured)
      },

      upsert: async (input: ManagementTenantUpsertInput): Promise<ManagementTenantUpsertResult> => {
        const endpoint = "/api/sdk/v1/management/tenant-overrides"
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
        const endpoint = "/api/sdk/v1/management/tenant-overrides"
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

    embeddings: {
      list: async (options: ManagementEmbeddingModelListOptions = {}): Promise<ManagementEmbeddingModelListResult> => {
        const endpoint = "/api/sdk/v1/embeddings/models"
        const result = await this.callSdkRequest(endpoint, {
          method: "GET",
          query: {
            tenantId: options.tenantId,
            projectId: options.projectId,
            embeddingModel: options.embeddingModel,
          },
        })

        return parseStructuredData(managementEmbeddingModelsSchema, endpoint, result.structured)
      },

      usage: async (options: ManagementEmbeddingUsageOptions = {}): Promise<ManagementEmbeddingUsageResult> => {
        const endpoint = "/api/sdk/v1/management/embeddings/usage"
        const result = await this.callSdkRequest(endpoint, {
          method: "GET",
          query: {
            usageMonth: options.usageMonth,
            tenantId: options.tenantId,
            projectId: options.projectId,
            limit: options.limit,
          },
        })

        return parseStructuredData(managementEmbeddingUsageSchema, endpoint, result.structured)
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
