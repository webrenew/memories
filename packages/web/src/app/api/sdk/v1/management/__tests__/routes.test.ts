import { describe, expect, it, vi } from "vitest"

const {
  mockKeyGet,
  mockKeyPost,
  mockKeyDelete,
  mockTenantOverridesGet,
  mockTenantOverridesPost,
  mockTenantOverridesDelete,
} = vi.hoisted(() => ({
  mockKeyGet: vi.fn(),
  mockKeyPost: vi.fn(),
  mockKeyDelete: vi.fn(),
  mockTenantOverridesGet: vi.fn(),
  mockTenantOverridesPost: vi.fn(),
  mockTenantOverridesDelete: vi.fn(),
}))

vi.mock("@/app/api/mcp/key/route", () => ({
  GET: mockKeyGet,
  POST: mockKeyPost,
  DELETE: mockKeyDelete,
}))

vi.mock("@/app/api/sdk/v1/management/tenant-overrides/route", () => ({
  GET: mockTenantOverridesGet,
  POST: mockTenantOverridesPost,
  DELETE: mockTenantOverridesDelete,
}))

import { DELETE as keysDelete, GET as keysGet, POST as keysPost } from "../keys/route"
import {
  DELETE as tenantsDelete,
  GET as tenantsGet,
  POST as tenantsPost,
} from "../tenant-overrides/route"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function sdkSuccessResponse(data: unknown, status = 200): Response {
  return jsonResponse(
    {
      ok: true,
      data,
      error: null,
      meta: {
        endpoint: "/api/sdk/v1/management/tenant-overrides",
        requestId: "legacy-test-id",
        timestamp: "2026-02-17T00:00:00.000Z",
        version: "2026-02-11",
      },
    },
    status
  )
}

function sdkErrorResponse(status: number, message: string, code = "TENANT_OVERRIDE_ERROR"): Response {
  return jsonResponse(
    {
      ok: false,
      data: null,
      error: {
        type: "validation_error",
        code,
        message,
        status,
        retryable: false,
      },
      meta: {
        endpoint: "/api/sdk/v1/management/tenant-overrides",
        requestId: "legacy-test-id",
        timestamp: "2026-02-17T00:00:00.000Z",
        version: "2026-02-11",
      },
    },
    status
  )
}

function normalizeEnvelope(body: Record<string, unknown>) {
  return {
    ...body,
    meta: {
      ...(typeof body.meta === "object" && body.meta ? body.meta : {}),
      requestId: "<request-id>",
      timestamp: "<timestamp>",
    },
  }
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

describe("/api/sdk/v1/management/tenant-overrides", () => {
  it("wraps successful tenants GET response in sdk envelope", async () => {
    mockTenantOverridesGet.mockResolvedValue(
      sdkSuccessResponse({
        tenantDatabases: [{ tenantId: "tenant-a", status: "ready" }],
        count: 1,
      })
    )

    const response = await tenantsGet(new Request("https://example.com", { method: "GET" }) as never)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(1)
    expect(body.meta.endpoint).toBe("/api/sdk/v1/management/tenant-overrides")
  })

  it("wraps failed tenant POST response in typed sdk error envelope", async () => {
    mockTenantOverridesPost.mockResolvedValue(sdkErrorResponse(400, "tenantId is required", "INVALID_REQUEST"))

    const response = await tenantsPost(new Request("https://example.com", { method: "POST", body: "{}" }) as never)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.type).toBe("validation_error")
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("forwards delete response", async () => {
    mockTenantOverridesDelete.mockResolvedValue(sdkSuccessResponse({ ok: true }, 200))

    const response = await tenantsDelete(new Request("https://example.com?tenantId=t1", { method: "DELETE" }) as never)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })

  it("matches management keys success envelope contract snapshot", async () => {
    mockKeyGet.mockResolvedValue(
      jsonResponse({
        hasKey: true,
        keyPreview: "mcp_abcd****1234",
      })
    )

    const response = await keysGet()
    const body = (await response.json()) as Record<string, unknown>

    expect(normalizeEnvelope(body)).toMatchInlineSnapshot(`
      {
        "data": {
          "hasKey": true,
          "keyPreview": "mcp_abcd****1234",
        },
        "error": null,
        "meta": {
          "endpoint": "/api/sdk/v1/management/keys",
          "requestId": "<request-id>",
          "timestamp": "<timestamp>",
          "version": "2026-02-11",
        },
        "ok": true,
      }
    `)
  })

  it("matches management tenants validation error envelope contract snapshot", async () => {
    mockTenantOverridesPost.mockResolvedValue(sdkErrorResponse(400, "tenantId is required", "INVALID_REQUEST"))

    const response = await tenantsPost(new Request("https://example.com", { method: "POST", body: "{}" }) as never)
    const body = (await response.json()) as Record<string, unknown>

    expect(normalizeEnvelope(body)).toMatchInlineSnapshot(`
      {
        "data": null,
        "error": {
          "code": "INVALID_REQUEST",
          "message": "tenantId is required",
          "retryable": false,
          "status": 400,
          "type": "validation_error",
        },
        "meta": {
          "endpoint": "/api/sdk/v1/management/tenant-overrides",
          "requestId": "<request-id>",
          "timestamp": "<timestamp>",
          "version": "2026-02-11",
        },
        "ok": false,
      }
    `)
  })
})
