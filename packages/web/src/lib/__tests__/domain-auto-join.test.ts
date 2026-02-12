import { describe, expect, it } from "vitest"
import { extractUserEmails } from "../domain-auto-join"

describe("extractUserEmails", () => {
  it("includes primary and linked identity emails once", () => {
    const emails = extractUserEmails({
      email: "Charles@WebRenew.io",
      identities: [
        { identity_data: { email: "charles@webrenew.io" } },
        { identity_data: { email: "team@webrenew.io" } },
      ],
    })

    expect(emails).toEqual(["charles@webrenew.io", "team@webrenew.io"])
  })
})
