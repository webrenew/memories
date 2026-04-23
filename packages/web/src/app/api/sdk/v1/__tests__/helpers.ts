import { NextRequest } from "next/server"

export const VALID_SDK_API_KEY = `mem_${"a".repeat(64)}`

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function normalizeSdkEnvelope(body: Record<string, unknown>) {
  return {
    ...body,
    meta: {
      ...(typeof body.meta === "object" && body.meta ? body.meta : {}),
      requestId: "<request-id>",
      timestamp: "<timestamp>",
    },
  }
}

export function makeSdkPostRequest(path: string, body: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  }

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  return new NextRequest(`https://example.com${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

export function makeSdkGetRequest(path: string, apiKey?: string): NextRequest {
  const headers: Record<string, string> = {}

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  return new NextRequest(`https://example.com${path}`, {
    method: "GET",
    headers,
  })
}
