import { apiError, ToolExecutionError, type TursoClient } from "./types"

type SessionStatus = "active" | "compacted" | "closed"
type SessionRole = "user" | "assistant" | "tool"
type SessionEventKind = "message" | "checkpoint" | "summary" | "event"
type SessionSnapshotTrigger = "new_session" | "reset" | "manual" | "auto_compaction"

interface SessionRow {
  id: string
  scope: "global" | "project"
  project_id: string | null
  user_id: string | null
  client: string | null
  status: SessionStatus
  title: string | null
  started_at: string
  last_activity_at: string
  ended_at: string | null
  metadata: string | null
}

interface SessionEventRow {
  id: string
  session_id: string
  role: SessionRole
  kind: SessionEventKind
  content: string
  token_count: number | null
  turn_index: number | null
  is_meaningful: number
  created_at: string
}

interface SessionSnapshotRow {
  id: string
  session_id: string
  slug: string
  source_trigger: SessionSnapshotTrigger
  transcript_md: string
  message_count: number
  created_at: string
}

function parseMetadata(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore metadata parse failures for backward compatibility
  }
  return null
}

function toStructuredSession(row: SessionRow) {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    userId: row.user_id,
    client: row.client,
    status: row.status,
    title: row.title,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at,
    metadata: parseMetadata(row.metadata),
  }
}

function toStructuredEvent(row: SessionEventRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    kind: row.kind,
    content: row.content,
    tokenCount: row.token_count,
    turnIndex: row.turn_index,
    isMeaningful: row.is_meaningful === 1,
    createdAt: row.created_at,
  }
}

function toStructuredSnapshot(row: SessionSnapshotRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    slug: row.slug,
    sourceTrigger: row.source_trigger,
    transcriptMd: row.transcript_md,
    messageCount: row.message_count,
    createdAt: row.created_at,
  }
}

function sessionNotFoundError(sessionId: string): ToolExecutionError {
  return new ToolExecutionError(
    apiError({
      type: "not_found_error",
      code: "SESSION_NOT_FOUND",
      message: `Session not found: ${sessionId}`,
      status: 404,
      retryable: false,
      details: { sessionId },
    }),
    { rpcCode: -32004 }
  )
}

function snapshotNotFoundError(sessionId: string): ToolExecutionError {
  return new ToolExecutionError(
    apiError({
      type: "not_found_error",
      code: "SESSION_SNAPSHOT_NOT_FOUND",
      message: `No snapshots found for session: ${sessionId}`,
      status: 404,
      retryable: false,
      details: { sessionId },
    }),
    { rpcCode: -32004 }
  )
}

function validationError(code: string, message: string, field: string): ToolExecutionError {
  return new ToolExecutionError(
    apiError({
      type: "validation_error",
      code,
      message,
      status: 400,
      retryable: false,
      details: { field },
    }),
    { rpcCode: -32602 }
  )
}

function sessionNotActiveError(sessionId: string, status: string): ToolExecutionError {
  return new ToolExecutionError(
    apiError({
      type: "validation_error",
      code: "SESSION_NOT_ACTIVE",
      message: `Session ${sessionId} is ${status}; only active sessions can be checkpointed`,
      status: 409,
      retryable: false,
      details: { sessionId, status },
    }),
    { rpcCode: -32602 }
  )
}

function buildScopedSessionLookup(args: {
  sessionId: string
  userId: string | null
  projectId?: string
}): { sql: string; queryArgs: string[] } {
  const whereClauses: string[] = ["id = ?"]
  const queryArgs: string[] = [args.sessionId]

  if (args.userId) {
    whereClauses.push("user_id = ?")
    queryArgs.push(args.userId)
  } else {
    whereClauses.push("user_id IS NULL")
  }

  if (args.projectId) {
    whereClauses.push("project_id = ?")
    queryArgs.push(args.projectId)
  } else {
    whereClauses.push("project_id IS NULL")
  }

  return {
    sql: `SELECT * FROM memory_sessions WHERE ${whereClauses.join(" AND ")} LIMIT 1`,
    queryArgs,
  }
}

async function getScopedSession(args: {
  turso: TursoClient
  sessionId: string
  userId: string | null
  projectId?: string
}): Promise<SessionRow | null> {
  const { sql, queryArgs } = buildScopedSessionLookup(args)
  const result = await args.turso.execute({
    sql,
    args: queryArgs,
  })
  return result.rows[0] ? (result.rows[0] as unknown as SessionRow) : null
}

export async function startSessionPayload(params: {
  turso: TursoClient
  args: {
    title?: string
    client?: string
    metadata?: Record<string, unknown>
  }
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { sessionId: string; message: string; session: ReturnType<typeof toStructuredSession> } }> {
  const { turso, args, projectId, userId, nowIso } = params

  const sessionId = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  const scope = projectId ? "project" : "global"
  const title = typeof args.title === "string" ? args.title.trim() || null : null
  const client = typeof args.client === "string" ? args.client.trim() || null : null
  const metadata = args.metadata ? JSON.stringify(args.metadata) : null

  await turso.execute({
    sql: `INSERT INTO memory_sessions (
            id, scope, project_id, user_id, client, status, title, started_at, last_activity_at, ended_at, metadata
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?)`,
    args: [sessionId, scope, projectId ?? null, userId, client, title, nowIso, nowIso, metadata],
  })

  const row = await getScopedSession({
    turso,
    sessionId,
    userId,
    projectId,
  })

  if (!row) {
    throw sessionNotFoundError(sessionId)
  }

  const message = `Started session ${sessionId}`
  return {
    text: message,
    data: {
      sessionId,
      message,
      session: toStructuredSession(row),
    },
  }
}

export async function checkpointSessionPayload(params: {
  turso: TursoClient
  args: {
    sessionId?: string
    content?: string
    role?: SessionRole
    kind?: SessionEventKind
    tokenCount?: number
    turnIndex?: number
    isMeaningful?: boolean
  }
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { sessionId: string; eventId: string; message: string; event: ReturnType<typeof toStructuredEvent> } }> {
  const { turso, args, projectId, userId, nowIso } = params
  const sessionId = args.sessionId?.trim()
  if (!sessionId) {
    throw validationError("SESSION_ID_REQUIRED", "Session id is required", "sessionId")
  }

  const content = args.content?.trim()
  if (!content) {
    throw validationError("SESSION_CONTENT_REQUIRED", "Checkpoint content is required", "content")
  }

  const session = await getScopedSession({
    turso,
    sessionId,
    userId,
    projectId,
  })

  if (!session) {
    throw sessionNotFoundError(sessionId)
  }

  if (session.status !== "active") {
    throw sessionNotActiveError(sessionId, session.status)
  }

  const role: SessionRole = args.role ?? "assistant"
  const kind: SessionEventKind = args.kind ?? "checkpoint"
  const tokenCount = typeof args.tokenCount === "number" && Number.isFinite(args.tokenCount) ? Math.floor(args.tokenCount) : null
  const turnIndex = typeof args.turnIndex === "number" && Number.isFinite(args.turnIndex) ? Math.floor(args.turnIndex) : null
  const isMeaningful = args.isMeaningful === false ? 0 : 1
  const eventId = crypto.randomUUID().replace(/-/g, "").slice(0, 12)

  await turso.execute({
    sql: `INSERT INTO memory_session_events
            (id, session_id, role, kind, content, token_count, turn_index, is_meaningful, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [eventId, sessionId, role, kind, content, tokenCount, turnIndex, isMeaningful, nowIso],
  })

  await turso.execute({
    sql: "UPDATE memory_sessions SET last_activity_at = ? WHERE id = ?",
    args: [nowIso, sessionId],
  })

  const eventResult = await turso.execute({
    sql: "SELECT * FROM memory_session_events WHERE id = ? LIMIT 1",
    args: [eventId],
  })
  const eventRow = eventResult.rows[0] as unknown as SessionEventRow | undefined
  if (!eventRow) {
    throw new ToolExecutionError(
      apiError({
        type: "internal_error",
        code: "SESSION_EVENT_WRITE_FAILED",
        message: "Checkpoint write failed",
        status: 500,
        retryable: true,
      })
    )
  }

  const message = `Checkpointed session ${sessionId}`
  return {
    text: message,
    data: {
      sessionId,
      eventId,
      message,
      event: toStructuredEvent(eventRow),
    },
  }
}

export async function endSessionPayload(params: {
  turso: TursoClient
  args: {
    sessionId?: string
    status?: Exclude<SessionStatus, "active">
  }
  projectId?: string
  userId: string | null
  nowIso: string
}): Promise<{ text: string; data: { sessionId: string; message: string; session: ReturnType<typeof toStructuredSession> } }> {
  const { turso, args, projectId, userId, nowIso } = params
  const sessionId = args.sessionId?.trim()
  if (!sessionId) {
    throw validationError("SESSION_ID_REQUIRED", "Session id is required", "sessionId")
  }

  const status = args.status ?? "closed"
  if (status !== "closed" && status !== "compacted") {
    throw validationError("INVALID_SESSION_STATUS", "Status must be 'closed' or 'compacted'", "status")
  }

  const session = await getScopedSession({
    turso,
    sessionId,
    userId,
    projectId,
  })
  if (!session) {
    throw sessionNotFoundError(sessionId)
  }

  await turso.execute({
    sql: "UPDATE memory_sessions SET status = ?, ended_at = ?, last_activity_at = ? WHERE id = ?",
    args: [status, nowIso, nowIso, sessionId],
  })

  const updated = await getScopedSession({
    turso,
    sessionId,
    userId,
    projectId,
  })
  if (!updated) {
    throw sessionNotFoundError(sessionId)
  }

  const message = `Ended session ${sessionId} as ${status}`
  return {
    text: message,
    data: {
      sessionId,
      message,
      session: toStructuredSession(updated),
    },
  }
}

export async function getLatestSessionSnapshotPayload(params: {
  turso: TursoClient
  sessionId: string
  projectId?: string
  userId: string | null
}): Promise<{ text: string; data: { sessionId: string; snapshot: ReturnType<typeof toStructuredSnapshot>; message: string } }> {
  const { turso, sessionId, projectId, userId } = params
  const session = await getScopedSession({
    turso,
    sessionId,
    userId,
    projectId,
  })
  if (!session) {
    throw sessionNotFoundError(sessionId)
  }

  const snapshotResult = await turso.execute({
    sql: `SELECT * FROM memory_session_snapshots
          WHERE session_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [sessionId],
  })
  const row = snapshotResult.rows[0] as unknown as SessionSnapshotRow | undefined
  if (!row) {
    throw snapshotNotFoundError(sessionId)
  }

  const message = `Latest snapshot for session ${sessionId}`
  return {
    text: message,
    data: {
      sessionId,
      snapshot: toStructuredSnapshot(row),
      message,
    },
  }
}
