# @memories.sh/ai-sdk

## 0.2.0

### Minor Changes

- fa54f10: Add tenant-scoped SDK support for hosted MCP routing.

  - `@memories.sh/core`
    - Add `tenantId` option on `MemoriesClient` and include `tenant_id` in tool calls.
    - Keep `userId` support for per-user scope within a tenant.
    - Improve typed error handling and stable response envelope handling.
  - `@memories.sh/ai-sdk`
    - Require `tenantId` when constructing internal clients (unless a preconfigured `client` is passed).
    - Pass tenant/user scope through middleware and tools wrappers.
  - Docs
    - Add package READMEs for `@memories.sh/core` and `@memories.sh/ai-sdk`.

### Patch Changes

- Updated dependencies [fa54f10]
  - @memories.sh/core@0.2.0
