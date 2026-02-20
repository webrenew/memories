import {
  getAiGatewayApiKey,
  getAiGatewayBaseUrl,
  getSdkEmbeddingJobMaxAttempts,
  getSdkEmbeddingJobProcessingTimeoutMs,
  getSdkEmbeddingJobRetryBaseMs,
  getSdkEmbeddingJobRetryMaxMs,
  getSdkEmbeddingJobWorkerBatchSize,
} from "@/lib/env"
import type { TursoClient } from "@/lib/memory-service/types"

export type EmbeddingJobOperation = "add" | "edit" | "backfill"

type EmbeddingJobOutcome = "success" | "retry" | "dead_letter" | "skipped"

interface EmbeddingJobRow {
  id: string
  memoryId: string
  operation: EmbeddingJobOperation
  model: string
  modelVersion: string | null
  content: string
  attemptCount: number
  maxAttempts: number
}

interface GatewayEmbeddingResponse {
  data?: Array<{
    embedding?: unknown
  }>
  model?: unknown
}

interface EmbeddingJobErrorOptions {
  code: string
  retryable: boolean
  cause?: unknown
}

export interface EnqueueEmbeddingJobInput {
  turso: TursoClient
  memoryId: string
  content: string
  modelId: string
  operation: EmbeddingJobOperation
  modelVersion?: string | null
  maxAttempts?: number
  nowIso?: string
}

export interface ProcessEmbeddingJobsInput {
  turso: TursoClient
  maxJobs?: number
  nowIso?: string
}

export interface ProcessEmbeddingJobsSummary {
  processed: number
  success: number
  retries: number
  deadLetters: number
  skipped: number
}

class EmbeddingJobError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, options: EmbeddingJobErrorOptions) {
    super(message)
    this.name = "EmbeddingJobError"
    this.code = options.code
    this.retryable = options.retryable
    if (options.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

function getRowsAffected(result: unknown): number {
  if (!result || typeof result !== "object") return 0
  const rowsAffected = (result as { rowsAffected?: unknown }).rowsAffected
  return typeof rowsAffected === "number" && Number.isFinite(rowsAffected) ? rowsAffected : 0
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return fallback
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed)
  }
  return fallback
}

function truncateText(value: string, max = 1_200): string {
  if (value.length <= max) return value
  if (max <= 3) {
    return value.slice(0, max)
  }
  return `${value.slice(0, max - 3)}...`
}

function encodeEmbedding(values: number[]): Uint8Array {
  if (values.length === 0) {
    throw new EmbeddingJobError("Embedding response was empty", {
      code: "EMBEDDING_RESPONSE_EMPTY",
      retryable: false,
    })
  }

  const vector = new Float32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!Number.isFinite(value)) {
      throw new EmbeddingJobError("Embedding response contained non-finite values", {
        code: "EMBEDDING_RESPONSE_INVALID_VALUE",
        retryable: false,
      })
    }
    vector[index] = value
  }

  const copy = vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)
  return new Uint8Array(copy)
}

function parseEmbeddingArray(payload: GatewayEmbeddingResponse): number[] {
  const first = Array.isArray(payload.data) && payload.data.length > 0 ? payload.data[0] : null
  const embedding = first?.embedding
  if (!Array.isArray(embedding)) {
    throw new EmbeddingJobError("Embedding response did not include a vector", {
      code: "EMBEDDING_RESPONSE_MISSING_VECTOR",
      retryable: false,
    })
  }

  return embedding.map((value) => Number(value))
}

function computeRetryDelayMs(attempt: number): number {
  const baseMs = getSdkEmbeddingJobRetryBaseMs()
  const maxMs = getSdkEmbeddingJobRetryMaxMs()
  const safeAttempt = Math.max(1, attempt)
  const exponential = Math.round(baseMs * Math.pow(2, safeAttempt - 1))
  return Math.max(baseMs, Math.min(maxMs, exponential))
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function toEmbeddingJobError(error: unknown): EmbeddingJobError {
  if (error instanceof EmbeddingJobError) {
    return error
  }

  const message = error instanceof Error ? error.message : "Unexpected embedding worker error"
  return new EmbeddingJobError(message, {
    code: "EMBEDDING_JOB_FAILED",
    retryable: true,
    cause: error,
  })
}

async function fetchGatewayEmbedding(params: {
  modelId: string
  content: string
}): Promise<{ embedding: number[]; modelVersion: string }> {
  let apiKey: string
  try {
    apiKey = getAiGatewayApiKey()
  } catch (error) {
    throw new EmbeddingJobError("AI Gateway API key is not configured", {
      code: "EMBEDDING_GATEWAY_CONFIG_MISSING",
      retryable: false,
      cause: error,
    })
  }

  const baseUrl = getAiGatewayBaseUrl().replace(/\/$/, "")
  let response: Response
  try {
    response = await fetch(`${baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.modelId,
        input: params.content,
      }),
      cache: "no-store",
    })
  } catch (error) {
    throw new EmbeddingJobError("Failed to call AI Gateway embeddings endpoint", {
      code: "EMBEDDING_GATEWAY_REQUEST_FAILED",
      retryable: true,
      cause: error,
    })
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "")
    throw new EmbeddingJobError(
      `AI Gateway embeddings request failed with status ${response.status}${bodyText ? `: ${truncateText(bodyText, 300)}` : ""}`,
      {
        code: `EMBEDDING_GATEWAY_HTTP_${response.status}`,
        retryable: isRetryableHttpStatus(response.status),
      }
    )
  }

  const payload = (await response.json().catch(() => null)) as GatewayEmbeddingResponse | null
  if (!payload || typeof payload !== "object") {
    throw new EmbeddingJobError("AI Gateway embeddings response was not valid JSON", {
      code: "EMBEDDING_RESPONSE_INVALID_JSON",
      retryable: true,
    })
  }

  const embedding = parseEmbeddingArray(payload)
  const modelVersion = typeof payload.model === "string" && payload.model.trim().length > 0 ? payload.model : "gateway-v1"
  return { embedding, modelVersion }
}

async function requeueStaleProcessingJobs(turso: TursoClient, nowIso: string): Promise<void> {
  const timeoutMs = getSdkEmbeddingJobProcessingTimeoutMs()
  const staleBeforeIso = new Date(Date.parse(nowIso) - timeoutMs).toISOString()
  await turso.execute({
    sql: `UPDATE memory_embedding_jobs
          SET status = 'queued',
              next_attempt_at = ?,
              updated_at = ?,
              claimed_by = NULL,
              claimed_at = NULL,
              last_error = CASE
                WHEN last_error IS NULL OR last_error = '' THEN 'worker processing timeout'
                ELSE last_error
              END
          WHERE status = 'processing'
            AND claimed_at IS NOT NULL
            AND claimed_at <= ?`,
    args: [nowIso, nowIso, staleBeforeIso],
  })
}

async function claimNextDueJob(turso: TursoClient, nowIso: string): Promise<EmbeddingJobRow | null> {
  const claimToken = crypto.randomUUID().replace(/-/g, "")
  const claimResult = await turso.execute({
    sql: `UPDATE memory_embedding_jobs
          SET status = 'processing',
              claimed_by = ?,
              claimed_at = ?,
              updated_at = ?
          WHERE id = (
            SELECT id
            FROM memory_embedding_jobs
            WHERE status = 'queued'
              AND next_attempt_at <= ?
            ORDER BY next_attempt_at ASC, created_at ASC
            LIMIT 1
          )
          AND status = 'queued'`,
    args: [claimToken, nowIso, nowIso, nowIso],
  })

  if (getRowsAffected(claimResult) === 0) {
    return null
  }

  const result = await turso.execute({
    sql: `SELECT id, memory_id, operation, model, model_version, content, attempt_count, max_attempts
          FROM memory_embedding_jobs
          WHERE claimed_by = ?
            AND status = 'processing'
          LIMIT 1`,
    args: [claimToken],
  })

  if (!Array.isArray(result.rows) || result.rows.length === 0) {
    return null
  }

  const row = result.rows[0] as Record<string, unknown>
  const operationValue = String(row.operation ?? "")
  const operation: EmbeddingJobOperation =
    operationValue === "edit" || operationValue === "backfill" ? operationValue : "add"

  return {
    id: String(row.id ?? ""),
    memoryId: String(row.memory_id ?? ""),
    operation,
    model: String(row.model ?? ""),
    modelVersion: typeof row.model_version === "string" ? row.model_version : null,
    content: String(row.content ?? ""),
    attemptCount: parseNonNegativeInt(row.attempt_count, 0),
    maxAttempts: parsePositiveInt(row.max_attempts, getSdkEmbeddingJobMaxAttempts()),
  }
}

async function markJobSucceeded(params: {
  turso: TursoClient
  jobId: string
  nowIso: string
  attempts: number
}): Promise<void> {
  await params.turso.execute({
    sql: `UPDATE memory_embedding_jobs
          SET status = 'succeeded',
              attempt_count = ?,
              updated_at = ?,
              claimed_by = NULL,
              claimed_at = NULL,
              last_error = NULL,
              dead_letter_reason = NULL,
              dead_letter_at = NULL
          WHERE id = ?`,
    args: [params.attempts, params.nowIso, params.jobId],
  })
}

async function markJobForRetry(params: {
  turso: TursoClient
  jobId: string
  attempts: number
  nowIso: string
  nextAttemptAt: string
  errorMessage: string
}): Promise<void> {
  await params.turso.execute({
    sql: `UPDATE memory_embedding_jobs
          SET status = 'queued',
              attempt_count = ?,
              next_attempt_at = ?,
              updated_at = ?,
              claimed_by = NULL,
              claimed_at = NULL,
              last_error = ?,
              dead_letter_reason = NULL,
              dead_letter_at = NULL
          WHERE id = ?`,
    args: [params.attempts, params.nextAttemptAt, params.nowIso, truncateText(params.errorMessage), params.jobId],
  })
}

async function markJobDeadLetter(params: {
  turso: TursoClient
  jobId: string
  attempts: number
  nowIso: string
  reason: string
}): Promise<void> {
  await params.turso.execute({
    sql: `UPDATE memory_embedding_jobs
          SET status = 'dead_letter',
              attempt_count = ?,
              updated_at = ?,
              claimed_by = NULL,
              claimed_at = NULL,
              last_error = ?,
              dead_letter_reason = ?,
              dead_letter_at = ?
          WHERE id = ?`,
    args: [
      params.attempts,
      params.nowIso,
      truncateText(params.reason),
      truncateText(params.reason),
      params.nowIso,
      params.jobId,
    ],
  })
}

async function recordJobMetric(params: {
  turso: TursoClient
  nowIso: string
  job: EmbeddingJobRow
  attempt: number
  outcome: EmbeddingJobOutcome
  durationMs: number
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  try {
    await params.turso.execute({
      sql: `INSERT INTO memory_embedding_job_metrics (
              id,
              job_id,
              memory_id,
              operation,
              model,
              attempt,
              outcome,
              duration_ms,
              error_code,
              error_message,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID().replace(/-/g, ""),
        params.job.id,
        params.job.memoryId,
        params.job.operation,
        params.job.model,
        params.attempt,
        params.outcome,
        Math.max(0, Math.round(params.durationMs)),
        params.errorCode ?? null,
        params.errorMessage ? truncateText(params.errorMessage) : null,
        params.nowIso,
      ],
    })
  } catch (error) {
    console.error("Embedding job metrics insert failed:", error)
  }
}

async function processSingleJob(turso: TursoClient, job: EmbeddingJobRow, nowIso: string): Promise<EmbeddingJobOutcome> {
  const startedAt = Date.now()
  const attempts = job.attemptCount + 1

  try {
    const memoryResult = await turso.execute({
      sql: "SELECT id, deleted_at FROM memories WHERE id = ? LIMIT 1",
      args: [job.memoryId],
    })
    const memoryRow = Array.isArray(memoryResult.rows) && memoryResult.rows.length > 0
      ? (memoryResult.rows[0] as Record<string, unknown>)
      : null
    const isMissing = !memoryRow
    const isDeleted = Boolean(memoryRow?.deleted_at)

    if (isMissing || isDeleted) {
      await turso.execute({
        sql: "DELETE FROM memory_embeddings WHERE memory_id = ?",
        args: [job.memoryId],
      })
      await markJobSucceeded({
        turso,
        jobId: job.id,
        nowIso,
        attempts,
      })
      await recordJobMetric({
        turso,
        nowIso,
        job,
        attempt: attempts,
        outcome: "skipped",
        durationMs: Date.now() - startedAt,
        errorCode: "MEMORY_NOT_ACTIVE",
        errorMessage: "Memory no longer exists or is deleted",
      })
      return "skipped"
    }

    const embeddingResponse = await fetchGatewayEmbedding({
      modelId: job.model,
      content: job.content,
    })
    const encoded = encodeEmbedding(embeddingResponse.embedding)
    const modelVersion = job.modelVersion ?? embeddingResponse.modelVersion

    await turso.execute({
      sql: `INSERT INTO memory_embeddings (
              memory_id, embedding, model, model_version, dimension, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(memory_id) DO UPDATE SET
              embedding = excluded.embedding,
              model = excluded.model,
              model_version = excluded.model_version,
              dimension = excluded.dimension,
              updated_at = excluded.updated_at`,
      args: [job.memoryId, encoded, job.model, modelVersion, embeddingResponse.embedding.length, nowIso, nowIso],
    })

    await markJobSucceeded({
      turso,
      jobId: job.id,
      nowIso,
      attempts,
    })
    await recordJobMetric({
      turso,
      nowIso,
      job,
      attempt: attempts,
      outcome: "success",
      durationMs: Date.now() - startedAt,
      errorCode: null,
      errorMessage: null,
    })

    return "success"
  } catch (error) {
    const embeddingError = toEmbeddingJobError(error)
    const elapsedMs = Date.now() - startedAt

    if (embeddingError.retryable && attempts < job.maxAttempts) {
      const delayMs = computeRetryDelayMs(attempts)
      const nextAttemptAt = new Date(Date.parse(nowIso) + delayMs).toISOString()
      await markJobForRetry({
        turso,
        jobId: job.id,
        attempts,
        nowIso,
        nextAttemptAt,
        errorMessage: `${embeddingError.code}: ${embeddingError.message}`,
      })
      await recordJobMetric({
        turso,
        nowIso,
        job,
        attempt: attempts,
        outcome: "retry",
        durationMs: elapsedMs,
        errorCode: embeddingError.code,
        errorMessage: embeddingError.message,
      })
      return "retry"
    }

    await markJobDeadLetter({
      turso,
      jobId: job.id,
      attempts,
      nowIso,
      reason: `${embeddingError.code}: ${embeddingError.message}`,
    })
    await recordJobMetric({
      turso,
      nowIso,
      job,
      attempt: attempts,
      outcome: "dead_letter",
      durationMs: elapsedMs,
      errorCode: embeddingError.code,
      errorMessage: embeddingError.message,
    })
    return "dead_letter"
  }
}

export async function enqueueEmbeddingJob(input: EnqueueEmbeddingJobInput): Promise<{ jobId: string } | null> {
  const memoryId = input.memoryId.trim()
  const modelId = input.modelId.trim()
  const content = input.content.trim()
  if (!memoryId || !modelId || !content) {
    return null
  }

  const nowIso = input.nowIso ?? new Date().toISOString()
  const maxAttempts = Math.max(1, input.maxAttempts ?? getSdkEmbeddingJobMaxAttempts())
  const modelVersion = typeof input.modelVersion === "string" && input.modelVersion.trim().length > 0
    ? input.modelVersion.trim()
    : null

  const newJobId = crypto.randomUUID().replace(/-/g, "")
  await input.turso.execute({
    sql: `INSERT INTO memory_embedding_jobs (
            id, memory_id, operation, model, content, model_version, status,
            attempt_count, max_attempts, next_attempt_at, claimed_by, claimed_at,
            last_error, dead_letter_reason, dead_letter_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(memory_id, model) DO UPDATE SET
            operation = excluded.operation,
            content = excluded.content,
            model_version = excluded.model_version,
            status = 'queued',
            attempt_count = 0,
            max_attempts = excluded.max_attempts,
            next_attempt_at = excluded.next_attempt_at,
            claimed_by = NULL,
            claimed_at = NULL,
            last_error = NULL,
            dead_letter_reason = NULL,
            dead_letter_at = NULL,
            updated_at = excluded.updated_at`,
    args: [
      newJobId,
      memoryId,
      input.operation,
      modelId,
      content,
      modelVersion,
      maxAttempts,
      nowIso,
      nowIso,
      nowIso,
    ],
  })

  const result = await input.turso.execute({
    sql: `SELECT id
          FROM memory_embedding_jobs
          WHERE memory_id = ? AND model = ?
          LIMIT 1`,
    args: [memoryId, modelId],
  })
  const existingId = Array.isArray(result.rows) && result.rows.length > 0
    ? String((result.rows[0] as Record<string, unknown>).id ?? newJobId)
    : newJobId

  return {
    jobId: existingId,
  }
}

export async function processDueEmbeddingJobs(input: ProcessEmbeddingJobsInput): Promise<ProcessEmbeddingJobsSummary> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const maxJobs = Math.max(1, input.maxJobs ?? getSdkEmbeddingJobWorkerBatchSize())
  const summary: ProcessEmbeddingJobsSummary = {
    processed: 0,
    success: 0,
    retries: 0,
    deadLetters: 0,
    skipped: 0,
  }

  await requeueStaleProcessingJobs(input.turso, nowIso)

  for (let index = 0; index < maxJobs; index += 1) {
    const job = await claimNextDueJob(input.turso, nowIso)
    if (!job) {
      break
    }

    const outcome = await processSingleJob(input.turso, job, nowIso)
    summary.processed += 1
    if (outcome === "success") {
      summary.success += 1
    } else if (outcome === "retry") {
      summary.retries += 1
    } else if (outcome === "dead_letter") {
      summary.deadLetters += 1
    } else if (outcome === "skipped") {
      summary.skipped += 1
    }
  }

  return summary
}

export function triggerEmbeddingQueueProcessing(
  turso: TursoClient,
  options: { maxJobs?: number } = {}
): void {
  const maxJobs = Math.max(1, options.maxJobs ?? getSdkEmbeddingJobWorkerBatchSize())
  void processDueEmbeddingJobs({ turso, maxJobs }).catch((error) => {
    console.error("Embedding queue worker failed:", error)
  })
}
