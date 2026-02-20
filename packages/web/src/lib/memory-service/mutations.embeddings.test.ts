import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

type DbClient = ReturnType<typeof createClient>

const {
  mockEnqueueEmbeddingJob,
  mockTriggerEmbeddingQueueProcessing,
} = vi.hoisted(() => ({
  mockEnqueueEmbeddingJob: vi.fn(),
  mockTriggerEmbeddingQueueProcessing: vi.fn(),
}))

vi.mock("@/lib/sdk-embeddings/jobs", () => ({
  enqueueEmbeddingJob: mockEnqueueEmbeddingJob,
  triggerEmbeddingQueueProcessing: mockTriggerEmbeddingQueueProcessing,
}))

const originalGraphMappingEnabled = process.env.GRAPH_MAPPING_ENABLED
const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "mutations-embeddings.db")}` })
  testDatabases.push(db)

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      memory_layer TEXT,
      expires_at TEXT,
      scope TEXT NOT NULL,
      project_id TEXT,
      user_id TEXT,
      tags TEXT,
      paths TEXT,
      category TEXT,
      metadata TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  )

  return db
}

function restoreGraphMappingFlag(): void {
  if (originalGraphMappingEnabled === undefined) {
    delete process.env.GRAPH_MAPPING_ENABLED
  } else {
    process.env.GRAPH_MAPPING_ENABLED = originalGraphMappingEnabled
  }
}

async function loadMutationsModule() {
  vi.resetModules()
  process.env.GRAPH_MAPPING_ENABLED = "false"
  return import("./mutations")
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
  restoreGraphMappingFlag()
  vi.clearAllMocks()
  vi.resetModules()
})

describe("memory mutations embedding queue integration", () => {
  it("keeps add_memory successful when embedding enqueue fails", async () => {
    const db = await setupDb("memories-mutations-embedding-add")
    mockEnqueueEmbeddingJob.mockRejectedValue(new Error("queue unavailable"))
    const { addMemoryPayload } = await loadMutationsModule()

    const payload = await addMemoryPayload({
      turso: db,
      args: {
        content: "Persist this memory even if queueing fails.",
        type: "note",
        embeddingModel: "openai/text-embedding-3-small",
      },
      projectId: "github.com/webrenew/memories",
      userId: "user-1",
      nowIso: "2026-02-20T02:00:00.000Z",
    })

    expect(payload.data.id).toBeTruthy()

    const stored = await db.execute({
      sql: "SELECT id FROM memories WHERE id = ?",
      args: [payload.data.id],
    })
    expect(stored.rows).toHaveLength(1)
    expect(mockEnqueueEmbeddingJob).toHaveBeenCalledTimes(1)
    expect(mockTriggerEmbeddingQueueProcessing).not.toHaveBeenCalled()
  })

  it("queues embeddings on edit only when content changes", async () => {
    const db = await setupDb("memories-mutations-embedding-edit")
    mockEnqueueEmbeddingJob.mockResolvedValue({ jobId: "job_1" })

    await db.execute({
      sql: `INSERT INTO memories (
              id, content, type, memory_layer, expires_at, scope, project_id, user_id,
              tags, paths, category, metadata, deleted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "mem_edit",
        "Original content",
        "note",
        "long_term",
        null,
        "project",
        "github.com/webrenew/memories",
        "user-2",
        null,
        null,
        null,
        null,
        null,
        "2026-02-20T03:00:00.000Z",
        "2026-02-20T03:00:00.000Z",
      ],
    })

    const { editMemoryPayload } = await loadMutationsModule()

    await editMemoryPayload({
      turso: db,
      args: {
        id: "mem_edit",
        tags: ["billing"],
        embeddingModel: "openai/text-embedding-3-small",
      },
      userId: "user-2",
      nowIso: "2026-02-20T03:01:00.000Z",
    })

    expect(mockEnqueueEmbeddingJob).not.toHaveBeenCalled()
    expect(mockTriggerEmbeddingQueueProcessing).not.toHaveBeenCalled()

    await editMemoryPayload({
      turso: db,
      args: {
        id: "mem_edit",
        content: "Updated content for embedding regeneration",
        embeddingModel: "openai/text-embedding-3-small",
      },
      userId: "user-2",
      nowIso: "2026-02-20T03:02:00.000Z",
    })

    expect(mockEnqueueEmbeddingJob).toHaveBeenCalledTimes(1)
    expect(mockEnqueueEmbeddingJob).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: "mem_edit",
        content: "Updated content for embedding regeneration",
        modelId: "openai/text-embedding-3-small",
        operation: "edit",
      })
    )
    expect(mockTriggerEmbeddingQueueProcessing).toHaveBeenCalledTimes(1)
  })
})

