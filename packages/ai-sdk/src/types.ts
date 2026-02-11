import type {
  ContextGetInput,
  ContextMode,
  ContextResult,
  MemoriesClient,
  MemoriesClientOptions,
  MemoryAddInput,
  MemoryEditInput,
  MemoryListOptions,
  MemoryRecord,
  MemorySearchOptions,
  MutationResult,
} from "@memories.sh/core"

export interface MemoriesBaseOptions extends Omit<MemoriesClientOptions, "userId"> {
  client?: MemoriesClient
  userId?: string
  projectId?: string
}

export interface MemoriesMiddlewareOptions extends MemoriesBaseOptions {
  limit?: number
  includeRules?: boolean
  mode?: ContextMode
  extractQuery?: (params: unknown) => string | undefined
  preloaded?: ContextResult
}

export interface MemoriesSystemPromptOptions {
  includeInstructions?: boolean
  persona?: string
  rules?: Array<Pick<MemoryRecord, "content"> | string>
}

export interface CreateMemoriesOnFinishOptions extends MemoriesBaseOptions {
  mode?: "tool-calls-only" | "auto-extract"
  extractMemories?: (payload: unknown) => MemoryAddInput[]
}

export interface MemoriesTools {
  getContext: (input?: ContextGetInput) => Promise<ContextResult>
  storeMemory: (input: MemoryAddInput) => Promise<MutationResult>
  searchMemories: (input: { query: string } & MemorySearchOptions) => Promise<MemoryRecord[]>
  listMemories: (input?: MemoryListOptions) => Promise<MemoryRecord[]>
  forgetMemory: (input: { id: string }) => Promise<MutationResult>
  editMemory: (input: { id: string; updates: MemoryEditInput }) => Promise<MutationResult>
}
