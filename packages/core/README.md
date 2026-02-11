# @memories.sh/core

Typed core client for the memories.sh hosted MCP API.

[![npm version](https://img.shields.io/npm/v/@memories.sh/core?color=000&labelColor=1a1a2e)](https://www.npmjs.com/package/@memories.sh/core)
[![License: Apache-2.0](https://img.shields.io/npm/l/@memories.sh/core?color=000&labelColor=1a1a2e)](https://github.com/WebRenew/memories/blob/main/LICENSE)

## Install

```bash
npm install @memories.sh/core
```

Requires Node.js >= 20.

## Quick Start

```ts
import { MemoriesClient } from "@memories.sh/core"

const client = new MemoriesClient({
  apiKey: process.env.MEMORIES_API_KEY,
  tenantId: "acme-prod",
  userId: "user_123",
})

await client.memories.add({
  content: "Acme Enterprise plan includes SSO and audit logs.",
  type: "fact",
  tags: ["pricing", "sales"],
  projectId: "dashboard",
})

const context = await client.context.get({
  query: "SSO plan details",
  projectId: "dashboard",
  userId: "user_123",
  mode: "all",
  limit: 8,
})
console.log(context.memories.map((m) => m.content))
```

`apiKey` can be passed directly or set via `MEMORIES_API_KEY`.

## Scoping Model

Use one API key and scope requests at runtime:

- `tenantId`: routes to a tenant/customer database (`tenant_id` in MCP tool args)
- `userId`: per-user memory scope inside that tenant (`user_id` in MCP tool args)
- `projectId`: optional per-project filter on read/write operations

Recommended pattern for SaaS apps:

- Set `tenantId` to workspace/org/account id
- Set `userId` to end-user id
- Keep one server-side API key for your backend

## API Surface

`MemoriesClient` exposes:

- `context.get(input?: { query?: string; userId?: string; tenantId?: string; projectId?: string; mode?: "all" | "working" | "long_term" | "rules_only"; limit?: number; includeRules?: boolean })`
- `memories.add(input)`
- `memories.search(query, options?)`
- `memories.list(options?)`
- `memories.edit(id, updates)`
- `memories.forget(id)`
- `buildSystemPrompt({ rules, memories })`

`context.get` mode behavior:

- `all` (default): `rules + working + long_term`
- `working`: `rules + working`
- `long_term`: `rules + long_term`
- `rules_only`: rules only

Legacy signature is still supported:

```ts
await client.context.get("auth patterns", { projectId: "dashboard", limit: 10 })
```

Types are exported for all inputs and outputs (`MemoryRecord`, `ContextResult`, `MutationResult`, etc.).

## Error Handling

`MemoriesClientError` includes typed metadata:

- `type` (`auth_error`, `validation_error`, `rate_limit_error`, `network_error`, ...)
- `errorCode`
- `status`
- `retryable`
- `details`

```ts
import { MemoriesClient, MemoriesClientError } from "@memories.sh/core"

const client = new MemoriesClient({ apiKey: process.env.MEMORIES_API_KEY, tenantId: "acme-prod" })

try {
  await client.memories.search("checkout issues")
} catch (error) {
  if (error instanceof MemoriesClientError) {
    console.error(error.type, error.errorCode, error.status, error.message)
  }
}
```

## Base URL

Default endpoint is `https://memories.sh/api/mcp`.

Override with `baseUrl` if needed:

```ts
new MemoriesClient({
  apiKey: process.env.MEMORIES_API_KEY,
  baseUrl: "https://your-domain.com/api/mcp",
  tenantId: "acme-prod",
})
```

## Documentation

Full docs: [memories.sh/docs](https://memories.sh/docs)

## License

[Apache 2.0](https://github.com/WebRenew/memories/blob/main/LICENSE)
