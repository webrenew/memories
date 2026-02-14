import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH_DIR = join(homedir(), ".config", "memories");
const AUTH_FILE = join(AUTH_DIR, "auth.json");
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 250;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export interface AuthConfig {
  token: string;
  email: string;
  apiUrl: string;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  return (
    typeof error === "object"
    && error !== null
    && "name" in error
    && String((error as { name?: unknown }).name) === "AbortError"
  );
}

function isRetryableNetworkError(error: unknown): boolean {
  return isAbortError(error) || error instanceof TypeError;
}

function isReplayableBody(body: RequestInit["body"] | undefined): boolean {
  if (body == null) return true;
  if (typeof body === "string") return true;
  if (body instanceof URLSearchParams) return true;
  if (body instanceof FormData) return true;
  if (body instanceof Blob) return true;
  if (body instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(body)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestSignal(sourceSignal: AbortSignal | null | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => {
    controller.abort(sourceSignal?.reason);
  };

  if (sourceSignal) {
    if (sourceSignal.aborted) {
      onAbort();
    } else {
      sourceSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (sourceSignal) {
        sourceSignal.removeEventListener("abort", onAbort);
      }
    },
    didTimeout: () => timedOut,
  };
}

export async function readAuth(): Promise<AuthConfig | null> {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    const raw = await readFile(AUTH_FILE, "utf-8");
    return JSON.parse(raw) as AuthConfig;
  } catch {
    return null;
  }
}

export async function saveAuth(data: AuthConfig): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function clearAuth(): Promise<void> {
  if (existsSync(AUTH_FILE)) {
    await unlink(AUTH_FILE);
  }
}

/**
 * Creates a fetch wrapper that includes CLI auth headers.
 */
export function getApiClient(auth: AuthConfig): (path: string, opts?: RequestInit) => Promise<Response> {
  return async function apiFetch(
    path: string,
    opts?: RequestInit
  ): Promise<Response> {
    const url = `${auth.apiUrl}${path}`;
    const method = (opts?.method ?? "GET").toUpperCase();
    const retryBudget = isReplayableBody(opts?.body) ? MAX_RETRIES : 0;

    for (let attempt = 0; attempt <= retryBudget; attempt += 1) {
      const requestSignal = createRequestSignal(opts?.signal, REQUEST_TIMEOUT_MS);
      try {
        const headers = new Headers(opts?.headers);
        headers.set("Authorization", `Bearer ${auth.token}`);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }

        const response = await fetch(url, {
          ...opts,
          headers,
          signal: requestSignal.signal,
        });

        const shouldRetryResponse =
          attempt < retryBudget
          && RETRYABLE_STATUS_CODES.has(response.status);
        if (!shouldRetryResponse) {
          return response;
        }
      } catch (error) {
        if (opts?.signal?.aborted) {
          throw error;
        }

        const shouldRetryError =
          attempt < retryBudget
          && (requestSignal.didTimeout() || isRetryableNetworkError(error));
        if (!shouldRetryError) {
          if (requestSignal.didTimeout()) {
            const timeoutError = new Error(
              `Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`
            );
            timeoutError.name = "ApiTimeoutError";
            throw timeoutError;
          }
          throw error;
        }
      } finally {
        requestSignal.cleanup();
      }

      await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
    }

    throw new Error(`Unreachable API request state for ${method} ${path}`);
  };
}
