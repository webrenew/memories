---
"@memories.sh/core": minor
"@memories.sh/ai-sdk": minor
---

Add first-class SDK management APIs for keys and tenant mappings.

- `@memories.sh/core`
  - Add typed `client.management.keys` methods: `get`, `create`, `revoke`
  - Add typed `client.management.tenants` methods: `list`, `upsert`, `disable`
  - Add exported management input/output types
- `@memories.sh/ai-sdk`
  - Add `memoriesManagement()` helper plus `managementKeys()` and `managementTenants()`
  - Expose typed management interfaces for AI SDK users

This release removes the need for direct raw HTTP calls for management operations when using the SDK packages.
