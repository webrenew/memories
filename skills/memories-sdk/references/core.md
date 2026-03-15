# `@memories.sh/core`

Read this file when the task is about direct SDK usage from backend code, route handlers, workers, scripts, or tests.

## Install

```bash
npm install @memories.sh/core
```

Requires Node.js >= 20.

## Client Construction

```ts
import { MemoriesClient } from "@memories.sh/core"

const client = new MemoriesClient({
  apiKey: process.env.MEMORIES_API_KEY,
  baseUrl: "https://memories.sh", // optional
  tenantId: "acme-prod",
  userId: "user_123",
  transport: "sdk_http", // optional; auto-detected by default
})
```

`apiKey` can be omitted if `MEMORIES_API_KEY` is set.

Default transport is `auto`:
- `sdk_http` is the normal choice and calls `/api/sdk/v1/*`
- `mcp` uses JSON-RPC against `/api/mcp`

Only force `mcp` when the integration explicitly needs MCP transport semantics.

## Core Methods

### Context

Use `client.context.get()` when you need rules, memories, conflicts, skill files, or compaction/session hints in one response.

```ts
const context = await client.context.get({
  query: "enterprise auth",
  tenantId: "acme-prod",
  userId: "user_123",
  projectId: "dashboard",
  mode: "all",
  strategy: "hybrid",
  limit: 10,
  includeRules: true,
  includeSkillFiles: true,
  graphDepth: 1,
  graphLimit: 6,
})
```

Important options:
- `mode`: `all`, `working`, `long_term`, `rules_only`
- `strategy`: `lexical`, `semantic`, `hybrid`
- `graphDepth` / `graphLimit`: only use when relationship expansion matters
- `sessionId`, `budgetTokens`, `turnCount`, `turnBudget`, `lastActivityAt`, `inactivityThresholdMinutes`: use for lifecycle-aware callers

### Memory CRUD

```ts
await client.memories.add({
  content: "SSO is enterprise-only.",
  type: "fact",
  tags: ["auth", "pricing"],
  category: "sales",
  projectId: "dashboard",
})

const matches = await client.memories.search("SSO", {
  strategy: "hybrid",
  projectId: "dashboard",
  limit: 5,
})

const items = await client.memories.list({
  type: "fact",
  tags: "auth,pricing",
  projectId: "dashboard",
})

await client.memories.edit("mem_123", {
  content: "SSO and SCIM are enterprise-only.",
})

await client.memories.forget("mem_123")
```

Also available:
- `client.memories.bulkForget(filters, { dryRun })`
- `client.memories.vacuum()`

### Skill Files

Use skill-file APIs when the app stores reusable procedure files or generated skill fragments in memories.

```ts
await client.skills.upsertFile({
  path: "sales/objection-handling.md",
  content: "# Objection Handling\n...",
  procedureKey: "sales-objection-handling",
  tenantId: "acme-prod",
})

const files = await client.skills.listFiles({
  tenantId: "acme-prod",
  query: "sales",
  limit: 20,
})

await client.skills.deleteFile({
  path: "sales/objection-handling.md",
  tenantId: "acme-prod",
})
```

Also available:
- `client.skills.promoteFromSession(...)`

### Management APIs

Use management methods only for tenant administration or account-level operations:
- `client.management.keys.get()`
- `client.management.keys.create({ expiresAt })`
- `client.management.keys.revoke()`
- `client.management.tenants.list()`
- `client.management.tenants.upsert(input)`
- `client.management.tenants.disable(tenantId)`
- `client.management.embeddings.list(options)`
- `client.management.embeddings.usage(options)`

## Error Handling

Catch `MemoriesClientError` and branch on typed metadata:

```ts
import { MemoriesClientError } from "@memories.sh/core"

try {
  await client.memories.search("checkout failure")
} catch (error) {
  if (error instanceof MemoriesClientError) {
    console.error(error.type, error.errorCode, error.status, error.retryable)
  }
  throw error
}
```

Typical causes:
- `auth_error`: missing or invalid API key
- `validation_error`: invalid input or missing required fields
- `rate_limit_error`: backoff and retry
- `network_error`: transport or connectivity issue

## Good Defaults

- Use `strategy: "hybrid"` unless the user explicitly wants lexical-only behavior
- Use stable IDs for `tenantId`, `userId`, and `projectId`
- Keep the SDK on the server side
- Reuse a single `MemoriesClient` per request or worker context instead of recreating it in inner loops
