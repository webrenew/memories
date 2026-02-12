import { MemoriesClient, MemoriesClientError } from "@memories.sh/core"

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new MemoriesClientError(`Missing environment variable: ${name}`, {
      type: "validation_error",
      errorCode: "MISSING_ENV",
      retryable: false,
      details: { name },
    })
  }
  return value.trim()
}

function optional(value) {
  if (!value) return undefined
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function buildScope(overrides = {}) {
  return {
    tenantId: optional(overrides.tenantId) ?? optional(process.env.MEMORIES_TENANT_ID),
    userId: optional(overrides.userId) ?? optional(process.env.MEMORIES_USER_ID),
    projectId: optional(overrides.projectId) ?? optional(process.env.MEMORIES_PROJECT_ID),
  }
}

export function createMemoriesClient(overrides = {}) {
  const scope = buildScope(overrides)
  const client = new MemoriesClient({
    apiKey: required("MEMORIES_API_KEY"),
    baseUrl: optional(process.env.MEMORIES_BASE_URL) ?? "https://memories.sh",
    tenantId: scope.tenantId,
    userId: scope.userId,
  })
  return { client, scope }
}

export function toErrorPayload(error) {
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
