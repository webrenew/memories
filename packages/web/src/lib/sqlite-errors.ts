function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "")
  }
  return ""
}

export function isMissingSqliteColumnError(error: unknown, columnName: string): boolean {
  const normalizedColumnName = columnName.trim().toLowerCase()
  if (!normalizedColumnName) return false

  const message = parseErrorMessage(error).toLowerCase()
  return message.includes("no such column") && message.includes(normalizedColumnName)
}

export function isMissingDeletedAtColumnError(error: unknown): boolean {
  return isMissingSqliteColumnError(error, "deleted_at")
}
