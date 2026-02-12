const DOMAIN_PATTERN =
  /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function normalizeOrgJoinDomain(raw: string | null | undefined): string | null {
  if (!raw) return null

  let value = raw.trim().toLowerCase()
  if (!value) return null

  value = value.replace(/^[a-z]+:\/\//, "")
  value = value.replace(/^@+/, "")

  if (value.includes("@")) {
    const parts = value.split("@")
    value = parts[parts.length - 1] ?? ""
  }

  value = value.split("/")[0] ?? value
  value = value.split("?")[0] ?? value
  value = value.split("#")[0] ?? value
  value = value.split(":")[0] ?? value
  value = value.replace(/\.+$/, "")

  if (!DOMAIN_PATTERN.test(value)) return null
  return value
}

export function getEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf("@")
  if (at === -1 || at === email.length - 1) return null
  return normalizeOrgJoinDomain(email.slice(at + 1))
}

export function getUniqueEmailDomains(emails: Array<string | null | undefined>): string[] {
  const domains = new Set<string>()
  for (const email of emails) {
    const domain = getEmailDomain(email)
    if (domain) {
      domains.add(domain)
    }
  }
  return Array.from(domains)
}
