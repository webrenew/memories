import { describe, expect, it } from "vitest"
import { getEmailDomain, getUniqueEmailDomains, normalizeOrgJoinDomain } from "../org-domain"

describe("normalizeOrgJoinDomain", () => {
  it("normalizes plain domains", () => {
    expect(normalizeOrgJoinDomain(" WebRenew.io ")).toBe("webrenew.io")
  })

  it("normalizes URLs and @ prefixes", () => {
    expect(normalizeOrgJoinDomain("https://@team.webrenew.io/path")).toBe("team.webrenew.io")
  })

  it("rejects invalid domains", () => {
    expect(normalizeOrgJoinDomain("not_a_domain")).toBeNull()
    expect(normalizeOrgJoinDomain("localhost")).toBeNull()
  })
})

describe("getEmailDomain", () => {
  it("extracts and normalizes domain from email", () => {
    expect(getEmailDomain("Alice@WebRenew.io")).toBe("webrenew.io")
  })
})

describe("getUniqueEmailDomains", () => {
  it("returns unique normalized domains", () => {
    expect(
      getUniqueEmailDomains([
        "a@webrenew.io",
        "b@WEBRENEW.io",
        "c@team.webrenew.io",
        null,
      ]),
    ).toEqual(["webrenew.io", "team.webrenew.io"])
  })
})
