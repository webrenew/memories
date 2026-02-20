import { describe, expect, it, vi } from "vitest"

const {
  mockKeyGet,
  mockKeyPost,
  mockKeyDelete,
} = vi.hoisted(() => ({
  mockKeyGet: vi.fn(),
  mockKeyPost: vi.fn(),
  mockKeyDelete: vi.fn(),
}))

vi.mock("@/app/api/mcp/key/route", () => ({
  GET: mockKeyGet,
  POST: mockKeyPost,
  DELETE: mockKeyDelete,
}))

import { DELETE as keysDelete, GET as keysGet, POST as keysPost } from "../keys/route"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("/api/sdk/v1/management/keys", () => {
  it("wraps successful key GET response in sdk envelope", async () => {
    mockKeyGet.mockResolvedValue(
      jsonResponse({
        hasKey: true,
        keyPreview: "mcp_abcd****1234",
      })
    )

    const response = await keysGet()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.hasKey).toBe(true)
    expect(body.meta.endpoint).toBe("/api/sdk/v1/management/keys")
  })

  it("wraps failed key POST response in typed sdk error envelope", async () => {
    mockKeyPost.mockResolvedValue(jsonResponse({ error: "expiresAt is required" }, 400))

    const response = await keysPost(new Request("https://example.com", { method: "POST", body: "{}" }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.type).toBe("validation_error")
    expect(body.error.code).toBe("LEGACY_MCP_KEY_ERROR")
  })

  it("forwards delete status", async () => {
    mockKeyDelete.mockResolvedValue(jsonResponse({ ok: true }, 200))

    const response = await keysDelete()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })
})
