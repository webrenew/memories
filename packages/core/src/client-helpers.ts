import { z } from "zod"
import type {
  ContextGetInput,
  ContextGetOptions,
  ContextMode,
  ContextStrategy,
  MemoriesErrorData,
  MemoriesResponseEnvelope,
  MemoryRecord,
  SkillFileRecord,
} from "./types"
import {
  apiErrorSchema,
  legacyHttpErrorSchema,
  mutationEnvelopeDataSchema,
  responseEnvelopeSchema,
  structuredMemorySchema,
  structuredSkillFileSchema,
} from "./client-schemas"
import { MemoriesClientError } from "./client-error"

export interface RpcErrorPayload {
  code: number
  message: string
  data?: unknown
}

export interface RpcResponsePayload {
  result?: unknown
  error?: RpcErrorPayload
}

export interface ParsedToolResult {
  raw: string
  structured: unknown
  envelope: MemoriesResponseEnvelope<unknown> | null
}

export interface ContextBuckets {
  working: z.infer<typeof structuredMemorySchema>[]
  longTerm: z.infer<typeof structuredMemorySchema>[]
}

export interface NormalizedContextInput extends ContextGetInput {
  mode: ContextMode
  strategy: ContextStrategy
  graphDepth: 0 | 1 | 2
  graphLimit: number
}

export type ContextGetMethod = {
  (input?: ContextGetInput): Promise<import("./types").ContextResult>
  (query?: string, options?: ContextGetOptions): Promise<import("./types").ContextResult>
}

const contextModes = new Set<ContextMode>(["all", "working", "long_term", "rules_only"])
const contextStrategies = new Set<ContextStrategy>(["baseline", "hybrid_graph"])

export function errorTypeForStatus(status: number): MemoriesErrorData["type"] {
  if (status === 400) return "validation_error"
  if (status === 401 || status === 403) return "auth_error"
  if (status === 404) return "not_found_error"
  if (status === 429) return "rate_limit_error"
  if (status >= 500) return "internal_error"
  return "http_error"
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export function toTypedHttpError(status: number, payload: unknown): MemoriesErrorData {
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

export function readDefaultApiKey(): string | undefined {
  if (typeof process === "undefined") return undefined
  return process.env.MEMORIES_API_KEY
}

export function normalizeMemoryType(type: string): MemoryRecord["type"] {
  if (type === "rule" || type === "decision" || type === "fact" || type === "note" || type === "skill") {
    return type
  }
  return "note"
}

export function normalizeMemoryLayer(layer: string | undefined, type: MemoryRecord["type"]): MemoryRecord["layer"] {
  if (layer === "rule" || layer === "working" || layer === "long_term") {
    return layer
  }
  return type === "rule" ? "rule" : "long_term"
}

export function normalizeMemoryScope(scope: string): MemoryRecord["scope"] {
  if (scope === "global" || scope === "project" || scope === "unknown") {
    return scope
  }
  return "unknown"
}

export function toMemoryRecord(memory: z.infer<typeof structuredMemorySchema>): MemoryRecord {
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

export function toSkillFileRecord(skillFile: z.infer<typeof structuredSkillFileSchema>): SkillFileRecord {
  return {
    id: skillFile.id,
    path: skillFile.path,
    content: skillFile.content,
    scope: normalizeMemoryScope(skillFile.scope),
    projectId: skillFile.projectId ?? null,
    userId: skillFile.userId ?? null,
    createdAt: skillFile.createdAt,
    updatedAt: skillFile.updatedAt,
  }
}

export function dedupeMemories(records: z.infer<typeof structuredMemorySchema>[]): z.infer<typeof structuredMemorySchema>[] {
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

export function normalizeContextMode(mode: unknown): ContextMode {
  if (typeof mode === "string" && contextModes.has(mode as ContextMode)) {
    return mode as ContextMode
  }
  return "all"
}

export function normalizeContextStrategy(strategy: unknown): ContextStrategy {
  if (typeof strategy === "string" && contextStrategies.has(strategy as ContextStrategy)) {
    return strategy as ContextStrategy
  }
  return "baseline"
}

export function normalizeGraphDepth(depth: unknown): 0 | 1 | 2 {
  if (depth === 0 || depth === 1 || depth === 2) {
    return depth
  }
  return 1
}

export function normalizeGraphLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 8
  }
  return Math.max(1, Math.min(Math.floor(limit), 50))
}

export function normalizeContextInput(
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

export function partitionByLayer(records: z.infer<typeof structuredMemorySchema>[]): ContextBuckets {
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

export function pickMemoriesForMode(
  mode: ContextMode,
  structured: z.infer<typeof import("./client-schemas").contextStructuredSchema>
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

export function toClientError(error: MemoriesErrorData, options?: { status?: number; rpcCode?: number }) {
  return new MemoriesClientError(error.message, {
    status: error.status ?? options?.status,
    code: options?.rpcCode,
    type: error.type,
    errorCode: error.code,
    retryable: error.retryable,
    details: error.details,
  })
}

export function parseToolResult(result: unknown): ParsedToolResult {
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

export function messageFromEnvelope(envelope: MemoriesResponseEnvelope<unknown> | null): string | null {
  if (!envelope?.data || typeof envelope.data !== "object") return null
  const parsed = mutationEnvelopeDataSchema.safeParse(envelope.data)
  if (!parsed.success || typeof parsed.data.message !== "string") return null
  return parsed.data.message
}

export function parseStructuredData<T>(
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

export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

export function deriveSdkBaseUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/api/mcp")) {
    return baseUrl.slice(0, -"/api/mcp".length)
  }
  if (baseUrl.endsWith("/api/sdk/v1")) {
    return baseUrl.slice(0, -"/api/sdk/v1".length)
  }
  return baseUrl
}

export function deriveMcpUrl(baseUrl: string, sdkBaseUrl: string): string {
  if (baseUrl.endsWith("/api/mcp")) {
    return baseUrl
  }
  return `${sdkBaseUrl}/api/mcp`
}
