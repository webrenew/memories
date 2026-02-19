import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Supabase modules before importing auth
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}))

import { authenticateRequest } from "../auth"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const mockCreateClient = vi.mocked(createClient)
const mockCreateAdminClient = vi.mocked(createAdminClient)

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/test", { headers })
}

describe("authenticateRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("CLI Bearer token auth", () => {
    it("should authenticate valid CLI token", async () => {
      const mockMaybeSingle = vi
        .fn()
        .mockResolvedValueOnce({
          data: { id: "user-123", email: "test@example.com" },
          error: null,
        })
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockAdmin as never)

      const request = makeRequest({ authorization: "Bearer cli_abc123" })
      const result = await authenticateRequest(request)

      expect(result).toEqual({ userId: "user-123", email: "test@example.com" })
      expect(mockAdmin.from).toHaveBeenCalledWith("users")
      expect(mockMaybeSingle).toHaveBeenCalledTimes(1)
    })

    it("should return null for invalid CLI token", async () => {
      const mockMaybeSingle = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockAdmin as never)

      const request = makeRequest({ authorization: "Bearer cli_invalid" })
      const result = await authenticateRequest(request)

      expect(result).toBeNull()
      expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
    })

    it("should fall back to legacy plaintext token when hash column is unavailable", async () => {
      const mockMaybeSingle = vi
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: { message: "column users.cli_token_hash does not exist" },
        })
        .mockResolvedValueOnce({
          data: { id: "legacy-user", email: "legacy@example.com" },
          error: null,
        })

      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockAdmin as never)

      const request = makeRequest({ authorization: "Bearer cli_legacy_token" })
      const result = await authenticateRequest(request)

      expect(result).toEqual({ userId: "legacy-user", email: "legacy@example.com" })
      expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
    })
  })

  describe("Supabase session auth", () => {
    it("should authenticate via session cookies", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-456", email: "session@example.com" } },
          }),
        },
      }
      mockCreateClient.mockResolvedValue(mockSupabase as never)

      const request = makeRequest()
      const result = await authenticateRequest(request)

      expect(result).toEqual({ userId: "user-456", email: "session@example.com" })
    })

    it("should return null when no session exists", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
          }),
        },
      }
      mockCreateClient.mockResolvedValue(mockSupabase as never)

      const request = makeRequest()
      const result = await authenticateRequest(request)

      expect(result).toBeNull()
    })

    it("should handle user with no email", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user-789", email: undefined } },
          }),
        },
      }
      mockCreateClient.mockResolvedValue(mockSupabase as never)

      const request = makeRequest()
      const result = await authenticateRequest(request)

      expect(result).toEqual({ userId: "user-789", email: "" })
    })
  })

  describe("auth method priority", () => {
    it("should prefer CLI token over session when both present", async () => {
      const mockMaybeSingle = vi
        .fn()
        .mockResolvedValueOnce({
          data: { id: "cli-user", email: "cli@example.com" },
          error: null,
        })
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        }),
      }
      mockCreateAdminClient.mockReturnValue(mockAdmin as never)

      const request = makeRequest({ authorization: "Bearer cli_token123" })
      const result = await authenticateRequest(request)

      expect(result).toEqual({ userId: "cli-user", email: "cli@example.com" })
      // Should not attempt session auth
      expect(mockCreateClient).not.toHaveBeenCalled()
    })

    it("should fall through to session for non-CLI bearer tokens", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "session-user", email: "s@example.com" } },
          }),
        },
      }
      mockCreateClient.mockResolvedValue(mockSupabase as never)

      const request = makeRequest({ authorization: "Bearer not_cli_prefix" })
      const result = await authenticateRequest(request)

      expect(result).toEqual({ userId: "session-user", email: "s@example.com" })
    })
  })
})
