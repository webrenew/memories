function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

export function extractErrorMessage(payload: unknown, fallback: string): string {
  const topString = pickString(payload)
  if (topString) {
    return topString
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>

    const directMessage = pickString(record.message)
    if (directMessage) {
      return directMessage
    }

    const detailMessage = pickString(record.detail)
    if (detailMessage) {
      return detailMessage
    }

    const directError = pickString(record.error)
    if (directError) {
      return directError
    }

    if (record.error && typeof record.error === "object") {
      const errorObject = record.error as Record<string, unknown>
      const nestedMessage = pickString(errorObject.message)
      if (nestedMessage) {
        return nestedMessage
      }

      const nestedDetail = pickString(errorObject.detail)
      if (nestedDetail) {
        return nestedDetail
      }

      if (Array.isArray(errorObject.issues)) {
        const firstIssue = errorObject.issues[0]
        if (firstIssue && typeof firstIssue === "object") {
          const issueMessage = pickString((firstIssue as Record<string, unknown>).message)
          if (issueMessage) {
            return issueMessage
          }
        }
      }
    }
  }

  return fallback
}

