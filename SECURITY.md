# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in memories.sh, please report it responsibly.

**Do NOT open a public issue.**

Instead, email **security@memories.sh** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

This policy covers:

- The `@memories.sh/cli` npm package
- The memories.sh web application and API
- The MCP server endpoint

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| Older   | No        |

## Security Practices

- All data is stored locally by default (SQLite via libSQL)
- Cloud sync is opt-in and requires authentication
- API keys are prefixed (`cli_`, `mcp_`) and never logged
- Rate limiting is enforced on all API endpoints
- Input validation via Zod on all API routes
- Security headers (X-Frame-Options, X-Content-Type-Options, etc.) on all responses

## Acknowledgments

We appreciate responsible disclosure and will credit reporters (with permission) in release notes.
