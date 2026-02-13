function parseTokenMappings(raw) {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [token, tenantId, userId] = entry.split("|").map((part) => part.trim())
      if (!token || !tenantId || !userId) {
        throw new Error("Invalid APP_AUTH_TOKENS format. Expected token|tenantId|userId entries.")
      }
      return { token, tenantId, userId }
    })
}

function readTokenMappings() {
  const raw = process.env.APP_AUTH_TOKENS
  if (!raw || !raw.trim()) {
    throw new Error("Missing APP_AUTH_TOKENS. Set token|tenantId|userId entries for auth mapping.")
  }
  return parseTokenMappings(raw)
}

export function requireAuthContext(req, res, next) {
  try {
    const authHeader = req.get("authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: {
          type: "auth_error",
          code: "MISSING_AUTHORIZATION",
          message: "Missing Authorization header",
        },
      })
    }

    const token = authHeader.slice("Bearer ".length).trim()
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: {
          type: "auth_error",
          code: "MISSING_TOKEN",
          message: "Missing bearer token",
        },
      })
    }

    const mappings = readTokenMappings()
    const context = mappings.find((entry) => entry.token === token)
    if (!context) {
      return res.status(401).json({
        ok: false,
        error: {
          type: "auth_error",
          code: "INVALID_TOKEN",
          message: "Invalid token",
        },
      })
    }

    req.authContext = {
      tenantId: context.tenantId,
      userId: context.userId,
    }
    return next()
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: {
        type: "internal_error",
        code: "INVALID_AUTH_CONFIG",
        message: error instanceof Error ? error.message : "Invalid auth configuration",
      },
    })
  }
}
