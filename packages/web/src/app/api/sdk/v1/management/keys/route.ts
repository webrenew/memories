import {
  DELETE as legacyDelete,
  GET as legacyGet,
  POST as legacyPost,
} from "@/app/api/mcp/key/route"
import { legacyErrorResponse, successResponse } from "@/lib/sdk-api/runtime"

const ENDPOINT = "/api/sdk/v1/management/keys"

async function wrapLegacyResponse(requestId: string, response: Response) {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (response.ok) {
    return successResponse(ENDPOINT, requestId, body, response.status)
  }

  const details = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined
  const message =
    (details?.error as string | undefined) ||
    (details?.message as string | undefined) ||
    `Legacy endpoint failed with status ${response.status}`

  return legacyErrorResponse(ENDPOINT, requestId, response.status, message, "LEGACY_MCP_KEY_ERROR", details)
}

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID()
  const response = await legacyGet()
  return wrapLegacyResponse(requestId, response)
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const response = await legacyPost(request)
  return wrapLegacyResponse(requestId, response)
}

export async function DELETE(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const response = await legacyDelete(request)
  return wrapLegacyResponse(requestId, response)
}
