import type { ContextGetInput } from "@memories.sh/core"
import type { MemoriesBaseOptions } from "./types"

export function resolveContextInput(
  input: ContextGetInput = {},
  defaults: Pick<MemoriesBaseOptions, "projectId" | "userId" | "tenantId"> = {}
): ContextGetInput {
  const {
    query,
    limit,
    includeRules,
    includeSkillFiles,
    mode,
    strategy,
    graphDepth,
    graphLimit,
    sessionId,
    budgetTokens,
    turnCount,
    turnBudget,
    lastActivityAt,
    inactivityThresholdMinutes,
    taskCompleted,
    includeSessionSummary,
    projectId,
    userId,
    tenantId,
  } = input

  return {
    query,
    limit,
    includeRules,
    includeSkillFiles,
    mode,
    strategy,
    graphDepth,
    graphLimit,
    sessionId,
    budgetTokens,
    turnCount,
    turnBudget,
    lastActivityAt,
    inactivityThresholdMinutes,
    taskCompleted,
    includeSessionSummary,
    projectId: projectId ?? defaults.projectId,
    userId: userId ?? defaults.userId,
    tenantId: tenantId ?? defaults.tenantId,
  }
}
