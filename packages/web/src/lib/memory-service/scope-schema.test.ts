import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureMemoryUserIdSchema } from "./scope-schema"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "scope-schema.db")}` })
  testDatabases.push(db)
  return db
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("ensureMemoryUserIdSchema", () => {
  it("applies schema once and records migration marker", async () => {
    const db = await setupDb("memories-scope-schema")

    await db.execute(
      `CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        project_id TEXT,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      )`
    )

    await ensureMemoryUserIdSchema(db, { cacheKey: "workspace:test" })
    await ensureMemoryUserIdSchema(db, { cacheKey: "workspace:test" })

    const columns = await db.execute("PRAGMA table_info(memories)")
    const columnNames = new Set(columns.rows.map((row) => String(row.name)))
    expect(columnNames.has("user_id")).toBe(true)
    expect(columnNames.has("memory_layer")).toBe(true)
    expect(columnNames.has("expires_at")).toBe(true)

    const marker = await db.execute({
      sql: "SELECT value FROM memory_schema_state WHERE key = ?",
      args: ["memory_user_id_v1"],
    })
    expect(String(marker.rows[0]?.value ?? "")).toBe("1")

    const embeddingsMarker = await db.execute({
      sql: "SELECT value FROM memory_schema_state WHERE key = ?",
      args: ["memory_embeddings_v1"],
    })
    expect(String(embeddingsMarker.rows[0]?.value ?? "")).toBe("1")

    const embeddingColumns = await db.execute("PRAGMA table_info(memory_embeddings)")
    const embeddingColumnNames = new Set(embeddingColumns.rows.map((row) => String(row.name)))
    expect(embeddingColumnNames.has("memory_id")).toBe(true)
    expect(embeddingColumnNames.has("embedding")).toBe(true)
    expect(embeddingColumnNames.has("model")).toBe(true)
    expect(embeddingColumnNames.has("model_version")).toBe(true)
    expect(embeddingColumnNames.has("dimension")).toBe(true)

    const embeddingIndexes = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      args: ["memory_embeddings"],
    })
    const embeddingIndexNames = new Set(embeddingIndexes.rows.map((row) => String(row.name)))
    expect(embeddingIndexNames.has("idx_memory_embeddings_model_dimension")).toBe(true)
    expect(embeddingIndexNames.has("idx_memory_embeddings_model_version")).toBe(true)
    expect(embeddingIndexNames.has("idx_memory_embeddings_created_at")).toBe(true)
    expect(embeddingIndexNames.has("idx_memory_embeddings_updated_at")).toBe(true)
  })

  it("upgrades embedding schema for tenants already marked on the user-id migration", async () => {
    const db = await setupDb("memories-scope-schema-existing")

    await db.execute(
      `CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        project_id TEXT,
        tags TEXT,
        user_id TEXT,
        memory_layer TEXT NOT NULL DEFAULT 'long_term',
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      )`
    )

    await db.execute(
      `CREATE TABLE memory_schema_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    await db.execute({
      sql: "INSERT INTO memory_schema_state (key, value, updated_at) VALUES (?, '1', datetime('now'))",
      args: ["memory_user_id_v1"],
    })

    await ensureMemoryUserIdSchema(db, { cacheKey: "workspace:existing" })

    const embeddingsMarker = await db.execute({
      sql: "SELECT value FROM memory_schema_state WHERE key = ?",
      args: ["memory_embeddings_v1"],
    })
    expect(String(embeddingsMarker.rows[0]?.value ?? "")).toBe("1")

    const embeddingsTable = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      args: ["memory_embeddings"],
    })
    expect(embeddingsTable.rows).toHaveLength(1)
  })
})
