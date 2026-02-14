import { resolveClient } from "./client"
import type { CreateMemoriesOnFinishOptions } from "./types"

export function createMemoriesOnFinish(options: CreateMemoriesOnFinishOptions = {}): (payload: unknown) => Promise<void> {
  const mode = options.mode ?? "tool-calls-only"
  const client = resolveClient(options)

  return async (payload: unknown) => {
    if (mode === "tool-calls-only") {
      return
    }

    const extracted = options.extractMemories?.(payload) ?? []
    if (extracted.length === 0) {
      return
    }

    await Promise.all(
      extracted.map((memory) =>
        client.memories.add({
          ...memory,
          projectId: memory.projectId ?? options.projectId,
        })
      )
    )
  }
}
