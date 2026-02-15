import { NextResponse } from "next/server"
import { createMemoriesClient, toApiError } from "@/lib/memories"
import { AuthContextError, requireAuthContext } from "@/lib/auth-context"
import type { ContextMode } from "@memories.sh/core"

const allowedModes: ContextMode[] = ["all", "working", "long_term", "rules_only"]
const allowedStrategies = ["baseline", "hybrid_graph"] as const

function isContextMode(value: string): value is ContextMode {
  return allowedModes.includes(value as ContextMode)
}

function isStrategy(value: string): value is (typeof allowedStrategies)[number] {
  return allowedStrategies.includes(value as (typeof allowedStrategies)[number])
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthContext(request)
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
      modeRaw && isContextMode(modeRaw)
        ? modeRaw
        : "all"

    const strategyRaw = url.searchParams.get("strategy")
    const strategy =
      strategyRaw && isStrategy(strategyRaw)
        ? strategyRaw
        : "baseline"

    const { client, scope } = createMemoriesClient({
      tenantId: auth.tenantId,
      userId: auth.userId,
      projectId: url.searchParams.get("projectId") ?? undefined,
    })

    const context = await client.context.get({
      query: q,
      mode,
      limit,
      projectId: scope.projectId,
      strategy,
      graphDepth,
      graphLimit,
    })

    return NextResponse.json({
      ok: true,
      rules: context.rules,
      memories: context.memories,
      trace: context.trace ?? {
        requestedStrategy: strategy,
        strategy,
        graphDepth,
        graphLimit,
      },
    })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            type: "auth_error",
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status }
      )
    }
    const apiError = toApiError(error)
    return NextResponse.json(apiError.body, { status: apiError.status })
  }
}
