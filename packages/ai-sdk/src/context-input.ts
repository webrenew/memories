import type { ContextGetInput } from "@memories.sh/core"
import type { MemoriesBaseOptions } from "./types"

export function resolveContextInput(
  input: ContextGetInput = {},
  defaults: Pick<MemoriesBaseOptions, "projectId" | "userId" | "tenantId"> = {}
): ContextGetInput {
  return {
    ...input,
    projectId: input.projectId ?? defaults.projectId,
    userId: input.userId ?? defaults.userId,
    tenantId: input.tenantId ?? defaults.tenantId,
  }
}
