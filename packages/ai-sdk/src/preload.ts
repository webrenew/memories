import { resolveClient } from "./client"
import { resolveContextInput } from "./context-input"
import type { MemoriesBaseOptions } from "./types"
import type { ContextGetInput, ContextResult } from "@memories.sh/core"

export interface PreloadContextOptions extends MemoriesBaseOptions, ContextGetInput {}

export async function preloadContext(options: PreloadContextOptions = {}): Promise<ContextResult> {
  const client = resolveClient(options)
  const contextInput: ContextGetInput = {
    query: options.query,
    limit: options.limit,
    includeRules: options.includeRules,
    includeSkillFiles: options.includeSkillFiles,
    mode: options.mode,
    strategy: options.strategy,
    graphDepth: options.graphDepth,
    graphLimit: options.graphLimit,
    sessionId: options.sessionId,
    budgetTokens: options.budgetTokens,
    turnCount: options.turnCount,
    turnBudget: options.turnBudget,
    lastActivityAt: options.lastActivityAt,
    inactivityThresholdMinutes: options.inactivityThresholdMinutes,
    taskCompleted: options.taskCompleted,
    includeSessionSummary: options.includeSessionSummary,
  }

  return client.context.get(
    resolveContextInput(contextInput, {
      projectId: options.projectId,
      userId: options.userId,
      tenantId: options.tenantId,
    })
  )
}
