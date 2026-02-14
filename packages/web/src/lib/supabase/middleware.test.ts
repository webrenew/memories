import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockGetUser = vi.fn()

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

import { updateSession } from "./middleware"

describe("updateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("redirects unauthenticated /app requests to /login with encoded next path", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    })

    const request = new NextRequest("https://example.com/app/upgrade?plan=pro&source=cli")
    const response = await updateSession(request)

    expect(response.headers.get("location")).toBe(
      "https://example.com/login?next=%2Fapp%2Fupgrade%3Fplan%3Dpro%26source%3Dcli"
    )
  })
})
