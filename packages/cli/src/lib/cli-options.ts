const POSITIVE_INTEGER_RE = /^\d+$/;

export function parsePositiveIntegerOption(raw: string, optionName: string): number {
  const normalized = raw.trim();
  if (!POSITIVE_INTEGER_RE.test(normalized)) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  const value = Number.parseInt(normalized, 10);
  if (value <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return value;
}

export function parsePortOption(raw: string, optionName = "--port"): number {
  const port = parsePositiveIntegerOption(raw, optionName);
  if (port > 65535) {
    throw new Error(`${optionName} must be between 1 and 65535`);
  }
  return port;
}

export function normalizeOptionalOption(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}
