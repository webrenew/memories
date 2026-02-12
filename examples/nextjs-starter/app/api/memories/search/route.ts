import { NextResponse } from "next/server"
import { createMemoriesClient, toApiError } from "@/lib/memories"
import type { MemoryLayer, MemoryType } from "@memories.sh/core"

const allowedTypes = new Set<MemoryType>(["rule", "decision", "fact", "note", "skill"])
const allowedLayers = new Set<MemoryLayer>(["rule", "working", "long_term"])

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
        : undefined

    const typeRaw = url.searchParams.get("type")
    const type: MemoryType | undefined =
      typeRaw && allowedTypes.has(typeRaw as MemoryType)
        ? (typeRaw as MemoryType)
        : undefined

    const layerRaw = url.searchParams.get("layer")
    const layer: MemoryLayer | undefined =
      layerRaw && allowedLayers.has(layerRaw as MemoryLayer)
        ? (layerRaw as MemoryLayer)
        : undefined

    const { client, scope } = createMemoriesClient({
      tenantId: url.searchParams.get("tenantId") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    })

    const memories = await client.memories.search(q, {
      type,
      layer,
      limit,
      projectId: scope.projectId,
    })

    return NextResponse.json({ ok: true, count: memories.length, memories })
  } catch (error) {
    const apiError = toApiError(error)
    return NextResponse.json(apiError.body, { status: apiError.status })
  }
}
