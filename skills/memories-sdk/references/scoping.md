# Scoping and Safety

Read this file when the task involves multi-tenant design, auth boundaries, or debugging empty or incorrect memory results.

## Scope Mapping

Use stable identifiers:
- `tenantId`: workspace, organization, account, or customer database
- `userId`: end user inside that tenant
- `projectId`: feature area, repo, assistant, or product surface

Good mappings:
- SaaS app: `tenantId = workspace.id`, `userId = currentUser.id`, `projectId = "support-agent"`
- Internal copilots: `tenantId = company slug`, `userId = employee id`, `projectId = repo slug`
- Single-project automation: `tenantId = org`, `projectId = job name`, omit `userId` if memory is shared

Bad mappings:
- Random per-request IDs
- Human-readable values that change frequently
- Mixing different `projectId` values between writes and reads for the same feature

## Server-Side Rules

- Keep `MEMORIES_API_KEY` on the server
- Do not instantiate `MemoriesClient` in browser-only components
- If the frontend needs memory-backed actions, call your own backend route or server action
- Centralize scope construction so reads and writes stay aligned

## Empty Context Checklist

If `context.get()` returns little or no useful data, check:

1. Wrong scope:
   - `tenantId`, `userId`, or `projectId` differs from the values used when the memory was stored
2. Wrong retrieval mode:
   - `rules_only` returns no non-rule memories
3. Wrong strategy:
   - try `hybrid` before assuming the memory is missing
4. Wrong environment:
   - `baseUrl` points at a different deployment than the one where data was written
5. No durable data yet:
   - confirm the application actually persisted memories

## Common Debugging Pattern

When behavior is unclear, reduce the integration to a minimal round trip:

```ts
const client = new MemoriesClient({
  apiKey: process.env.MEMORIES_API_KEY,
  tenantId: "acme-prod",
  userId: "user_123",
})

await client.memories.add({
  content: "Round-trip test memory",
  type: "note",
  projectId: "debug",
})

const result = await client.context.get({
  query: "Round-trip test memory",
  projectId: "debug",
  strategy: "hybrid",
})
```

If this works, the bug is usually in scope construction or the surrounding app flow, not the SDK itself.

## Choosing `projectId`

Use `projectId` when:
- the same tenant has multiple assistants or products
- you want one feature to ignore another feature's memory
- the user explicitly wants repo- or feature-scoped memory

Skip `projectId` when:
- memory should be shared across the entire tenant
- the user expects a single global memory space per tenant

## Transport Notes

- Default to `sdk_http`
- Use `mcp` only for integrations that specifically rely on MCP transport behavior
- If you override `baseUrl`, make sure it matches the deployment that owns the target tenant data
