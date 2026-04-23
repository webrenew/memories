import type { ContextGetInput } from "@memories.sh/core"
import type { MemoriesBaseOptions } from "./types"

export function resolveContextInput(
  input: ContextGetInput = {},
  defaults: Pick<MemoriesBaseOptions, "projectId" | "userId" | "tenantId"> = {}
): ContextGetInput {
  const { projectId, userId, tenantId, ...rest } = input

  return {
    ...rest,
    projectId: projectId ?? defaults.projectId,
    userId: userId ?? defaults.userId,
    tenantId: tenantId ?? defaults.tenantId,
  }
}
