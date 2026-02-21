import { extractErrorMessage } from "@/lib/client-errors"
import type { GraphStatusPayload } from "@/lib/memory-service/graph/status"

interface GraphStatusApiResponse {
  status?: GraphStatusPayload
  error?: string
}

export interface GraphStatusRefreshResult {
  status: GraphStatusPayload | null
  error: string | null
}

export function parseGraphStatusResponse(
  responseOk: boolean,
  statusCode: number,
  body: unknown
): GraphStatusRefreshResult {
  if (!responseOk) {
    return {
      status: null,
      error: extractErrorMessage(body, `Failed to refresh graph status (HTTP ${statusCode})`),
    }
  }

  const status =
    body && typeof body === "object" && "status" in body
      ? ((body as GraphStatusApiResponse).status ?? null)
      : null

  if (!status) {
    return {
      status: null,
      error: "Graph status response was invalid.",
    }
  }

  return {
    status,
    error: null,
  }
}

export async function fetchGraphStatusPayload(
  signal?: AbortSignal
): Promise<GraphStatusRefreshResult> {
  const response = await fetch("/api/graph/rollout", {
    method: "GET",
    cache: "no-store",
    signal,
  })
  const body = await response.json().catch(() => null)
  return parseGraphStatusResponse(response.ok, response.status, body)
}
