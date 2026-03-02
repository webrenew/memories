import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockCheckRateLimit, mockGetClientIp, mockReadFile } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockGetClientIp: vi.fn(),
  mockReadFile: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  publicRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}))

vi.mock("fs/promises", () => ({
  readFile: mockReadFile,
}))

import { GET } from "./route"

function makeRequest(pathAndQuery: string): NextRequest {
  return new NextRequest(`https://example.com/api/docs/raw${pathAndQuery}`)
}

describe("/api/docs/raw GET", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockGetClientIp.mockReturnValue("203.0.113.10")
  })

  it("returns 400 for invalid traversal-style path values", async () => {
    const response = await GET(makeRequest("?path=../secrets"))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid path parameter" })
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("reads and returns markdown for valid docs paths", async () => {
    mockReadFile.mockResolvedValue("# Docs")

    const response = await GET(makeRequest("?path=sdk/client"))
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=86400")
    await expect(response.text()).resolves.toBe("# Docs")

    const readPath = String(mockReadFile.mock.calls[0]?.[0] ?? "")
    expect(readPath).toMatch(/content[\\/]+docs[\\/]+sdk[\\/]+client\.mdx$/)
  })

  it("returns 404 only when the markdown file is missing", async () => {
    const notFoundError = Object.assign(new Error("missing"), { code: "ENOENT" })
    mockReadFile.mockRejectedValue(notFoundError)

    const response = await GET(makeRequest("?path=sdk/missing-doc"))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "File not found" })
  })

  it("returns 500 for filesystem errors other than missing files", async () => {
    const permissionError = Object.assign(new Error("permission denied"), { code: "EACCES" })
    mockReadFile.mockRejectedValue(permissionError)

    const response = await GET(makeRequest("?path=sdk/client"))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Failed to load document" })
  })
})
