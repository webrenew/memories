import type { ContextGetInput, MemoryAddInput, MemoryEditInput, MemoryListOptions, MemorySearchOptions, MemoryType, BulkForgetFilter } from "@memories.sh/core"
import { resolveClient } from "./client"
import type { MemoriesBaseOptions, MemoriesTools } from "./types"

export function getContext(options: MemoriesBaseOptions = {}): MemoriesTools["getContext"] {
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
      strategy: input.strategy,
      graphDepth: input.graphDepth,
      graphLimit: input.graphLimit,
    })
}

export function storeMemory(options: MemoriesBaseOptions = {}): MemoriesTools["storeMemory"] {
  const client = resolveClient(options)
  return async (input: MemoryAddInput) =>
    client.memories.add({
      ...input,
      projectId: input.projectId ?? options.projectId,
    })
}

export function searchMemories(options: MemoriesBaseOptions = {}): MemoriesTools["searchMemories"] {
  const client = resolveClient(options)
  return async (input: {
    query: string
    type?: MemoryType
    layer?: MemorySearchOptions["layer"]
    strategy?: MemorySearchOptions["strategy"]
    limit?: number
    projectId?: string
  }) =>
    client.memories.search(input.query, {
      type: input.type,
      layer: input.layer,
      strategy: input.strategy,
      limit: input.limit,
      projectId: input.projectId ?? options.projectId,
    })
}

export function listMemories(options: MemoriesBaseOptions = {}): MemoriesTools["listMemories"] {
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

export function forgetMemory(options: MemoriesBaseOptions = {}): MemoriesTools["forgetMemory"] {
  const client = resolveClient(options)
  return async (input: { id: string }) => client.memories.forget(input.id)
}

export function editMemory(options: MemoriesBaseOptions = {}): MemoriesTools["editMemory"] {
  const client = resolveClient(options)
  return async (input: { id: string; updates: MemoryEditInput }) =>
    client.memories.edit(input.id, input.updates)
}

export function upsertSkillFile(options: MemoriesBaseOptions = {}): MemoriesTools["upsertSkillFile"] {
  const client = resolveClient(options)
  return async (input: { path: string; content: string; projectId?: string; userId?: string; tenantId?: string }) =>
    client.skills.upsertFile({
      ...input,
      projectId: input.projectId ?? options.projectId,
      userId: input.userId ?? options.userId,
      tenantId: input.tenantId ?? options.tenantId,
    })
}

export function listSkillFiles(options: MemoriesBaseOptions = {}): MemoriesTools["listSkillFiles"] {
  const client = resolveClient(options)
  return async (input: { limit?: number; projectId?: string; userId?: string; tenantId?: string } = {}) =>
    client.skills.listFiles({
      limit: input.limit,
      projectId: input.projectId ?? options.projectId,
      userId: input.userId ?? options.userId,
      tenantId: input.tenantId ?? options.tenantId,
    })
}

export function deleteSkillFile(options: MemoriesBaseOptions = {}): MemoriesTools["deleteSkillFile"] {
  const client = resolveClient(options)
  return async (input: { path: string; projectId?: string; userId?: string; tenantId?: string }) =>
    client.skills.deleteFile({
      ...input,
      projectId: input.projectId ?? options.projectId,
      userId: input.userId ?? options.userId,
      tenantId: input.tenantId ?? options.tenantId,
    })
}

export function bulkForgetMemories(options: MemoriesBaseOptions = {}): MemoriesTools["bulkForgetMemories"] {
  const client = resolveClient(options)
  return async (input: { filters: BulkForgetFilter; dryRun?: boolean }) =>
    client.memories.bulkForget(
      {
        ...input.filters,
        projectId: input.filters.projectId ?? options.projectId,
      },
      { dryRun: input.dryRun }
    )
}

export function vacuumMemories(options: MemoriesBaseOptions = {}): MemoriesTools["vacuumMemories"] {
  const client = resolveClient(options)
  return async () => client.memories.vacuum()
}

export function memoriesTools(options: MemoriesBaseOptions = {}): MemoriesTools {
  return {
    getContext: getContext(options),
    storeMemory: storeMemory(options),
    searchMemories: searchMemories(options),
    listMemories: listMemories(options),
    forgetMemory: forgetMemory(options),
    editMemory: editMemory(options),
    upsertSkillFile: upsertSkillFile(options),
    listSkillFiles: listSkillFiles(options),
    deleteSkillFile: deleteSkillFile(options),
    bulkForgetMemories: bulkForgetMemories(options),
    vacuumMemories: vacuumMemories(options),
  }
}
