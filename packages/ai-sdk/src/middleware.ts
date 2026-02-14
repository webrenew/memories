import { defaultExtractQuery } from "./query"
import { resolveClient } from "./client"
import type { ContextResult } from "@memories.sh/core"
import type { MemoriesMiddlewareOptions } from "./types"

type MiddlewareEnvelope = {
  params: Record<string, unknown>
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toSystemString(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item
        if (isRecord(item) && typeof item.text === "string") return item.text
        return ""
      })
      .filter(Boolean)
      .join("\n")
  }

  return ""
}

function mergeSystemPrompt(existingSystem: unknown, memoryBlock: string): string {
  const existing = toSystemString(existingSystem).trim()
  if (!existing) return memoryBlock
  return `${memoryBlock}\n\n${existing}`
}

function emptyContext(): ContextResult {
  return { rules: [], memories: [], skillFiles: [], raw: "" }
}

export function memoriesMiddleware(options: MemoriesMiddlewareOptions = {}): { transformParams: (input: unknown) => Promise<unknown> } {
  const client = resolveClient(options)
  const includeRules = options.includeRules ?? true
  const limit = options.limit ?? 10

  return {
    async transformParams(input: unknown) {
      const isEnvelope = isRecord(input) && isRecord(input.params)
      const params: Record<string, unknown> = isEnvelope && isRecord(input) && isRecord(input.params) ? input.params : (isRecord(input) ? input : {})

      const query = options.extractQuery?.(params) ?? defaultExtractQuery(params)

      const context =
        options.preloaded ??
        (query || includeRules
          ? await client.context.get({
              query,
              limit,
              includeRules,
              projectId: options.projectId,
              userId: options.userId,
              tenantId: options.tenantId,
              mode: options.mode,
              strategy: options.strategy,
              graphDepth: options.graphDepth,
              graphLimit: options.graphLimit,
            })
          : emptyContext())

      const memoryBlock = client.buildSystemPrompt({
        rules: includeRules ? context.rules : [],
        memories: context.memories,
        skillFiles: context.skillFiles ?? [],
      })

      if (!memoryBlock) {
        return input
      }

      const nextParams = {
        ...params,
        system: mergeSystemPrompt(params.system, memoryBlock),
      }

      if (!isEnvelope) {
        return nextParams
      }

      return {
        ...input,
        params: nextParams,
      }
    },
  }
}
