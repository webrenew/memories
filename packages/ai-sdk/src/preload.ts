import { resolveClient } from "./client"
import { resolveContextInput } from "./context-input"
import type { MemoriesBaseOptions } from "./types"
import type { ContextGetInput, ContextResult } from "@memories.sh/core"

export interface PreloadContextOptions extends MemoriesBaseOptions, ContextGetInput {}

export async function preloadContext(options: PreloadContextOptions = {}): Promise<ContextResult> {
  const client = resolveClient(options)
  return client.context.get(resolveContextInput(options, options))
}
