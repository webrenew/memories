import { getSdkDefaultEmbeddingModelId, getSdkEmbeddingBackfillBatchSize, getSdkEmbeddingBackfillThrottleMs } from "@/lib/env"
import type { TursoClient } from "@/lib/memory-service/types"
import { enqueueEmbeddingJob, triggerEmbeddingQueueProcessing } from "./jobs"
import { setTimeout as delay } from "node:timers/promises"

export type EmbeddingBackfillStatusValue = "idle" | "running" | "paused" | "completed"

interface EmbeddingBackfillScope {
  modelId: string
  projectId: string | null
  userId: string | null
}

interface EmbeddingBackfillStateRow {
  scopeKey: string
  modelId: string
  projectId: string | null
  userId: string | null
  status: EmbeddingBackfillStatusValue
  checkpointCreatedAt: string | null
  checkpointMemoryId: string | null
  scannedCount: number
  enqueuedCount: number
  estimatedTotal: number
  estimatedRemaining: number
  estimatedCompletionSeconds: number | null
  batchLimit: number
  throttleMs: number
  startedAt: string | null
  lastRunAt: string | null
  completedAt: string | null
  updatedAt: string
  lastError: string | null
}

interface MissingMemoryRow {
  id: string
  content: string
  createdAt: string
}

export interface GetEmbeddingBackfillStatusInput {
  turso: TursoClient
  modelId?: string | null
  projectId?: string | null
  userId?: string | null
}

export interface SetEmbeddingBackfillPausedInput extends GetEmbeddingBackfillStatusInput {
  paused: boolean
  nowIso?: string
}

export interface RunEmbeddingBackfillBatchInput extends GetEmbeddingBackfillStatusInput {
  batchLimit?: number
  throttleMs?: number
  nowIso?: string
}

export interface EmbeddingBackfillStatus {
  scopeKey: string
  modelId: string
  projectId: string | null
  userId: string | null
  status: EmbeddingBackfillStatusValue
  checkpointCreatedAt: string | null
  checkpointMemoryId: string | null
  scannedCount: number
  enqueuedCount: number
  estimatedTotal: number
  estimatedRemaining: number
  estimatedCompletionSeconds: number | null
  batchLimit: number
  throttleMs: number
  startedAt: string | null
  lastRunAt: string | null
  completedAt: string | null
  updatedAt: string | null
  lastError: string | null
}

export interface RunEmbeddingBackfillBatchResult {
  status: EmbeddingBackfillStatus
  batch: {
    scanned: number
    enqueued: number
    durationMs: number
  }
}

function parseStatus(value: unknown): EmbeddingBackfillStatusValue {
  const normalized = typeof value === "string" ? value : ""
  if (normalized === "running" || normalized === "paused" || normalized === "completed") {
    return normalized
  }
  return "idle"
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed)
  }
  return fallback
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return fallback
}

function trimNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeScope(input: { modelId?: string | null; projectId?: string | null; userId?: string | null }): EmbeddingBackfillScope {
  return {
    modelId: trimNullable(input.modelId) ?? getSdkDefaultEmbeddingModelId(),
    projectId: trimNullable(input.projectId),
    userId: trimNullable(input.userId),
  }
}

function buildScopeKey(scope: EmbeddingBackfillScope): string {
  return [scope.modelId, scope.projectId ?? "*", scope.userId ?? "*"].join("|")
}

function buildScopeFilter(scope: EmbeddingBackfillScope): { clause: string; args: string[] } {
  const clauses = ["m.deleted_at IS NULL", "TRIM(m.content) <> ''"]
  const args: string[] = []

  if (scope.projectId) {
    clauses.push("m.project_id = ?")
    args.push(scope.projectId)
  }
  if (scope.userId) {
    clauses.push("m.user_id = ?")
    args.push(scope.userId)
  }

  return {
    clause: clauses.join(" AND "),
    args,
  }
}

function truncateError(error: string, max = 1_200): string {
  if (error.length <= max) return error
  if (max <= 3) return error.slice(0, max)
  return `${error.slice(0, max - 3)}...`
}

function toBackfillState(row: Record<string, unknown>): EmbeddingBackfillStateRow {
  return {
    scopeKey: String(row.scope_key ?? ""),
    modelId: String(row.model ?? ""),
    projectId: typeof row.project_id === "string" ? row.project_id : null,
    userId: typeof row.user_id === "string" ? row.user_id : null,
    status: parseStatus(row.status),
    checkpointCreatedAt: typeof row.checkpoint_created_at === "string" ? row.checkpoint_created_at : null,
    checkpointMemoryId: typeof row.checkpoint_memory_id === "string" ? row.checkpoint_memory_id : null,
    scannedCount: parseNonNegativeInt(row.scanned_count, 0),
    enqueuedCount: parseNonNegativeInt(row.enqueued_count, 0),
    estimatedTotal: parseNonNegativeInt(row.estimated_total, 0),
    estimatedRemaining: parseNonNegativeInt(row.estimated_remaining, 0),
    estimatedCompletionSeconds:
      row.estimated_completion_seconds === null || row.estimated_completion_seconds === undefined
        ? null
        : parseNonNegativeInt(row.estimated_completion_seconds, 0),
    batchLimit: parsePositiveInt(row.batch_limit, getSdkEmbeddingBackfillBatchSize()),
    throttleMs: parseNonNegativeInt(row.throttle_ms, getSdkEmbeddingBackfillThrottleMs()),
    startedAt: typeof row.started_at === "string" ? row.started_at : null,
    lastRunAt: typeof row.last_run_at === "string" ? row.last_run_at : null,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
    lastError: typeof row.last_error === "string" ? row.last_error : null,
  }
}

function toStatusPayload(state: EmbeddingBackfillStateRow): EmbeddingBackfillStatus {
  return {
    scopeKey: state.scopeKey,
    modelId: state.modelId,
    projectId: state.projectId,
    userId: state.userId,
    status: state.status,
    checkpointCreatedAt: state.checkpointCreatedAt,
    checkpointMemoryId: state.checkpointMemoryId,
    scannedCount: state.scannedCount,
    enqueuedCount: state.enqueuedCount,
    estimatedTotal: state.estimatedTotal,
    estimatedRemaining: state.estimatedRemaining,
    estimatedCompletionSeconds: state.estimatedCompletionSeconds,
    batchLimit: state.batchLimit,
    throttleMs: state.throttleMs,
    startedAt: state.startedAt,
    lastRunAt: state.lastRunAt,
    completedAt: state.completedAt,
    updatedAt: state.updatedAt,
    lastError: state.lastError,
  }
}

async function loadBackfillState(turso: TursoClient, scopeKey: string): Promise<EmbeddingBackfillStateRow | null> {
  const result = await turso.execute({
    sql: `SELECT scope_key, model, project_id, user_id, status, checkpoint_created_at, checkpoint_memory_id,
                 scanned_count, enqueued_count, estimated_total, estimated_remaining, estimated_completion_seconds,
                 batch_limit, throttle_ms, started_at, last_run_at, completed_at, updated_at, last_error
          FROM memory_embedding_backfill_state
          WHERE scope_key = ?
          LIMIT 1`,
    args: [scopeKey],
  })

  if (!Array.isArray(result.rows) || result.rows.length === 0) {
    return null
  }
  return toBackfillState(result.rows[0] as Record<string, unknown>)
}

async function ensureBackfillStateRow(params: {
  turso: TursoClient
  scope: EmbeddingBackfillScope
  scopeKey: string
  batchLimit: number
  throttleMs: number
  nowIso: string
}): Promise<void> {
  await params.turso.execute({
    sql: `INSERT OR IGNORE INTO memory_embedding_backfill_state (
            scope_key, model, project_id, user_id, status, scanned_count, enqueued_count,
            estimated_total, estimated_remaining, estimated_completion_seconds,
            batch_limit, throttle_ms, started_at, last_run_at, completed_at, updated_at, last_error
          ) VALUES (?, ?, ?, ?, 'idle', 0, 0, 0, 0, NULL, ?, ?, NULL, NULL, NULL, ?, NULL)`,
    args: [
      params.scopeKey,
      params.scope.modelId,
      params.scope.projectId,
      params.scope.userId,
      params.batchLimit,
      params.throttleMs,
      params.nowIso,
    ],
  })
}

async function countMissingEmbeddings(turso: TursoClient, scope: EmbeddingBackfillScope): Promise<number> {
  const scopeFilter = buildScopeFilter(scope)
  const result = await turso.execute({
    sql: `SELECT COUNT(*) AS count
          FROM memories m
          LEFT JOIN memory_embeddings e ON e.memory_id = m.id
          WHERE ${scopeFilter.clause}
            AND (e.memory_id IS NULL OR e.model != ?)`,
    args: [...scopeFilter.args, scope.modelId],
  })
  return parseNonNegativeInt(result.rows[0]?.count, 0)
}

async function countRemainingAfterCheckpoint(params: {
  turso: TursoClient
  scope: EmbeddingBackfillScope
  checkpointCreatedAt: string | null
  checkpointMemoryId: string | null
}): Promise<number> {
  const scopeFilter = buildScopeFilter(params.scope)
  const checkpointAvailable = Boolean(params.checkpointCreatedAt && params.checkpointMemoryId)
  let sql = `SELECT COUNT(*) AS count
             FROM memories m
             LEFT JOIN memory_embeddings e ON e.memory_id = m.id
             WHERE ${scopeFilter.clause}
               AND (e.memory_id IS NULL OR e.model != ?)`
  const args: (string | number)[] = [...scopeFilter.args, params.scope.modelId]

  if (checkpointAvailable) {
    sql += " AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))"
    args.push(
      params.checkpointCreatedAt as string,
      params.checkpointCreatedAt as string,
      params.checkpointMemoryId as string
    )
  }

  const result = await params.turso.execute({ sql, args })
  return parseNonNegativeInt(result.rows[0]?.count, 0)
}

async function listMissingCandidates(params: {
  turso: TursoClient
  scope: EmbeddingBackfillScope
  checkpointCreatedAt: string | null
  checkpointMemoryId: string | null
  limit: number
}): Promise<MissingMemoryRow[]> {
  const scopeFilter = buildScopeFilter(params.scope)
  const checkpointAvailable = Boolean(params.checkpointCreatedAt && params.checkpointMemoryId)
  let sql = `SELECT m.id, m.content, m.created_at
             FROM memories m
             LEFT JOIN memory_embeddings e ON e.memory_id = m.id
             WHERE ${scopeFilter.clause}
               AND (e.memory_id IS NULL OR e.model != ?)`
  const args: (string | number)[] = [...scopeFilter.args, params.scope.modelId]

  if (checkpointAvailable) {
    sql += " AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))"
    args.push(
      params.checkpointCreatedAt as string,
      params.checkpointCreatedAt as string,
      params.checkpointMemoryId as string
    )
  }

  sql += " ORDER BY m.created_at ASC, m.id ASC LIMIT ?"
  args.push(params.limit)

  const result = await params.turso.execute({ sql, args })
  const rows = Array.isArray(result.rows) ? result.rows : []
  return rows.map((row) => {
    const record = row as Record<string, unknown>
    return {
      id: String(record.id ?? ""),
      content: String(record.content ?? ""),
      createdAt: String(record.created_at ?? ""),
    }
  })
}

function estimateCompletionSeconds(params: { scannedCount: number; startedAt: string | null; nowIso: string; remaining: number }): number | null {
  if (params.remaining <= 0) {
    return 0
  }
  if (!params.startedAt || params.scannedCount <= 0) {
    return null
  }

  const elapsedMs = Date.parse(params.nowIso) - Date.parse(params.startedAt)
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return null
  }

  const ratePerSecond = params.scannedCount / (elapsedMs / 1_000)
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
    return null
  }

  return Math.ceil(params.remaining / ratePerSecond)
}

async function insertBackfillMetric(params: {
  turso: TursoClient
  scopeKey: string
  modelId: string
  batchScanned: number
  batchEnqueued: number
  totalScanned: number
  totalEnqueued: number
  estimatedTotal: number
  estimatedRemaining: number
  estimatedCompletionSeconds: number | null
  durationMs: number
  status: EmbeddingBackfillStatusValue
  error?: string | null
  nowIso: string
}): Promise<void> {
  await params.turso.execute({
    sql: `INSERT INTO memory_embedding_backfill_metrics (
            id,
            scope_key,
            model,
            batch_scanned,
            batch_enqueued,
            total_scanned,
            total_enqueued,
            estimated_total,
            estimated_remaining,
            estimated_completion_seconds,
            duration_ms,
            status,
            error,
            ran_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID().replace(/-/g, ""),
      params.scopeKey,
      params.modelId,
      params.batchScanned,
      params.batchEnqueued,
      params.totalScanned,
      params.totalEnqueued,
      params.estimatedTotal,
      params.estimatedRemaining,
      params.estimatedCompletionSeconds,
      params.durationMs,
      params.status,
      params.error ?? null,
      params.nowIso,
    ],
  })
}

export async function getEmbeddingBackfillStatus(input: GetEmbeddingBackfillStatusInput): Promise<EmbeddingBackfillStatus> {
  const scope = normalizeScope(input)
  const scopeKey = buildScopeKey(scope)
  const existing = await loadBackfillState(input.turso, scopeKey)
  if (existing) {
    return toStatusPayload(existing)
  }

  const missingCount = await countMissingEmbeddings(input.turso, scope)
  return {
    scopeKey,
    modelId: scope.modelId,
    projectId: scope.projectId,
    userId: scope.userId,
    status: "idle",
    checkpointCreatedAt: null,
    checkpointMemoryId: null,
    scannedCount: 0,
    enqueuedCount: 0,
    estimatedTotal: missingCount,
    estimatedRemaining: missingCount,
    estimatedCompletionSeconds: missingCount > 0 ? null : 0,
    batchLimit: getSdkEmbeddingBackfillBatchSize(),
    throttleMs: getSdkEmbeddingBackfillThrottleMs(),
    startedAt: null,
    lastRunAt: null,
    completedAt: null,
    updatedAt: null,
    lastError: null,
  }
}

export async function setEmbeddingBackfillPaused(input: SetEmbeddingBackfillPausedInput): Promise<EmbeddingBackfillStatus> {
  const scope = normalizeScope(input)
  const scopeKey = buildScopeKey(scope)
  const nowIso = input.nowIso ?? new Date().toISOString()
  const defaultBatchLimit = getSdkEmbeddingBackfillBatchSize()
  const defaultThrottleMs = getSdkEmbeddingBackfillThrottleMs()

  await ensureBackfillStateRow({
    turso: input.turso,
    scope,
    scopeKey,
    batchLimit: defaultBatchLimit,
    throttleMs: defaultThrottleMs,
    nowIso,
  })

  await input.turso.execute({
    sql: `UPDATE memory_embedding_backfill_state
          SET status = ?,
              updated_at = ?,
              last_error = NULL
          WHERE scope_key = ?`,
    args: [input.paused ? "paused" : "idle", nowIso, scopeKey],
  })

  const updated = await loadBackfillState(input.turso, scopeKey)
  if (!updated) {
    throw new Error("Failed to update embedding backfill state")
  }
  return toStatusPayload(updated)
}

export async function runEmbeddingBackfillBatch(input: RunEmbeddingBackfillBatchInput): Promise<RunEmbeddingBackfillBatchResult> {
  const scope = normalizeScope(input)
  const scopeKey = buildScopeKey(scope)
  const nowIso = input.nowIso ?? new Date().toISOString()
  const batchLimit = Math.max(1, input.batchLimit ?? getSdkEmbeddingBackfillBatchSize())
  const throttleMs = Math.max(0, input.throttleMs ?? getSdkEmbeddingBackfillThrottleMs())

  await ensureBackfillStateRow({
    turso: input.turso,
    scope,
    scopeKey,
    batchLimit,
    throttleMs,
    nowIso,
  })

  const existing = await loadBackfillState(input.turso, scopeKey)
  if (!existing) {
    throw new Error("Failed to load embedding backfill state")
  }

  if (existing.status === "paused") {
    return {
      status: toStatusPayload(existing),
      batch: {
        scanned: 0,
        enqueued: 0,
        durationMs: 0,
      },
    }
  }

  const runStartedAt = Date.now()
  const startedAt = existing.startedAt ?? nowIso

  await input.turso.execute({
    sql: `UPDATE memory_embedding_backfill_state
          SET status = 'running',
              batch_limit = ?,
              throttle_ms = ?,
              started_at = ?,
              updated_at = ?,
              last_error = NULL
          WHERE scope_key = ?`,
    args: [batchLimit, throttleMs, startedAt, nowIso, scopeKey],
  })

  let batchScanned = 0
  let batchEnqueued = 0
  let checkpointCreatedAt = existing.checkpointCreatedAt
  let checkpointMemoryId = existing.checkpointMemoryId

  try {
    const estimatedTotal = await countMissingEmbeddings(input.turso, scope)
    const candidates = await listMissingCandidates({
      turso: input.turso,
      scope,
      checkpointCreatedAt: existing.checkpointCreatedAt,
      checkpointMemoryId: existing.checkpointMemoryId,
      limit: batchLimit,
    })

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      batchScanned += 1
      checkpointCreatedAt = candidate.createdAt
      checkpointMemoryId = candidate.id

      const queued = await enqueueEmbeddingJob({
        turso: input.turso,
        memoryId: candidate.id,
        content: candidate.content,
        modelId: scope.modelId,
        operation: "backfill",
        nowIso,
      })
      if (queued) {
        batchEnqueued += 1
      }

      if (throttleMs > 0 && index < candidates.length - 1) {
        await delay(throttleMs)
      }
    }

    const totalScanned = existing.scannedCount + batchScanned
    const totalEnqueued = existing.enqueuedCount + batchEnqueued
    const remaining = await countRemainingAfterCheckpoint({
      turso: input.turso,
      scope,
      checkpointCreatedAt,
      checkpointMemoryId,
    })
    const status: EmbeddingBackfillStatusValue = remaining === 0 ? "completed" : "running"
    const estimatedCompletionSeconds = estimateCompletionSeconds({
      scannedCount: totalScanned,
      startedAt,
      nowIso,
      remaining,
    })

    await input.turso.execute({
      sql: `UPDATE memory_embedding_backfill_state
            SET status = ?,
                checkpoint_created_at = ?,
                checkpoint_memory_id = ?,
                scanned_count = ?,
                enqueued_count = ?,
                estimated_total = ?,
                estimated_remaining = ?,
                estimated_completion_seconds = ?,
                batch_limit = ?,
                throttle_ms = ?,
                started_at = ?,
                last_run_at = ?,
                completed_at = ?,
                updated_at = ?,
                last_error = NULL
            WHERE scope_key = ?`,
      args: [
        status,
        checkpointCreatedAt,
        checkpointMemoryId,
        totalScanned,
        totalEnqueued,
        estimatedTotal,
        remaining,
        estimatedCompletionSeconds,
        batchLimit,
        throttleMs,
        startedAt,
        nowIso,
        status === "completed" ? nowIso : null,
        nowIso,
        scopeKey,
      ],
    })

    await insertBackfillMetric({
      turso: input.turso,
      scopeKey,
      modelId: scope.modelId,
      batchScanned,
      batchEnqueued,
      totalScanned,
      totalEnqueued,
      estimatedTotal,
      estimatedRemaining: remaining,
      estimatedCompletionSeconds,
      durationMs: Date.now() - runStartedAt,
      status,
      nowIso,
    })

    if (batchEnqueued > 0) {
      triggerEmbeddingQueueProcessing(input.turso)
    }

    const next = await loadBackfillState(input.turso, scopeKey)
    if (!next) {
      throw new Error("Failed to load updated embedding backfill state")
    }

    return {
      status: toStatusPayload(next),
      batch: {
        scanned: batchScanned,
        enqueued: batchEnqueued,
        durationMs: Math.max(0, Date.now() - runStartedAt),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedding backfill failed"
    await input.turso.execute({
      sql: `UPDATE memory_embedding_backfill_state
            SET status = 'running',
                updated_at = ?,
                last_run_at = ?,
                last_error = ?
            WHERE scope_key = ?`,
      args: [nowIso, nowIso, truncateError(message), scopeKey],
    })
    await insertBackfillMetric({
      turso: input.turso,
      scopeKey,
      modelId: scope.modelId,
      batchScanned,
      batchEnqueued,
      totalScanned: existing.scannedCount + batchScanned,
      totalEnqueued: existing.enqueuedCount + batchEnqueued,
      estimatedTotal: existing.estimatedTotal,
      estimatedRemaining: existing.estimatedRemaining,
      estimatedCompletionSeconds: existing.estimatedCompletionSeconds,
      durationMs: Date.now() - runStartedAt,
      status: "running",
      error: truncateError(message),
      nowIso,
    })
    throw error
  }
}

