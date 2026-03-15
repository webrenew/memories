# `@memories.sh/ai-sdk`

Read this file when the task is about Vercel AI SDK integration.

## Install

```bash
npm install @memories.sh/ai-sdk ai
```

Requires Node.js >= 20.

If you do not pass a preconfigured `client`, the helper options need a valid `tenantId`.

## Pattern Selection

- Use `memoriesMiddleware()` when you want automatic prompt enrichment before generation.
- Use `memoriesTools()` when you want the model to call memory tools explicitly during an agent loop.
- Use both only when that behavior is intentional. Middleware injects context up front; tools let the model fetch or mutate memory later.
- Use `preloadContext()` when multiple helpers in the same request should share one fetched context.
- Use `createMemoriesOnFinish()` only when you have an explicit policy for what should be persisted after completion.

## Middleware

```ts
import { wrapLanguageModel } from "ai"
import { openai } from "@ai-sdk/openai"
import { memoriesMiddleware } from "@memories.sh/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: memoriesMiddleware({
    tenantId: "acme-prod",
    userId: "user_123",
    projectId: "dashboard",
    limit: 8,
    includeRules: true,
    mode: "all",
    strategy: "hybrid",
  }),
})
```

Behavior:
- Extracts a query from `prompt` or the latest user message
- Calls `client.context.get(...)`
- Builds a memory block with rules, memories, and skill files
- Prepends that block to the `system` prompt

Customize query extraction with `extractQuery`, or use the built-in `defaultExtractQuery`.

## Tools

```ts
import { generateText, stepCountIs } from "ai"
import { openai } from "@ai-sdk/openai"
import { memoriesSystemPrompt, memoriesTools } from "@memories.sh/ai-sdk"

const result = await generateText({
  model: openai("gpt-4o"),
  system: memoriesSystemPrompt({
    persona: "support assistant",
  }),
  tools: memoriesTools({
    tenantId: "acme-prod",
    userId: "user_123",
    projectId: "dashboard",
  }),
  stopWhen: stepCountIs(5),
  prompt: "Find prior billing decisions and store any new durable facts.",
})
```

Tool bundle methods:
- `getContext`
- `storeMemory`
- `searchMemories`
- `listMemories`
- `forgetMemory`
- `editMemory`
- `upsertSkillFile`
- `listSkillFiles`
- `deleteSkillFile`
- `bulkForgetMemories`
- `vacuumMemories`

Use the individual tool factories when you only want a subset of tools.

## Preload Context

Use `preloadContext()` when you want to fetch memory once and pass it into middleware:

```ts
import { preloadContext, memoriesMiddleware } from "@memories.sh/ai-sdk"

const preloaded = await preloadContext({
  tenantId: "acme-prod",
  userId: "user_123",
  projectId: "dashboard",
  query: "enterprise auth",
})

const middleware = memoriesMiddleware({
  tenantId: "acme-prod",
  userId: "user_123",
  projectId: "dashboard",
  preloaded,
})
```

## Post-Response Persistence

`createMemoriesOnFinish()` is intentionally conservative:
- Default mode is `tool-calls-only`, which does nothing by itself
- To persist extracted memories automatically, set `mode: "auto-extract"` and provide `extractMemories`

```ts
import { createMemoriesOnFinish } from "@memories.sh/ai-sdk"

const onFinish = createMemoriesOnFinish({
  tenantId: "acme-prod",
  projectId: "dashboard",
  mode: "auto-extract",
  extractMemories(payload) {
    const summary = typeof payload === "object" && payload !== null ? payload : null
    if (!summary) return []
    return [
      {
        content: "Customer wants invoice net terms on enterprise plan.",
        type: "fact",
        tags: ["billing", "sales"],
      },
    ]
  },
})
```

Do not invent automatic extraction rules. If the user has not defined a persistence policy, prefer explicit tool calls.

## Using a Preconfigured Client

Pass your own `MemoriesClient` when you already centralize auth, base URL, or scope construction:

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

This is the cleanest way to keep app-specific scope logic in one place.
