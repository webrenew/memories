# @memories.sh/ai-sdk

Middleware and tools for integrating memories.sh with the [AI SDK](https://ai-sdk.dev/).

[![npm version](https://img.shields.io/npm/v/@memories.sh/ai-sdk?color=000&labelColor=1a1a2e)](https://www.npmjs.com/package/@memories.sh/ai-sdk)
[![License: Apache-2.0](https://img.shields.io/npm/l/@memories.sh/ai-sdk?color=000&labelColor=1a1a2e)](https://github.com/WebRenew/memories/blob/main/LICENSE)

## Install

```bash
npm install @memories.sh/ai-sdk ai
```

Requires Node.js >= 20.

Set your API key:

```bash
export MEMORIES_API_KEY=mcp_xxx
```

## Quick Start (Middleware)

```ts
import { generateText, wrapLanguageModel } from "ai"
import { openai } from "@ai-sdk/openai"
import { memoriesMiddleware } from "@memories.sh/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: memoriesMiddleware({
    tenantId: "acme-prod",
    userId: "user_123",
  }),
})

const { text } = await generateText({
  model,
  prompt: "How should we handle auth for enterprise customers?",
})
```

The middleware automatically fetches relevant context and injects it into the system prompt.

## Tool Bundle (Agent Loops)

```ts
import { generateText, stepCountIs } from "ai"
import { openai } from "@ai-sdk/openai"
import { memoriesTools, memoriesSystemPrompt } from "@memories.sh/ai-sdk"

const { text } = await generateText({
  model: openai("gpt-4o"),
  system: memoriesSystemPrompt(),
  tools: memoriesTools({
    tenantId: "acme-prod",
    userId: "user_123",
  }),
  stopWhen: stepCountIs(5),
  prompt: "Summarize prior decisions about our billing architecture.",
})
```

`memoriesTools()` exposes:

- `getContext`
- `storeMemory`
- `searchMemories`
- `listMemories`
- `editMemory`
- `forgetMemory`

## Scoping Model

Use one API key and scope per request:

- `tenantId`: routes to tenant/customer memory database
- `userId`: optional per-user scope inside a tenant
- `projectId`: optional project/repository scope

For SaaS usage, set `tenantId` to your workspace/org/account id and `userId` to the end user id.

## Important: `tenantId` Requirement

When using `memoriesMiddleware()`, `memoriesTools()`, or other helpers without a preconfigured client, `tenantId` is required.

Alternative: pass your own `client` instance:

```ts
import { MemoriesClient } from "@memories.sh/core"
import { memoriesMiddleware } from "@memories.sh/ai-sdk"

const client = new MemoriesClient({
  apiKey: process.env.MEMORIES_API_KEY,
  tenantId: "acme-prod",
  userId: "user_123",
})

const middleware = memoriesMiddleware({ client })
```

## Other Helpers

- `createMemoriesOnFinish(options)` for controlled post-response persistence
- `preloadContext(options)` to fetch context ahead of generation
- `defaultExtractQuery(params)` default query extraction from prompt/messages

## Copy-Paste: `memoriesManagement()`

```ts
import { memoriesManagement } from "@memories.sh/ai-sdk"

const management = memoriesManagement({
  apiKey: process.env.MEMORIES_API_KEY,
  baseUrl: "https://memories.sh",
})

const keyStatus = await management.keys.get()
const rotatedKey = await management.keys.create({
  expiresAt: "2027-01-01T00:00:00.000Z",
})
const revoked = await management.keys.revoke()

const tenantMappings = await management.tenants.list()
const upsertedTenant = await management.tenants.upsert({
  tenantId: "acme-prod",
  mode: "provision",
})
const disabledTenant = await management.tenants.disable("acme-prod")

void [keyStatus, rotatedKey, revoked, tenantMappings, upsertedTenant, disabledTenant]
```

## Documentation

Full docs: [memories.sh/docs](https://memories.sh/docs)

## License

[Apache 2.0](https://github.com/WebRenew/memories/blob/main/LICENSE)
