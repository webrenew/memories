---
name: memories-sdk
description: "Build against the memories.sh SDK packages in application code. Use when working with `@memories.sh/core` or `@memories.sh/ai-sdk`, including: (1) Initializing `MemoriesClient`, (2) Reading, writing, searching, or editing memories from backend code, route handlers, workers, or scripts, (3) Integrating memories with the Vercel AI SDK via `memoriesMiddleware`, `memoriesTools`, `preloadContext`, or `createMemoriesOnFinish`, (4) Choosing and applying `tenantId` / `userId` / `projectId` scoping, (5) Managing SDK skill files or management APIs, or (6) Debugging memories SDK usage in TypeScript or JavaScript applications. Use `memories-cli` for CLI workflows, `memories-mcp` for MCP setup, and `memories-dev` for monorepo internals."
---

# memories-sdk

Use the SDK packages when an application needs memories.sh programmatically. Prefer `@memories.sh/core` for direct typed API access and `@memories.sh/ai-sdk` only when the caller already uses the Vercel AI SDK.

## Workflow

1. Pick the integration surface:
   - Use `@memories.sh/core` for backend routes, workers, cron jobs, and non-AI-SDK agents.
   - Use `@memories.sh/ai-sdk` for `generateText`, `streamText`, middleware, or tool loops built on `ai`.
   - If the task is about the CLI or MCP configuration, switch to `memories-cli` or `memories-mcp`.
2. Set scope before writing code:
   - Keep `MEMORIES_API_KEY` server-side.
   - `tenantId` selects the tenant or workspace database.
   - `userId` narrows memory to a user inside that tenant.
   - `projectId` narrows reads and writes to a product area, repo, or feature slice.
3. Use the narrowest pattern that solves the task:
   - Direct CRUD or context lookup: `MemoriesClient`
   - Automatic prompt injection: `memoriesMiddleware`
   - Agent loops with explicit memory tools: `memoriesTools` and `memoriesSystemPrompt`
   - Fetch once and reuse: `preloadContext`
   - Persist after completion: `createMemoriesOnFinish`
4. Verify the integration:
   - Confirm the same scope is used on both reads and writes.
   - Catch `MemoriesClientError`.
   - Do not expose the API key to browser-only code.

## Quick Start

### `@memories.sh/core`

```ts
import { MemoriesClient } from "@memories.sh/core"

const client = new MemoriesClient({
  apiKey: process.env.MEMORIES_API_KEY,
  tenantId: "acme-prod",
  userId: "user_123",
})

const context = await client.context.get({
  query: "billing architecture",
  projectId: "dashboard",
  mode: "all",
  strategy: "hybrid",
  limit: 8,
})

await client.memories.add({
  content: "Enterprise billing uses Stripe invoices.",
  type: "fact",
  projectId: "dashboard",
  tags: ["billing"],
})
```

### `@memories.sh/ai-sdk`

```ts
import { generateText, stepCountIs, wrapLanguageModel } from "ai"
import { openai } from "@ai-sdk/openai"
import {
  memoriesMiddleware,
  memoriesSystemPrompt,
  memoriesTools,
} from "@memories.sh/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: memoriesMiddleware({
    tenantId: "acme-prod",
    userId: "user_123",
    projectId: "dashboard",
  }),
})

const result = await generateText({
  model,
  system: memoriesSystemPrompt(),
  tools: memoriesTools({
    tenantId: "acme-prod",
    userId: "user_123",
    projectId: "dashboard",
  }),
  stopWhen: stepCountIs(5),
  prompt: "Summarize prior decisions about billing.",
})

console.log(result.text)
```

## Decision Guide

- Need direct typed access from your own backend code: use `MemoriesClient`
- Need automatic context injection into prompts or messages: use `memoriesMiddleware`
- Need the model to read or write memory explicitly through tools: use `memoriesTools`
- Need to manage stored skill files or procedure fragments: use `client.skills.*` or the AI SDK skill-file tools
- Need tenant, key, or embedding usage administration: use `client.management.*`
- Need internals of the memories monorepo or server endpoints: use `memories-dev`

## Reference Files

- `references/core.md`: direct client methods, transport choices, errors, management APIs, and skill-file APIs
- `references/ai-sdk.md`: middleware, tools, preload, post-finish persistence, and query extraction patterns
- `references/scoping.md`: tenant/user/project scoping rules, server-side safety, and debugging checklist
