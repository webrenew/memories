import { MemoriesClient, MemoriesClientError } from "@memories.sh/core"

export interface ScopeOverrides {
  tenantId?: string
  userId?: string
  projectId?: string
}

export interface ApiErrorShape {
  status: number
  body: {
    ok: false
    error: {
      type: string
      code: string
      message: string
      status?: number
      retryable?: boolean
      details?: unknown
    }
  }
}

function readEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new MemoriesClientError(`Missing required environment variable: ${name}`, {
      type: "validation_error",
      errorCode: "MISSING_ENV",
      retryable: false,
      details: { name },
    })
  }
  return value.trim()
}

function optional(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function buildScope(overrides: ScopeOverrides = {}): ScopeOverrides {
  return {
    tenantId: optional(overrides.tenantId) ?? optional(process.env.MEMORIES_TENANT_ID),
    userId: optional(overrides.userId) ?? optional(process.env.MEMORIES_USER_ID),
    projectId: optional(overrides.projectId) ?? optional(process.env.MEMORIES_PROJECT_ID),
  }
}

export function createMemoriesClient(overrides: ScopeOverrides = {}): {
  client: MemoriesClient
  scope: ScopeOverrides
} {
  const scope = buildScope(overrides)
  const client = new MemoriesClient({
    apiKey: readEnv("MEMORIES_API_KEY"),
    baseUrl: optional(process.env.MEMORIES_BASE_URL) ?? "https://memories.sh",
    tenantId: scope.tenantId,
    userId: scope.userId,
  })

  return { client, scope }
}

export function toApiError(error: unknown): ApiErrorShape {
  if (error instanceof MemoriesClientError) {
    return {
      status: error.status ?? 400,
      body: {
        ok: false,
        error: {
          type: error.type ?? "client_error",
          code: error.errorCode ?? "CLIENT_ERROR",
          message: error.message,
          status: error.status,
          retryable: error.retryable,
          details: error.details,
        },
      },
    }
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        type: "internal_error",
        code: "UNEXPECTED_ERROR",
        message: error instanceof Error ? error.message : "Unexpected error",
      },
    },
  }
}
