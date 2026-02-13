import { NextResponse } from "next/server"
import { createMemoriesClient, toApiError } from "@/lib/memories"
import { AuthContextError, requireAuthContext } from "@/lib/auth-context"
import type { MemoryType } from "@memories.sh/core"

const allowedTypes: MemoryType[] = ["rule", "decision", "fact", "note", "skill"]

function isMemoryType(value: string): value is MemoryType {
  return allowedTypes.includes(value as MemoryType)
}

type AddPayload = {
  content?: unknown
  type?: unknown
  tags?: unknown
  projectId?: unknown
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthContext(request)
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
      typeof body.type === "string" && isMemoryType(body.type)
        ? body.type
        : "note"

    const tags = Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : []

    const { client, scope } = createMemoriesClient({
      tenantId: auth.tenantId,
      userId: auth.userId,
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
