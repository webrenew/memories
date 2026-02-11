import { resolveClient } from "./client"
import type { MemoriesBaseOptions } from "./types"
import type { ContextGetInput, ContextResult } from "@memories.sh/core"

export interface PreloadContextOptions extends MemoriesBaseOptions, ContextGetInput {}

export async function preloadContext(options: PreloadContextOptions = {}): Promise<ContextResult> {
  const client = resolveClient(options)
  return client.context.get({
    query: options.query,
    limit: options.limit,
    includeRules: options.includeRules,
    projectId: options.projectId,
    userId: options.userId,
    tenantId: options.tenantId,
    mode: options.mode,
  })
}
