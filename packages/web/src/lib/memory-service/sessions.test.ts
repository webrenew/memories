import { createClient } from "@libsql/client"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  checkpointSessionPayload,
  endSessionPayload,
  getLatestSessionSnapshotPayload,
  startSessionPayload,
} from "./sessions"

type DbClient = ReturnType<typeof createClient>

const testDatabases: DbClient[] = []

async function setupDb(prefix: string): Promise<DbClient> {
  const dbDir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const db = createClient({ url: `file:${join(dbDir, "sessions.db")}` })
  testDatabases.push(db)

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memory_sessions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      user_id TEXT,
      client TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      title TEXT,
      started_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      ended_at TEXT,
      metadata TEXT
    )`
  )

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memory_session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      turn_index INTEGER,
      is_meaningful INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`
  )

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memory_session_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      source_trigger TEXT NOT NULL,
      transcript_md TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`
  )

  return db
}

afterEach(() => {
  for (const db of testDatabases.splice(0, testDatabases.length)) {
    db.close()
  }
})

describe("session payload helpers", () => {
  it("supports start, checkpoint, and end payloads", async () => {
    const db = await setupDb("memory-session-payloads")
    const start = await startSessionPayload({
      turso: db,
      args: {
        title: "SDK session",
        client: "sdk-test",
      },
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T00:00:00.000Z",
    })

    expect(start.data.session.scope).toBe("project")
    expect(start.data.session.projectId).toBe("github.com/acme/memories")
    expect(start.data.session.status).toBe("active")

    const checkpoint = await checkpointSessionPayload({
      turso: db,
      args: {
        sessionId: start.data.sessionId,
        content: "saved a checkpoint",
        role: "assistant",
        kind: "checkpoint",
      },
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T00:01:00.000Z",
    })

    expect(checkpoint.data.sessionId).toBe(start.data.sessionId)
    expect(checkpoint.data.event.kind).toBe("checkpoint")

    const ended = await endSessionPayload({
      turso: db,
      args: {
        sessionId: start.data.sessionId,
        status: "closed",
      },
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T00:02:00.000Z",
    })

    expect(ended.data.session.status).toBe("closed")
    expect(ended.data.session.endedAt).toBe("2026-02-26T00:02:00.000Z")
  })

  it("returns the latest snapshot by created_at", async () => {
    const db = await setupDb("memory-session-snapshots")
    const start = await startSessionPayload({
      turso: db,
      args: {
        title: "Snapshot source",
      },
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T01:00:00.000Z",
    })

    await db.execute({
      sql: `INSERT INTO memory_session_snapshots
            (id, session_id, slug, source_trigger, transcript_md, message_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["snap_old", start.data.sessionId, "old", "manual", "# old", 2, "2026-02-26T01:10:00.000Z"],
    })
    await db.execute({
      sql: `INSERT INTO memory_session_snapshots
            (id, session_id, slug, source_trigger, transcript_md, message_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["snap_new", start.data.sessionId, "new", "manual", "# new", 3, "2026-02-26T01:20:00.000Z"],
    })

    const snapshot = await getLatestSessionSnapshotPayload({
      turso: db,
      sessionId: start.data.sessionId,
      projectId: "github.com/acme/memories",
      userId: "user-1",
    })

    expect(snapshot.data.snapshot.id).toBe("snap_new")
    expect(snapshot.data.snapshot.messageCount).toBe(3)
  })

  it("rejects checkpoint writes after a session is closed", async () => {
    const db = await setupDb("memory-session-closed")
    const start = await startSessionPayload({
      turso: db,
      args: {},
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T02:00:00.000Z",
    })

    await endSessionPayload({
      turso: db,
      args: {
        sessionId: start.data.sessionId,
        status: "closed",
      },
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T02:01:00.000Z",
    })

    await expect(
      checkpointSessionPayload({
        turso: db,
        args: {
          sessionId: start.data.sessionId,
          content: "should fail",
        },
        projectId: "github.com/acme/memories",
        userId: "user-1",
        nowIso: "2026-02-26T02:02:00.000Z",
      })
    ).rejects.toMatchObject({
      detail: {
        code: "SESSION_NOT_ACTIVE",
      },
    })
  })

  it("rejects ending a session that is already closed", async () => {
    const db = await setupDb("memory-session-double-end")
    const start = await startSessionPayload({
      turso: db,
      args: {},
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T03:00:00.000Z",
    })

    await endSessionPayload({
      turso: db,
      args: {
        sessionId: start.data.sessionId,
        status: "closed",
      },
      projectId: "github.com/acme/memories",
      userId: "user-1",
      nowIso: "2026-02-26T03:01:00.000Z",
    })

    await expect(
      endSessionPayload({
        turso: db,
        args: {
          sessionId: start.data.sessionId,
          status: "compacted",
        },
        projectId: "github.com/acme/memories",
        userId: "user-1",
        nowIso: "2026-02-26T03:02:00.000Z",
      })
    ).rejects.toMatchObject({
      detail: {
        code: "SESSION_NOT_ACTIVE",
      },
    })

    const result = await db.execute({
      sql: "SELECT status, ended_at FROM memory_sessions WHERE id = ? LIMIT 1",
      args: [start.data.sessionId],
    })
    expect(result.rows[0]).toMatchObject({
      status: "closed",
      ended_at: "2026-02-26T03:01:00.000Z",
    })
  })
})
