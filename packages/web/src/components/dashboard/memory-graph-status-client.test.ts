import { afterEach, describe, expect, it, vi } from "vitest"
import type { GraphStatusPayload } from "@/lib/memory-service/graph/status"
import { fetchGraphStatusPayload, parseGraphStatusResponse } from "./memory-graph-status-client"

function buildStatusFixture(): GraphStatusPayload {
  return {
    sampledAt: "2026-02-21T00:00:00.000Z",
  } as unknown as GraphStatusPayload
}

describe("memory-graph-status-client", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns parsed status on successful payload", () => {
    const status = buildStatusFixture()
    expect(parseGraphStatusResponse(true, 200, { status })).toEqual({
      status,
      error: null,
    })
  })

  it("returns fallback error when successful payload is missing status", () => {
    expect(parseGraphStatusResponse(true, 200, {})).toEqual({
      status: null,
      error: "Graph status response was invalid.",
    })
  })

  it("maps http failures to a user-facing message", () => {
    expect(parseGraphStatusResponse(false, 503, { error: "Service unavailable" })).toEqual({
      status: null,
      error: "Service unavailable",
    })
  })

  it("fetches and parses graph status payload", async () => {
    const status = buildStatusFixture()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchGraphStatusPayload()

    expect(fetchMock).toHaveBeenCalledWith("/api/graph/rollout", {
      method: "GET",
      cache: "no-store",
      signal: undefined,
    })
    expect(result).toEqual({
      status,
      error: null,
    })
  })
})
