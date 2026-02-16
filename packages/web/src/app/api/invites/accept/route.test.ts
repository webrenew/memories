import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetUser,
  mockFrom,
  mockCheckRateLimit,
  mockAddTeamSeat,
  mockLogOrgAuditEvent,
  mockHasServiceRoleKey,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAddTeamSeat: vi.fn(),
  mockLogOrgAuditEvent: vi.fn(),
  mockHasServiceRoleKey: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn() },
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock("@/lib/stripe/teams", () => ({
  addTeamSeat: mockAddTeamSeat,
}))

vi.mock("@/lib/org-audit", () => ({
  logOrgAuditEvent: mockLogOrgAuditEvent,
}))

vi.mock("@/lib/env", () => ({
  hasServiceRoleKey: mockHasServiceRoleKey,
}))

import { POST } from "./route"

describe("/api/invites/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue(null)
    mockHasServiceRoleKey.mockReturnValue(false)
    mockAddTeamSeat.mockResolvedValue({ action: "updated" })
    mockLogOrgAuditEvent.mockResolvedValue(undefined)
  })

  it("returns 500 with stable error when member insert fails", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "member@example.com",
          identities: [],
        },
      },
    })

    const invite = {
      id: "invite-1",
      org_id: "org-1",
      invited_by: "owner-1",
      email: "member@example.com",
      role: "member",
      organization: {
        id: "org-1",
        name: "Acme",
        slug: "acme",
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === "org_invites") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                gt: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: invite,
                    error: null,
                  }),
                }),
              }),
            }),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ error: null }),
            }),
          })),
        }
      }

      if (table === "org_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          })),
          insert: vi.fn().mockResolvedValue({
            error: {
              message: "duplicate key value violates unique constraint",
            },
          }),
        }
      }

      return {
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      }
    })

    const response = await POST(
      new Request("https://example.com/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "invite-token-1",
          billing: "monthly",
        }),
      }),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to accept invite",
    })
    expect(mockLogOrgAuditEvent).not.toHaveBeenCalled()
  })
})
