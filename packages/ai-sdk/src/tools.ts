import type { ContextGetInput, MemoryAddInput, MemoryEditInput, MemoryListOptions, MemorySearchOptions, MemoryType } from "@memories.sh/core"
import { resolveClient } from "./client"
import type { MemoriesBaseOptions, MemoriesTools } from "./types"

export function getContext(options: MemoriesBaseOptions = {}) {
  const client = resolveClient(options)
  return async (input: ContextGetInput = {}) =>
    client.context.get({
      query: input.query,
      limit: input.limit,
      includeRules: input.includeRules,
      projectId: input.projectId ?? options.projectId,
      userId: input.userId ?? options.userId,
      tenantId: input.tenantId ?? options.tenantId,
      mode: input.mode,
    })
}

export function storeMemory(options: MemoriesBaseOptions = {}) {
  const client = resolveClient(options)
  return async (input: MemoryAddInput) =>
    client.memories.add({
      ...input,
      projectId: input.projectId ?? options.projectId,
    })
}

export function searchMemories(options: MemoriesBaseOptions = {}) {
  const client = resolveClient(options)
  return async (input: {
    query: string
    type?: MemoryType
    layer?: MemorySearchOptions["layer"]
    limit?: number
    projectId?: string
  }) =>
    client.memories.search(input.query, {
      type: input.type,
      layer: input.layer,
      limit: input.limit,
      projectId: input.projectId ?? options.projectId,
    })
}

export function listMemories(options: MemoriesBaseOptions = {}) {
  const client = resolveClient(options)
  return async (input: {
    type?: MemoryType
    layer?: MemoryListOptions["layer"]
    tags?: string
    limit?: number
    projectId?: string
  } = {}) =>
    client.memories.list({
      type: input.type,
      layer: input.layer,
      tags: input.tags,
      limit: input.limit,
      projectId: input.projectId ?? options.projectId,
    })
}

export function forgetMemory(options: MemoriesBaseOptions = {}) {
  const client = resolveClient(options)
  return async (input: { id: string }) => client.memories.forget(input.id)
}

export function editMemory(options: MemoriesBaseOptions = {}) {
  const client = resolveClient(options)
  return async (input: { id: string; updates: MemoryEditInput }) =>
    client.memories.edit(input.id, input.updates)
}

export function memoriesTools(options: MemoriesBaseOptions = {}): MemoriesTools {
  return {
    getContext: getContext(options),
    storeMemory: storeMemory(options),
    searchMemories: searchMemories(options),
    listMemories: listMemories(options),
    forgetMemory: forgetMemory(options),
    editMemory: editMemory(options),
  }
}
