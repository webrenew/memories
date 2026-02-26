import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ensureMemoryUserIdSchema } from "./scope-schema"
import {
  listSkillFilesPayload,
  markSkillFilesUsedPayload,
  promoteSnapshotToSkillFilePayload,
  upsertSkillFilePayload,
} from "./skill-files"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "skill-files.db")}` })
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

  await ensureMemoryUserIdSchema(db, { cacheKey: `skill-files:${prefix}` })
  return db
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("skill-files procedural metadata", () => {
  it("upsert stores procedure key metadata", async () => {
    const db = await setupDb("memories-skill-files-upsert")
    const nowIso = "2026-02-26T00:00:00.000Z"

    const payload = await upsertSkillFilePayload({
      turso: db,
      path: "skills/deploy/runbook.md",
      content: "deployment steps",
      procedureKey: "deploy:runbook",
      userId: "user-1",
      nowIso,
    })

    expect(payload.data.created).toBe(true)
    expect(payload.data.skillFile.procedureKey).toBe("deploy:runbook")
    expect(payload.data.skillFile.usageCount).toBe(0)
    expect(payload.data.skillFile.lastUsedAt).toBeNull()
  })

  it("ranks list results using procedure key hooks before usage count", async () => {
    const db = await setupDb("memories-skill-files-ranking")
    const nowIso = "2026-02-26T00:00:00.000Z"

    const exact = await upsertSkillFilePayload({
      turso: db,
      path: "skills/deploy/exact.md",
      content: "exact deployment flow",
      procedureKey: "deploy",
      userId: "user-1",
      nowIso,
    })
    const highUsage = await upsertSkillFilePayload({
      turso: db,
      path: "skills/testing/high-usage.md",
      content: "test workflow",
      procedureKey: "testing",
      userId: "user-1",
      nowIso,
    })
    const prefix = await upsertSkillFilePayload({
      turso: db,
      path: "skills/deploy/rollback.md",
      content: "rollback workflow",
      procedureKey: "deploy:rollback",
      userId: "user-1",
      nowIso,
    })

    await markSkillFilesUsedPayload({
      turso: db,
      ids: [highUsage.data.skillFile.id, highUsage.data.skillFile.id, highUsage.data.skillFile.id],
      userId: "user-1",
      nowIso: "2026-02-26T01:00:00.000Z",
    })

    const listed = await listSkillFilesPayload({
      turso: db,
      userId: "user-1",
      limit: 10,
      procedureKey: "deploy",
    })

    expect(listed.data.skillFiles.map((skillFile) => skillFile.id)).toEqual([
      exact.data.skillFile.id,
      prefix.data.skillFile.id,
      highUsage.data.skillFile.id,
    ])

    const listedByQuery = await listSkillFilesPayload({
      turso: db,
      userId: "user-1",
      limit: 10,
      query: "deploy: roll out canary and promote",
    })

    expect(listedByQuery.data.skillFiles.map((skillFile) => skillFile.id)).toEqual([
      exact.data.skillFile.id,
      prefix.data.skillFile.id,
      highUsage.data.skillFile.id,
    ])
  })

  it("updates usage_count and last_used_at when marking skill files used", async () => {
    const db = await setupDb("memories-skill-files-usage")
    const created = await upsertSkillFilePayload({
      turso: db,
      path: "skills/release/checklist.md",
      content: "release checklist",
      procedureKey: "release",
      userId: "user-1",
      nowIso: "2026-02-26T00:00:00.000Z",
    })

    const affected = await markSkillFilesUsedPayload({
      turso: db,
      ids: [created.data.skillFile.id, created.data.skillFile.id],
      userId: "user-1",
      nowIso: "2026-02-26T02:00:00.000Z",
    })
    expect(affected).toBe(1)

    const rows = await db.execute({
      sql: "SELECT usage_count, last_used_at FROM skill_files WHERE id = ?",
      args: [created.data.skillFile.id],
    })

    expect(Number(rows.rows[0]?.usage_count ?? 0)).toBe(1)
    expect(String(rows.rows[0]?.last_used_at ?? "")).toBe("2026-02-26T02:00:00.000Z")
  })

  it("promotes a session snapshot into a procedural skill file", async () => {
    const db = await setupDb("memories-skill-files-promote")
    await db.execute({
      sql: `INSERT INTO memory_sessions
            (id, scope, project_id, user_id, client, status, title, started_at, last_activity_at, ended_at, metadata)
            VALUES (?, 'project', ?, ?, ?, 'active', ?, ?, ?, NULL, NULL)`,
      args: [
        "sess_1",
        "github.com/acme/platform",
        "user-1",
        "codex",
        "Incident recovery",
        "2026-02-26T00:00:00.000Z",
        "2026-02-26T00:00:00.000Z",
      ],
    })
    await db.execute({
      sql: `INSERT INTO memory_session_snapshots
            (id, session_id, slug, source_trigger, transcript_md, message_count, created_at)
            VALUES (?, ?, ?, 'manual', ?, 4, ?)`,
      args: [
        "snap_1",
        "sess_1",
        "incident-recovery",
        "# Session Snapshot\n\n### user (message)\nInvestigate outage\n\n### assistant (message)\nCheck logs and rollback if needed",
        "2026-02-26T00:10:00.000Z",
      ],
    })

    const promoted = await promoteSnapshotToSkillFilePayload({
      turso: db,
      sessionId: "sess_1",
      path: "skills/incident/recovery.md",
      projectId: "github.com/acme/platform",
      userId: "user-1",
      nowIso: "2026-02-26T00:20:00.000Z",
    })

    expect(promoted.data.created).toBe(true)
    expect(promoted.data.skillFile.procedureKey).toBe("incident-recovery")
    expect(promoted.data.skillFile.content).toContain("## Workflow Steps")
    expect(promoted.data.source.snapshotId).toBe("snap_1")
  })
})
