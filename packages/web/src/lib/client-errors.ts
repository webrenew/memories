function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  const topString = pickString(payload)
  if (topString) {
    return topString
  }

  if (isRecord(payload)) {
    const directMessage = pickString(payload.message)
    if (directMessage) {
      return directMessage
    }

    const detailMessage = pickString(payload.detail)
    if (detailMessage) {
      return detailMessage
    }

    const directError = pickString(payload.error)
    if (directError) {
      return directError
    }

    if (isRecord(payload.error)) {
      const nestedMessage = pickString(payload.error.message)
      if (nestedMessage) {
        return nestedMessage
      }

      const nestedDetail = pickString(payload.error.detail)
      if (nestedDetail) {
        return nestedDetail
      }

      if (Array.isArray(payload.error.issues)) {
        const firstIssue = payload.error.issues[0]
        if (isRecord(firstIssue)) {
          const issueMessage = pickString(firstIssue.message)
          if (issueMessage) {
            return issueMessage
          }
        }
      }
    }
  }

  return fallback
}
