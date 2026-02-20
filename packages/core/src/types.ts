export type MemoryType = "rule" | "decision" | "fact" | "note" | "skill"
export type MemoryLayer = "rule" | "working" | "long_term"
export type RetrievalStrategy = "lexical" | "semantic" | "hybrid"
export type LegacyContextStrategy = "baseline" | "hybrid_graph"
export type ContextStrategy = RetrievalStrategy | LegacyContextStrategy

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
  skillFiles?: SkillFileRecord[]
  trace?: {
    requestedStrategy?: ContextStrategy
    strategy: ContextStrategy
    retrievalPolicyDefaultStrategy?: "lexical" | "hybrid"
    retrievalPolicyAppliedStrategy?: "lexical" | "hybrid"
    retrievalPolicySelection?: "request" | "policy_default"
    retrievalPolicyReadyForDefaultOn?: boolean
    retrievalPolicyBlockerCodes?: string[]
    semanticStrategyRequested?: RetrievalStrategy
    semanticStrategyApplied?: RetrievalStrategy
    lexicalCandidates?: number
    semanticCandidates?: number
    semanticFallbackTriggered?: boolean
    semanticFallbackReason?: string | null
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
  includeSkillFiles?: boolean
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

export interface SkillFileRecord {
  id: string
  path: string
  content: string
  scope: MemoryScope
  projectId: string | null
  userId: string | null
  createdAt: string
  updatedAt: string
}

export interface SkillFileScopeOptions {
  projectId?: string
  userId?: string
  tenantId?: string
}

export interface SkillFileUpsertInput extends SkillFileScopeOptions {
  path: string
  content: string
}

export interface SkillFileListOptions extends SkillFileScopeOptions {
  limit?: number
}

export interface SkillFileDeleteInput extends SkillFileScopeOptions {
  path: string
}

export interface MemoryAddInput {
  content: string
  type?: MemoryType
  layer?: MemoryLayer
  tags?: string[]
  paths?: string[]
  category?: string
  metadata?: Record<string, unknown>
  embeddingModel?: string
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
  embeddingModel?: string
}

export interface MemorySearchOptions {
  type?: MemoryType
  layer?: MemoryLayer
  strategy?: ContextStrategy
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

export interface BulkForgetFilter {
  types?: MemoryType[]
  tags?: string[]
  olderThanDays?: number
  pattern?: string
  projectId?: string
  all?: boolean
}

export interface BulkForgetResult {
  ok: true
  count: number
  ids?: string[]
  memories?: { id: string; type: string; contentPreview: string }[]
  message: string
  raw: string
  envelope?: MemoriesResponseEnvelope<unknown>
}

export interface VacuumResult {
  ok: true
  purged: number
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
export type ManagementTenantSource = "auto" | "override"

export interface ManagementTenantMapping {
  tenantId: string
  tursoDbUrl: string
  tursoDbName?: string | null
  status: string
  source: ManagementTenantSource
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

export interface ManagementEmbeddingModel {
  id: string
  name: string
  provider: string
  description: string | null
  contextWindow: number | null
  pricing: {
    input: string | null
  }
  inputCostUsdPerToken: number | null
  tags: string[]
}

export interface ManagementEmbeddingConfig {
  selectedModelId: string
  source: "request" | "project" | "workspace" | "system_default"
  workspaceDefaultModelId: string | null
  projectOverrideModelId: string | null
  allowlistModelIds: string[]
}

export interface ManagementEmbeddingModelListOptions {
  tenantId?: string
  projectId?: string
  embeddingModel?: string
}

export interface ManagementEmbeddingModelListResult {
  models: ManagementEmbeddingModel[]
  config: ManagementEmbeddingConfig
}

export interface ManagementEmbeddingUsageOptions {
  usageMonth?: string
  tenantId?: string
  projectId?: string
  limit?: number
}

export interface ManagementEmbeddingUsageSummary {
  usageMonth: string
  requestCount: number
  estimatedRequestCount: number
  inputTokens: number
  gatewayCostUsd: number
  marketCostUsd: number
  customerCostUsd: number
}

export interface ManagementEmbeddingUsageBreakdown extends ManagementEmbeddingUsageSummary {
  tenantId: string | null
  projectId: string | null
  modelId: string
  provider: string
}

export interface ManagementEmbeddingUsageResult {
  usageMonth: string
  summary: ManagementEmbeddingUsageSummary
  breakdown: ManagementEmbeddingUsageBreakdown[]
}

export interface BuildSystemPromptInput {
  rules?: MemoryRecord[]
  memories?: MemoryRecord[]
  skillFiles?: SkillFileRecord[]
}
