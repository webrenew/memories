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

    const embeddingJobsMarker = await db.execute({
      sql: "SELECT value FROM memory_schema_state WHERE key = ?",
      args: ["memory_embedding_jobs_v1"],
    })
    expect(String(embeddingJobsMarker.rows[0]?.value ?? "")).toBe("1")

    const embeddingBackfillMarker = await db.execute({
      sql: "SELECT value FROM memory_schema_state WHERE key = ?",
      args: ["memory_embedding_backfill_v1"],
    })
    expect(String(embeddingBackfillMarker.rows[0]?.value ?? "")).toBe("1")

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

    const embeddingJobColumns = await db.execute("PRAGMA table_info(memory_embedding_jobs)")
    const embeddingJobColumnNames = new Set(embeddingJobColumns.rows.map((row) => String(row.name)))
    expect(embeddingJobColumnNames.has("id")).toBe(true)
    expect(embeddingJobColumnNames.has("memory_id")).toBe(true)
    expect(embeddingJobColumnNames.has("operation")).toBe(true)
    expect(embeddingJobColumnNames.has("model")).toBe(true)
    expect(embeddingJobColumnNames.has("content")).toBe(true)
    expect(embeddingJobColumnNames.has("status")).toBe(true)
    expect(embeddingJobColumnNames.has("attempt_count")).toBe(true)
    expect(embeddingJobColumnNames.has("max_attempts")).toBe(true)
    expect(embeddingJobColumnNames.has("next_attempt_at")).toBe(true)

    const embeddingJobIndexes = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      args: ["memory_embedding_jobs"],
    })
    const embeddingJobIndexNames = new Set(embeddingJobIndexes.rows.map((row) => String(row.name)))
    expect(embeddingJobIndexNames.has("idx_memory_embedding_jobs_status_next_attempt")).toBe(true)
    expect(embeddingJobIndexNames.has("idx_memory_embedding_jobs_memory_status")).toBe(true)
    expect(embeddingJobIndexNames.has("idx_memory_embedding_jobs_claimed_at")).toBe(true)
    expect(embeddingJobIndexNames.has("idx_memory_embedding_jobs_dead_letter_at")).toBe(true)

    const embeddingMetricColumns = await db.execute("PRAGMA table_info(memory_embedding_job_metrics)")
    const embeddingMetricColumnNames = new Set(embeddingMetricColumns.rows.map((row) => String(row.name)))
    expect(embeddingMetricColumnNames.has("id")).toBe(true)
    expect(embeddingMetricColumnNames.has("job_id")).toBe(true)
    expect(embeddingMetricColumnNames.has("memory_id")).toBe(true)
    expect(embeddingMetricColumnNames.has("operation")).toBe(true)
    expect(embeddingMetricColumnNames.has("model")).toBe(true)
    expect(embeddingMetricColumnNames.has("attempt")).toBe(true)
    expect(embeddingMetricColumnNames.has("outcome")).toBe(true)
    expect(embeddingMetricColumnNames.has("duration_ms")).toBe(true)

    const embeddingMetricIndexes = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      args: ["memory_embedding_job_metrics"],
    })
    const embeddingMetricIndexNames = new Set(embeddingMetricIndexes.rows.map((row) => String(row.name)))
    expect(embeddingMetricIndexNames.has("idx_memory_embedding_job_metrics_job_created_at")).toBe(true)
    expect(embeddingMetricIndexNames.has("idx_memory_embedding_job_metrics_outcome_created_at")).toBe(true)
    expect(embeddingMetricIndexNames.has("idx_memory_embedding_job_metrics_created_at")).toBe(true)

    const embeddingBackfillStateColumns = await db.execute("PRAGMA table_info(memory_embedding_backfill_state)")
    const embeddingBackfillStateColumnNames = new Set(embeddingBackfillStateColumns.rows.map((row) => String(row.name)))
    expect(embeddingBackfillStateColumnNames.has("scope_key")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("model")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("status")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("checkpoint_created_at")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("checkpoint_memory_id")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("scanned_count")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("enqueued_count")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("estimated_total")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("estimated_remaining")).toBe(true)
    expect(embeddingBackfillStateColumnNames.has("estimated_completion_seconds")).toBe(true)

    const embeddingBackfillStateIndexes = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      args: ["memory_embedding_backfill_state"],
    })
    const embeddingBackfillStateIndexNames = new Set(embeddingBackfillStateIndexes.rows.map((row) => String(row.name)))
    expect(embeddingBackfillStateIndexNames.has("idx_memory_embedding_backfill_state_status_updated")).toBe(true)

    const embeddingBackfillMetricColumns = await db.execute("PRAGMA table_info(memory_embedding_backfill_metrics)")
    const embeddingBackfillMetricColumnNames = new Set(embeddingBackfillMetricColumns.rows.map((row) => String(row.name)))
    expect(embeddingBackfillMetricColumnNames.has("id")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("scope_key")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("model")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("batch_scanned")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("batch_enqueued")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("total_scanned")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("total_enqueued")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("estimated_total")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("estimated_remaining")).toBe(true)
    expect(embeddingBackfillMetricColumnNames.has("status")).toBe(true)

    const embeddingBackfillMetricIndexes = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      args: ["memory_embedding_backfill_metrics"],
    })
    const embeddingBackfillMetricIndexNames = new Set(embeddingBackfillMetricIndexes.rows.map((row) => String(row.name)))
    expect(embeddingBackfillMetricIndexNames.has("idx_memory_embedding_backfill_metrics_scope_ran_at")).toBe(true)
    expect(embeddingBackfillMetricIndexNames.has("idx_memory_embedding_backfill_metrics_status_ran_at")).toBe(true)
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

    const embeddingJobsMarker = await db.execute({
      sql: "SELECT value FROM memory_schema_state WHERE key = ?",
      args: ["memory_embedding_jobs_v1"],
    })
    expect(String(embeddingJobsMarker.rows[0]?.value ?? "")).toBe("1")

    const embeddingBackfillMarker = await db.execute({
      sql: "SELECT value FROM memory_schema_state WHERE key = ?",
      args: ["memory_embedding_backfill_v1"],
    })
    expect(String(embeddingBackfillMarker.rows[0]?.value ?? "")).toBe("1")

    const embeddingsTable = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      args: ["memory_embeddings"],
    })
    expect(embeddingsTable.rows).toHaveLength(1)

    const embeddingJobsTable = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      args: ["memory_embedding_jobs"],
    })
    expect(embeddingJobsTable.rows).toHaveLength(1)

    const embeddingBackfillStateTable = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      args: ["memory_embedding_backfill_state"],
    })
    expect(embeddingBackfillStateTable.rows).toHaveLength(1)

    const embeddingBackfillMetricTable = await db.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      args: ["memory_embedding_backfill_metrics"],
    })
    expect(embeddingBackfillMetricTable.rows).toHaveLength(1)
  })
})
