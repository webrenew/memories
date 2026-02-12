export type MemoryType = "rule" | "decision" | "fact" | "note" | "skill"
export type MemoryLayer = "rule" | "working" | "long_term"
export type ContextStrategy = "baseline" | "hybrid_graph"

export type MemoryScope = "global" | "project" | "unknown"

export type MemoriesErrorType =
  | "auth_error"
  | "validation_error"
  | "rate_limit_error"
  | "not_found_error"
  | "tool_error"
  | "method_error"
  | "rpc_error"
  | "http_error"
  | "network_error"
  | "internal_error"
  | "unknown_error"

export interface MemoriesErrorData {
  type: MemoriesErrorType | string
  code: string
  message: string
  status?: number
  retryable?: boolean
  details?: unknown
}

export interface MemoriesResponseEnvelope<T> {
  ok: boolean
  data: T | null
  error: MemoriesErrorData | null
  meta?: Record<string, unknown>
}

export interface MemoryRecord {
  id: string | null
  content: string
  type: MemoryType
  layer: MemoryLayer
  expiresAt?: string | null
  scope: MemoryScope
  projectId: string | null
  tags: string[]
  graph?: {
    whyIncluded: "graph_expansion"
    linkedViaNode: string
    edgeType: string
    hopCount: number
    seedMemoryId: string
  } | null
  raw?: string
}

export interface ContextResult {
  rules: MemoryRecord[]
  memories: MemoryRecord[]
  trace?: {
    requestedStrategy?: ContextStrategy
    strategy: ContextStrategy
    graphDepth: 0 | 1 | 2
    graphLimit: number
    rolloutMode?: "off" | "shadow" | "canary"
    shadowExecuted?: boolean
    baselineCandidates: number
    graphCandidates: number
    graphExpandedCount: number
    fallbackTriggered?: boolean
    fallbackReason?: string | null
    totalCandidates: number
  }
  raw: string
}

export type ContextMode = "all" | "working" | "long_term" | "rules_only"

export interface ContextGetOptions {
  limit?: number
  includeRules?: boolean
  projectId?: string
  userId?: string
  tenantId?: string
  mode?: ContextMode
  strategy?: ContextStrategy
  graphDepth?: 0 | 1 | 2
  graphLimit?: number
}

export interface ContextGetInput extends ContextGetOptions {
  query?: string
}

export interface MemoryAddInput {
  content: string
  type?: MemoryType
  layer?: MemoryLayer
  tags?: string[]
  paths?: string[]
  category?: string
  metadata?: Record<string, unknown>
  projectId?: string
}

export interface MemoryEditInput {
  content?: string
  type?: MemoryType
  layer?: MemoryLayer
  tags?: string[]
  paths?: string[]
  category?: string
  metadata?: Record<string, unknown> | null
}

export interface MemorySearchOptions {
  type?: MemoryType
  layer?: MemoryLayer
  limit?: number
  projectId?: string
}

export interface MemoryListOptions {
  type?: MemoryType
  layer?: MemoryLayer
  tags?: string
  limit?: number
  projectId?: string
}

export interface MutationResult {
  ok: true
  message: string
  raw: string
  envelope?: MemoriesResponseEnvelope<unknown>
}

export interface ManagementKeyStatus {
  hasKey: boolean
  keyPreview?: string
  createdAt?: string | null
  expiresAt?: string | null
  isExpired?: boolean
}

export interface ManagementKeyCreateInput {
  expiresAt: string
}

export interface ManagementKeyCreateResult {
  apiKey: string
  keyPreview?: string
  createdAt?: string
  expiresAt?: string
  message?: string
}

export interface ManagementKeyRevokeResult {
  ok: boolean
}

export type ManagementTenantMode = "provision" | "attach"

export interface ManagementTenantMapping {
  tenantId: string
  tursoDbUrl: string
  tursoDbName?: string | null
  status: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  lastVerifiedAt?: string | null
}

export interface ManagementTenantListResult {
  tenantDatabases: ManagementTenantMapping[]
  count: number
}

export interface ManagementTenantUpsertInput {
  tenantId: string
  mode?: ManagementTenantMode
  tursoDbUrl?: string
  tursoDbToken?: string
  tursoDbName?: string
  metadata?: Record<string, unknown>
}

export interface ManagementTenantUpsertResult {
  tenantDatabase: ManagementTenantMapping
  provisioned: boolean
  mode: string
}

export interface ManagementTenantDisableResult {
  ok: boolean
  tenantId: string
  status: string
  updatedAt: string
}

export interface BuildSystemPromptInput {
  rules?: MemoryRecord[]
  memories?: MemoryRecord[]
}
