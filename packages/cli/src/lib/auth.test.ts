import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiClient, type AuthConfig } from "./auth.js";

const auth: AuthConfig = {
  token: "cli_test_token",
  email: "user@example.com",
  apiUrl: "https://memories.sh",
};

const originalFetch = globalThis.fetch;

describe("getApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("adds auth and content-type headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const apiFetch = getApiClient(auth);
    const response = await apiFetch("/api/user");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://memories.sh/api/user",
      expect.any(Object)
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer cli_test_token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("retries transient status codes and eventually returns success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const apiFetch = getApiClient(auth);
    const responsePromise = apiFetch("/api/integration/health");
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws ApiTimeoutError after retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const apiFetch = getApiClient(auth);
    const responsePromise = apiFetch("/api/slow");
    const rejectionAssertion = expect(responsePromise).rejects.toMatchObject({
      name: "ApiTimeoutError",
    });
    await vi.runAllTimersAsync();
    await rejectionAssertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry when body is not replayable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const apiFetch = getApiClient(auth);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    const response = await apiFetch("/api/db/provision", {
      method: "POST",
      body: stream,
    });

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
