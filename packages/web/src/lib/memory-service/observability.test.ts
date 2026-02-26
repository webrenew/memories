import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { getMemoryLifecycleObservabilitySnapshot } from "./observability"
import { ensureMemoryUserIdSchema } from "./scope-schema"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "observability.db")}` })
  testDatabases.push(db)

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

  await ensureMemoryUserIdSchema(db, { cacheKey: `observability:${prefix}` })
  return db
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("memory observability snapshot", () => {
  it("summarizes lifecycle, compaction, consolidation, and contradiction signals", async () => {
    const db = await setupDb("memories-observability-summary")

    await db.execute(
      `CREATE TABLE memory_links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    )

    await db.execute({
      sql: `INSERT INTO memories
            (id, content, type, scope, project_id, user_id, created_at, updated_at, deleted_at)
            VALUES (?, ?, 'rule', 'project', ?, ?, ?, ?, NULL)`,
      args: [
        "mem_1",
        "Use canary deploys",
        "github.com/acme/platform",
        "user-1",
        "2026-02-26T00:00:00.000Z",
        "2026-02-26T01:00:00.000Z",
      ],
    })
    await db.execute({
      sql: `INSERT INTO memories
            (id, content, type, scope, project_id, user_id, created_at, updated_at, deleted_at)
            VALUES (?, ?, 'rule', 'project', ?, ?, ?, ?, ?)`,
      args: [
        "mem_2",
        "Use full rollout immediately",
        "github.com/acme/platform",
        "user-1",
        "2026-02-25T12:00:00.000Z",
        "2026-02-26T02:00:00.000Z",
        "2026-02-26T03:00:00.000Z",
      ],
    })

    await db.execute({
      sql: `INSERT INTO memory_sessions
            (id, scope, project_id, user_id, client, status, title, started_at, last_activity_at, ended_at, metadata)
            VALUES (?, 'project', ?, ?, 'codex', 'compacted', 'session', ?, ?, ?, NULL)`,
      args: [
        "sess_1",
        "github.com/acme/platform",
        "user-1",
        "2026-02-26T00:00:00.000Z",
        "2026-02-26T02:00:00.000Z",
        "2026-02-26T02:00:00.000Z",
      ],
    })
    await db.execute({
      sql: `INSERT INTO memory_compaction_events
            (id, session_id, trigger_type, reason, token_count_before, turn_count_before, summary_tokens, checkpoint_memory_id, created_at)
            VALUES (?, ?, 'count', 'budget exceeded', 2400, 22, 220, NULL, ?)`,
      args: ["cmp_1", "sess_1", "2026-02-26T02:00:00.000Z"],
    })

    await db.execute({
      sql: `INSERT INTO memory_consolidation_runs
            (id, scope, project_id, user_id, input_count, merged_count, superseded_count, conflicted_count, model, created_at, metadata)
            VALUES (?, 'project', ?, ?, 8, 2, 3, 1, 'gpt-5-mini', ?, '{}')`,
      args: ["run_1", "github.com/acme/platform", "user-1", "2026-02-26T03:00:00.000Z"],
    })

    await db.execute({
      sql: `INSERT INTO memory_links (id, source_id, target_id, link_type, created_at) VALUES (?, ?, ?, 'contradicts', ?)`,
      args: ["lnk_1", "mem_1", "mem_2", "2026-02-26T03:00:00.000Z"],
    })

    const snapshot = await getMemoryLifecycleObservabilitySnapshot({
      turso: db,
      projectId: "github.com/acme/platform",
      userId: "user-1",
      nowIso: "2026-02-26T04:00:00.000Z",
      windowHours: 24,
    })

    expect(snapshot.lifecycle.createdCount).toBeGreaterThanOrEqual(1)
    expect(snapshot.lifecycle.deletedCount).toBe(1)
    expect(snapshot.compaction.totalEvents).toBe(1)
    expect(snapshot.compaction.checkpointMissingCount).toBe(1)
    expect(snapshot.consolidation.runCount).toBe(1)
    expect(snapshot.consolidation.conflictedCount).toBe(1)
    expect(snapshot.contradictions.windowCount).toBe(1)
  })

  it("handles missing contradiction link table by returning zeroed contradiction metrics", async () => {
    const db = await setupDb("memories-observability-no-links")

    const snapshot = await getMemoryLifecycleObservabilitySnapshot({
      turso: db,
      nowIso: "2026-02-26T04:00:00.000Z",
      windowHours: 24,
    })

    expect(snapshot.contradictions.totalCount).toBe(0)
    expect(snapshot.contradictions.windowCount).toBe(0)
    expect(snapshot.contradictions.daily).toEqual([])
  })
})
