import { NextResponse } from "next/server"
import { createMemoriesClient, toApiError } from "@/lib/memories"
import type { MemoryType } from "@memories.sh/core"

const allowedTypes = new Set<MemoryType>(["rule", "decision", "fact", "note", "skill"])

type AddPayload = {
  content?: unknown
  type?: unknown
  tags?: unknown
  projectId?: unknown
  tenantId?: unknown
  userId?: unknown
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AddPayload

    const content = typeof body.content === "string" ? body.content.trim() : ""
    if (!content) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            type: "validation_error",
            code: "MISSING_CONTENT",
            message: "content is required",
          },
        },
        { status: 400 }
      )
    }

    const type: MemoryType =
      typeof body.type === "string" && allowedTypes.has(body.type)
        ? body.type
        : "note"

    const tags = Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : []

    const { client, scope } = createMemoriesClient({
      tenantId: typeof body.tenantId === "string" ? body.tenantId : undefined,
      userId: typeof body.userId === "string" ? body.userId : undefined,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    })

    const result = await client.memories.add({
      content,
      type,
      tags,
      projectId: scope.projectId,
    })

    return NextResponse.json({ ok: true, result }, { status: 201 })
  } catch (error) {
    const apiError = toApiError(error)
    return NextResponse.json(apiError.body, { status: apiError.status })
  }
}
