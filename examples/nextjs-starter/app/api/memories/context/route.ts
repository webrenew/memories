import { NextResponse } from "next/server"
import { createMemoriesClient, toApiError } from "@/lib/memories"
import type { ContextMode, ContextStrategy } from "@memories.sh/core"

const allowedModes = new Set<ContextMode>(["all", "working", "long_term", "rules_only"])
const allowedStrategies = new Set<ContextStrategy>(["baseline", "hybrid_graph"])

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const q = (url.searchParams.get("q") ?? url.searchParams.get("query") ?? "").trim()

    if (!q) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            type: "validation_error",
            code: "MISSING_QUERY",
            message: "q (or query) is required",
          },
        },
        { status: 400 }
      )
    }

    const limitRaw = url.searchParams.get("limit")
    const limit =
      limitRaw && Number.isFinite(Number(limitRaw))
        ? Math.max(1, Math.min(50, Math.floor(Number(limitRaw))))
        : 8

    const graphDepthRaw = url.searchParams.get("graphDepth")
    const graphDepth: 0 | 1 | 2 = graphDepthRaw === "0" || graphDepthRaw === "1" || graphDepthRaw === "2"
      ? (Number(graphDepthRaw) as 0 | 1 | 2)
      : 1

    const graphLimitRaw = url.searchParams.get("graphLimit")
    const graphLimit =
      graphLimitRaw && Number.isFinite(Number(graphLimitRaw))
        ? Math.max(1, Math.min(50, Math.floor(Number(graphLimitRaw))))
        : 8

    const modeRaw = url.searchParams.get("mode")
    const mode: ContextMode =
      modeRaw && allowedModes.has(modeRaw as ContextMode)
        ? (modeRaw as ContextMode)
        : "all"

    const strategyRaw = url.searchParams.get("strategy")
    const strategy: ContextStrategy =
      strategyRaw && allowedStrategies.has(strategyRaw as ContextStrategy)
        ? (strategyRaw as ContextStrategy)
        : "baseline"

    const { client, scope } = createMemoriesClient({
      tenantId: url.searchParams.get("tenantId") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    })

    const context = await client.context.get({
      query: q,
      mode,
      strategy,
      limit,
      graphDepth,
      graphLimit,
      projectId: scope.projectId,
    })

    return NextResponse.json({
      ok: true,
      rules: context.rules,
      memories: context.memories,
      trace: context.trace,
    })
  } catch (error) {
    const apiError = toApiError(error)
    return NextResponse.json(apiError.body, { status: apiError.status })
  }
}
