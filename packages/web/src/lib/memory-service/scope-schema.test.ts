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
  })
})
