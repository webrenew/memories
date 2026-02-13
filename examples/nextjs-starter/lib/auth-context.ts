export interface AuthContext {
  tenantId: string
  userId: string
}

export class AuthContextError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, options: { status: number; code: string }) {
    super(message)
    this.name = "AuthContextError"
    this.status = options.status
    this.code = options.code
  }
}

interface TokenEntry extends AuthContext {
  token: string
}

function parseTokenEntries(raw: string): TokenEntry[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [token, tenantId, userId] = entry.split("|").map((part) => part.trim())
      if (!token || !tenantId || !userId) {
        throw new AuthContextError(
          "Invalid APP_AUTH_TOKENS format. Expected token|tenantId|userId entries.",
          { status: 500, code: "INVALID_AUTH_CONFIG" }
        )
      }
      return { token, tenantId, userId }
    })
}

function readTokenEntries(): TokenEntry[] {
  const raw = process.env.APP_AUTH_TOKENS
  if (!raw || !raw.trim()) {
    throw new AuthContextError(
      "Missing APP_AUTH_TOKENS. Set token|tenantId|userId entries for server-side auth mapping.",
      { status: 500, code: "MISSING_AUTH_CONFIG" }
    )
  }
  return parseTokenEntries(raw)
}

export async function requireAuthContext(request: Request): Promise<AuthContext> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthContextError("Missing Authorization header", {
      status: 401,
      code: "MISSING_AUTHORIZATION",
    })
  }

  const token = authHeader.slice("Bearer ".length).trim()
  if (!token) {
    throw new AuthContextError("Missing bearer token", {
      status: 401,
      code: "MISSING_TOKEN",
    })
  }

  const tokenEntries = readTokenEntries()
  const matched = tokenEntries.find((entry) => entry.token === token)
  if (!matched) {
    throw new AuthContextError("Invalid token", {
      status: 401,
      code: "INVALID_TOKEN",
    })
  }

  return {
    tenantId: matched.tenantId,
    userId: matched.userId,
  }
}
