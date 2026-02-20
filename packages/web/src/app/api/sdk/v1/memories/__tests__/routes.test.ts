import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const {
  mockUserSelect,
  mockTenantSelect,
  mockResolveActiveMemoryContext,
  mockAddMemoryPayload,
  mockSearchMemoriesPayload,
  mockListMemoriesPayload,
  mockEditMemoryPayload,
  mockForgetMemoryPayload,
  mockBulkForgetMemoriesPayload,
  mockVacuumMemoriesPayload,
  mockRecordSdkEmbeddingMeterEvent,
  mockCountEmbeddingInputTokens,
  mockDeriveEmbeddingProviderFromModelId,
  mockResolveSdkEmbeddingModelSelection,
  mockExecute,
} = vi.hoisted(() => ({
  mockUserSelect: vi.fn(),
  mockTenantSelect: vi.fn(),
  mockResolveActiveMemoryContext: vi.fn(),
  mockAddMemoryPayload: vi.fn(),
  mockSearchMemoriesPayload: vi.fn(),
  mockListMemoriesPayload: vi.fn(),
  mockEditMemoryPayload: vi.fn(),
  mockForgetMemoryPayload: vi.fn(),
  mockBulkForgetMemoriesPayload: vi.fn(),
  mockVacuumMemoriesPayload: vi.fn(),
  mockRecordSdkEmbeddingMeterEvent: vi.fn(),
  mockCountEmbeddingInputTokens: vi.fn(),
  mockDeriveEmbeddingProviderFromModelId: vi.fn(),
  mockResolveSdkEmbeddingModelSelection: vi.fn(),
  mockExecute: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const filters: Record<string, unknown> = {}
        const runSingle = () => {
          if (table === "users") {
            return mockUserSelect({ table, filters })
          }
          if (table === "sdk_tenant_databases") {
            return mockTenantSelect({ table, filters })
          }
          return { data: null, error: { message: `Unexpected table: ${table}` } }
        }
        const query = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value
            return query
          }),
          single: vi.fn(runSingle),
          maybeSingle: vi.fn(runSingle),
        }
        return query
      }),
    })),
  })),
}))

vi.mock("@/lib/active-memory-context", () => ({
  resolveActiveMemoryContext: mockResolveActiveMemoryContext,
}))

vi.mock("@/lib/rate-limit", () => ({
  mcpRateLimit: { limit: vi.fn().mockResolvedValue({ success: true }) },
  checkRateLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/memory-service/mutations", () => ({
  addMemoryPayload: mockAddMemoryPayload,
  editMemoryPayload: mockEditMemoryPayload,
  forgetMemoryPayload: mockForgetMemoryPayload,
  bulkForgetMemoriesPayload: mockBulkForgetMemoriesPayload,
  vacuumMemoriesPayload: mockVacuumMemoriesPayload,
}))

vi.mock("@/lib/memory-service/queries", () => ({
  searchMemoriesPayload: mockSearchMemoriesPayload,
  listMemoriesPayload: mockListMemoriesPayload,
}))

vi.mock("@/lib/sdk-embeddings/models", () => ({
  resolveSdkEmbeddingModelSelection: mockResolveSdkEmbeddingModelSelection,
}))

vi.mock("@/lib/sdk-embedding-billing", () => ({
  recordSdkEmbeddingMeterEvent: mockRecordSdkEmbeddingMeterEvent,
  countEmbeddingInputTokens: mockCountEmbeddingInputTokens,
  deriveEmbeddingProviderFromModelId: mockDeriveEmbeddingProviderFromModelId,
}))

vi.mock("@libsql/client", () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
  })),
}))

import { POST as addPOST } from "../add/route"
import { POST as searchPOST } from "../search/route"
import { POST as listPOST } from "../list/route"
import { POST as editPOST } from "../edit/route"
import { POST as forgetPOST } from "../forget/route"
import { POST as bulkForgetPOST } from "../bulk-forget/route"
import { POST as vacuumPOST } from "../vacuum/route"
import { GET as healthGET } from "../../health/route"
import { ToolExecutionError, apiError } from "@/lib/memory-service/tools"

const VALID_API_KEY = `mem_${"a".repeat(64)}`

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

function makePost(path: string, body: unknown, apiKey?: string): NextRequest {
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

describe("/api/sdk/v1/memories/*", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUserSelect.mockReturnValue({
      data: {
        id: "user-1",
        mcp_api_key_expires_at: "2099-01-01T00:00:00.000Z",
      },
      error: null,
    })

    mockTenantSelect.mockReturnValue({ data: null, error: null })

    mockResolveActiveMemoryContext.mockResolvedValue({
      ownerType: "user",
      orgId: null,
      turso_db_url: "libsql://default-db.turso.io",
      turso_db_token: "default-token",
      turso_db_name: "default-db",
    })

    mockExecute.mockResolvedValue({ rows: [] })

    mockAddMemoryPayload.mockResolvedValue({
      text: "Stored note (global): hello",
      data: {
        id: "mem_1",
        message: "Stored note (global): hello",
        memory: { id: "mem_1", content: "hello", type: "note", layer: "long_term" },
      },
    })

    mockSearchMemoriesPayload.mockResolvedValue({
      text: "Found 1 memories",
      data: {
        memories: [{ id: "mem_1", content: "hello" }],
        count: 1,
      },
    })

    mockListMemoriesPayload.mockResolvedValue({
      text: "1 memories",
      data: {
        memories: [{ id: "mem_1", content: "hello" }],
        count: 1,
      },
    })

    mockEditMemoryPayload.mockResolvedValue({
      text: "Updated memory mem_1",
      data: {
        id: "mem_1",
        updated: true,
        message: "Updated memory mem_1",
      },
    })

    mockForgetMemoryPayload.mockResolvedValue({
      text: "Deleted memory mem_1",
      data: {
        id: "mem_1",
        deleted: true,
        message: "Deleted memory mem_1",
      },
    })

    mockBulkForgetMemoriesPayload.mockResolvedValue({
      text: "Bulk deleted 3 memories",
      data: {
        count: 3,
        ids: ["mem_1", "mem_2", "mem_3"],
        message: "Bulk deleted 3 memories",
      },
    })

    mockVacuumMemoriesPayload.mockResolvedValue({
      text: "Vacuumed 5 soft-deleted memories",
      data: {
        purged: 5,
        message: "Vacuumed 5 soft-deleted memories",
      },
    })

    mockResolveSdkEmbeddingModelSelection.mockResolvedValue({
      selectedModelId: "openai/text-embedding-3-small",
      source: "system_default",
      workspaceDefaultModelId: null,
      projectOverrideModelId: null,
      allowlistModelIds: ["openai/text-embedding-3-small"],
      availableModels: [
        {
          id: "openai/text-embedding-3-small",
          name: "text-embedding-3-small",
          provider: "openai",
          description: null,
          contextWindow: 8192,
          pricing: { input: "0.00000002" },
          inputCostUsdPerToken: 0.00000002,
          tags: [],
        },
      ],
    })

    mockRecordSdkEmbeddingMeterEvent.mockResolvedValue(undefined)
    mockCountEmbeddingInputTokens.mockReturnValue({
      inputTokens: 5,
      charEstimateTokens: 5,
      tokenCountMethod: "provider_tokenizer",
      fallbackReason: null,
      inputTokensDelta: 0,
    })
    mockDeriveEmbeddingProviderFromModelId.mockReturnValue("openai")
  })

  it("add returns 201 envelope", async () => {
    const response = await addPOST(
      makePost(
        "/api/sdk/v1/memories/add",
        {
          content: "hello",
          type: "note",
          scope: {
            projectId: "github.com/acme/platform",
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.id).toBe("mem_1")
    expect(mockAddMemoryPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "github.com/acme/platform",
        userId: "end-user-1",
      })
    )
    expect(mockResolveActiveMemoryContext).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.objectContaining({
        projectId: "github.com/acme/platform",
        fallbackToUserWithoutOrgCredentials: true,
      })
    )
  })

  it("add accepts embeddingModel override and forwards resolved model", async () => {
    mockResolveSdkEmbeddingModelSelection.mockResolvedValue({
      selectedModelId: "openai/text-embedding-3-large",
      source: "request",
      workspaceDefaultModelId: "openai/text-embedding-3-small",
      projectOverrideModelId: null,
      allowlistModelIds: ["openai/text-embedding-3-small", "openai/text-embedding-3-large"],
      availableModels: [],
    })

    const response = await addPOST(
      makePost(
        "/api/sdk/v1/memories/add",
        {
          content: "hello",
          embeddingModel: "openai/text-embedding-3-large",
          scope: {
            projectId: "github.com/acme/platform",
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.embeddingModel).toBe("openai/text-embedding-3-large")
    expect(body.data.embeddingModelSource).toBe("request")

    expect(mockResolveSdkEmbeddingModelSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedModelId: "openai/text-embedding-3-large",
        tenantId: null,
        projectId: "github.com/acme/platform",
      })
    )
    expect(mockAddMemoryPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          embeddingModel: "openai/text-embedding-3-large",
        }),
      })
    )
    expect(mockRecordSdkEmbeddingMeterEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "openai/text-embedding-3-large",
      })
    )
  })

  it("add returns validation envelope when embedding model selection fails", async () => {
    mockResolveSdkEmbeddingModelSelection.mockRejectedValue(
      new ToolExecutionError(
        apiError({
          type: "validation_error",
          code: "UNSUPPORTED_EMBEDDING_MODEL",
          message: "Unsupported embedding model",
          status: 400,
          retryable: false,
        }),
        { rpcCode: -32602 }
      )
    )

    const response = await addPOST(
      makePost(
        "/api/sdk/v1/memories/add",
        {
          content: "hello",
          embeddingModel: "not-a-real-model",
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("UNSUPPORTED_EMBEDDING_MODEL")
  })

  it("search returns results envelope", async () => {
    const response = await searchPOST(
      makePost(
        "/api/sdk/v1/memories/search",
        {
          query: "hello",
          strategy: "semantic",
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(1)
    expect(mockSearchMemoriesPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "end-user-1",
        args: expect.objectContaining({
          strategy: "semantic",
        }),
      })
    )
  })

  it("list returns results envelope", async () => {
    const response = await listPOST(
      makePost(
        "/api/sdk/v1/memories/list",
        {
          limit: 10,
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(1)
  })

  it("edit requires at least one update field", async () => {
    const response = await editPOST(
      makePost(
        "/api/sdk/v1/memories/edit",
        {
          id: "mem_1",
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("edit accepts embeddingModel as an update field", async () => {
    mockResolveSdkEmbeddingModelSelection.mockResolvedValue({
      selectedModelId: "openai/text-embedding-3-large",
      source: "request",
      workspaceDefaultModelId: "openai/text-embedding-3-small",
      projectOverrideModelId: null,
      allowlistModelIds: ["openai/text-embedding-3-small", "openai/text-embedding-3-large"],
      availableModels: [],
    })

    const response = await editPOST(
      makePost(
        "/api/sdk/v1/memories/edit",
        {
          id: "mem_1",
          embeddingModel: "openai/text-embedding-3-large",
          scope: {
            projectId: "github.com/acme/platform",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.embeddingModel).toBe("openai/text-embedding-3-large")
    expect(body.data.embeddingModelSource).toBe("request")
    expect(mockEditMemoryPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          embeddingModel: "openai/text-embedding-3-large",
        }),
      })
    )
    expect(mockRecordSdkEmbeddingMeterEvent).not.toHaveBeenCalled()
  })

  it("forget returns deletion envelope", async () => {
    const response = await forgetPOST(
      makePost(
        "/api/sdk/v1/memories/forget",
        {
          id: "mem_1",
          scope: {
            userId: "end-user-1",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.deleted).toBe(true)
    expect(mockForgetMemoryPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "end-user-1",
        onlyWorkingLayer: true,
      })
    )
  })

  it("bulk-forget returns count and ids", async () => {
    const response = await bulkForgetPOST(
      makePost(
        "/api/sdk/v1/memories/bulk-forget",
        {
          filters: { types: ["note"] },
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(3)
    expect(body.data.ids).toEqual(["mem_1", "mem_2", "mem_3"])
    expect(mockBulkForgetMemoriesPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          types: ["note"],
          dry_run: false,
        }),
        userId: "end-user-1",
        onlyWorkingLayer: true,
      })
    )
  })

  it("bulk-forget dry run returns preview", async () => {
    mockBulkForgetMemoriesPayload.mockResolvedValue({
      text: "Dry run: 2 memories would be deleted",
      data: {
        count: 2,
        memories: [
          { id: "mem_1", type: "note", contentPreview: "Hello world" },
          { id: "mem_2", type: "fact", contentPreview: "API key is abc..." },
        ],
        message: "Dry run: 2 memories would be deleted",
      },
    })

    const response = await bulkForgetPOST(
      makePost(
        "/api/sdk/v1/memories/bulk-forget",
        {
          filters: { tags: ["temp"] },
          dryRun: true,
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.count).toBe(2)
    expect(body.data.memories).toHaveLength(2)
    expect(mockBulkForgetMemoriesPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ dry_run: true }),
        onlyWorkingLayer: true,
      })
    )
  })

  it("bulk-forget rejects missing filters", async () => {
    const response = await bulkForgetPOST(
      makePost(
        "/api/sdk/v1/memories/bulk-forget",
        {
          filters: {},
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("INVALID_REQUEST")
  })

  it("bulk-forget rejects all:true combined with other filters", async () => {
    const response = await bulkForgetPOST(
      makePost(
        "/api/sdk/v1/memories/bulk-forget",
        {
          filters: { all: true, types: ["note"] },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
  })

  it("bulk-forget accepts all:true alone", async () => {
    const response = await bulkForgetPOST(
      makePost(
        "/api/sdk/v1/memories/bulk-forget",
        {
          filters: { all: true },
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
  })

  it("vacuum returns purged count", async () => {
    const response = await vacuumPOST(
      makePost(
        "/api/sdk/v1/memories/vacuum",
        {
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.purged).toBe(5)
    expect(body.data.message).toContain("Vacuumed")
    expect(mockVacuumMemoriesPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "end-user-1",
        onlyWorkingLayer: true,
      })
    )
  })

  it("vacuum returns zero when nothing to purge", async () => {
    mockVacuumMemoriesPayload.mockResolvedValue({
      text: "No soft-deleted memories to vacuum",
      data: {
        purged: 0,
        message: "No soft-deleted memories to vacuum",
      },
    })

    const response = await vacuumPOST(
      makePost(
        "/api/sdk/v1/memories/vacuum",
        {
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.purged).toBe(0)
    expect(body.data.message).toContain("No soft-deleted")
  })

  it("vacuum returns 401 without API key", async () => {
    const response = await vacuumPOST(
      makePost("/api/sdk/v1/memories/vacuum", {})
    )

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("MISSING_API_KEY")
  })

  it("bulk-forget returns 401 without API key", async () => {
    const response = await bulkForgetPOST(
      makePost("/api/sdk/v1/memories/bulk-forget", {
        filters: { types: ["note"] },
      })
    )

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("MISSING_API_KEY")
  })

  it("bulk-forget passes older_than_days to payload", async () => {
    const response = await bulkForgetPOST(
      makePost(
        "/api/sdk/v1/memories/bulk-forget",
        {
          filters: { olderThanDays: 30 },
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    expect(mockBulkForgetMemoriesPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          older_than_days: 30,
        }),
        onlyWorkingLayer: true,
      })
    )
  })

  it("bulk-forget passes pattern and project_id to payload", async () => {
    const response = await bulkForgetPOST(
      makePost(
        "/api/sdk/v1/memories/bulk-forget",
        {
          filters: { pattern: "TODO*", projectId: "github.com/acme/repo" },
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    expect(mockBulkForgetMemoriesPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          pattern: "TODO*",
          project_id: "github.com/acme/repo",
        }),
        onlyWorkingLayer: true,
      })
    )
  })

  it("vacuum passes userId to payload", async () => {
    const response = await vacuumPOST(
      makePost(
        "/api/sdk/v1/memories/vacuum",
        {
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(200)
    expect(mockVacuumMemoriesPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "end-user-1",
        onlyWorkingLayer: true,
      })
    )
  })

  it("returns tenant mapping error when tenantId is unknown", async () => {
    const response = await addPOST(
      makePost(
        "/api/sdk/v1/memories/add",
        {
          content: "hello",
          scope: {
            tenantId: "missing-tenant",
          },
        },
        VALID_API_KEY
      )
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe("TENANT_DATABASE_NOT_CONFIGURED")
  })
})

describe("/api/sdk/v1/health", () => {
  it("returns health envelope", async () => {
    const response = await healthGET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.status).toBe("ok")
    expect(body.meta.endpoint).toBe("/api/sdk/v1/health")
  })

  it("matches sdk health envelope contract snapshot", async () => {
    const response = await healthGET()
    const body = (await response.json()) as Record<string, unknown>

    expect(normalizeEnvelope(body)).toMatchInlineSnapshot(`
      {
        "data": {
          "schemaVersion": "2026-02-11",
          "service": "memories-sdk",
          "status": "ok",
        },
        "error": null,
        "meta": {
          "endpoint": "/api/sdk/v1/health",
          "requestId": "<request-id>",
          "timestamp": "<timestamp>",
          "version": "2026-02-11",
        },
        "ok": true,
      }
    `)
  })
})

describe("/api/sdk/v1/memories envelope contracts", () => {
  it("matches add success envelope snapshot", async () => {
    const response = await addPOST(
      makePost(
        "/api/sdk/v1/memories/add",
        {
          content: "hello",
          type: "note",
          scope: { userId: "end-user-1" },
        },
        VALID_API_KEY
      )
    )

    const body = (await response.json()) as Record<string, unknown>
    expect(normalizeEnvelope(body)).toMatchInlineSnapshot(`
      {
        "data": {
          "embeddingModel": null,
          "embeddingModelSource": null,
          "id": "mem_1",
          "memory": {
            "content": "hello",
            "id": "mem_1",
            "layer": "long_term",
            "type": "note",
          },
          "message": "Stored note (global): hello",
        },
        "error": null,
        "meta": {
          "endpoint": "/api/sdk/v1/memories/add",
          "requestId": "<request-id>",
          "timestamp": "<timestamp>",
          "version": "2026-02-11",
        },
        "ok": true,
      }
    `)
  })

  it("matches edit validation error envelope snapshot", async () => {
    const response = await editPOST(
      makePost(
        "/api/sdk/v1/memories/edit",
        {
          id: "mem_1",
        },
        VALID_API_KEY
      )
    )

    const body = (await response.json()) as Record<string, unknown>
    expect(normalizeEnvelope(body)).toMatchInlineSnapshot(`
      {
        "data": null,
        "error": {
          "code": "INVALID_REQUEST",
          "message": "Invalid request payload",
          "retryable": false,
          "status": 400,
          "type": "validation_error",
        },
        "meta": {
          "endpoint": "/api/sdk/v1/memories/edit",
          "requestId": "<request-id>",
          "timestamp": "<timestamp>",
          "version": "2026-02-11",
        },
        "ok": false,
      }
    `)
  })
})
