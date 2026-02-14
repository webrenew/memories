import type { MemoriesErrorData } from "./types"

export class MemoriesClientError extends Error {
  readonly status?: number
  readonly code?: number
  readonly data?: unknown
  readonly type?: MemoriesErrorData["type"]
  readonly errorCode?: string
  readonly retryable?: boolean
  readonly details?: unknown

  constructor(
    message: string,
    options?: {
      status?: number
      code?: number
      data?: unknown
      type?: MemoriesErrorData["type"]
      errorCode?: string
      retryable?: boolean
      details?: unknown
    }
  ) {
    super(message)
    this.name = "MemoriesClientError"
    this.status = options?.status
    this.code = options?.code
    this.type = options?.type
    this.errorCode = options?.errorCode
    this.retryable = options?.retryable
    this.details = options?.details
    this.data = options?.data ?? options?.details
  }
}
