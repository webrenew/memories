import { describe, expect, it, vi } from "vitest"
import { createMemoriesOnFinish } from "../on-finish"

describe("createMemoriesOnFinish", () => {
  it("returns early in tool-calls-only mode", async () => {
    const client = {
      memories: {
        add: vi.fn(),
      },
    }

    const onFinish = createMemoriesOnFinish({
      client: client as unknown as any,
      mode: "tool-calls-only",
      projectId: "github.com/acme/platform",
      extractMemories: () => [{ content: "Should not store" }],
    })

    await onFinish({ output: "done" })

    expect(client.memories.add).not.toHaveBeenCalled()
  })

  it("stores extracted memories with inherited project scope", async () => {
    const client = {
      memories: {
        add: vi.fn().mockResolvedValue({ ok: true, message: "stored", raw: "stored" }),
      },
    }

    const onFinish = createMemoriesOnFinish({
      client: client as unknown as any,
      mode: "auto-extract",
      projectId: "github.com/acme/platform",
      extractMemories: () => [
        { content: "Enterprise billing uses Stripe invoices.", type: "fact" as const },
      ],
    })

    await onFinish({ output: "done" })

    expect(client.memories.add).toHaveBeenCalledWith({
      content: "Enterprise billing uses Stripe invoices.",
      type: "fact",
      projectId: "github.com/acme/platform",
    })
  })

  it("returns early when extractMemories yields no memories", async () => {
    const client = {
      memories: {
        add: vi.fn(),
      },
    }

    const onFinish = createMemoriesOnFinish({
      client: client as unknown as any,
      mode: "auto-extract",
      projectId: "github.com/acme/platform",
      extractMemories: () => [],
    })

    await onFinish({ output: "done" })

    expect(client.memories.add).not.toHaveBeenCalled()
  })

  it("returns early when no extractMemories is provided", async () => {
    const client = {
      memories: {
        add: vi.fn(),
      },
    }

    const onFinish = createMemoriesOnFinish({
      client: client as unknown as any,
      mode: "auto-extract",
      projectId: "github.com/acme/platform",
    })

    await onFinish({ output: "done" })

    expect(client.memories.add).not.toHaveBeenCalled()
  })

  it("preserves a per-memory projectId over the options-level scope", async () => {
    const client = {
      memories: {
        add: vi.fn().mockResolvedValue({ ok: true, message: "stored", raw: "stored" }),
      },
    }

    const onFinish = createMemoriesOnFinish({
      client: client as unknown as any,
      mode: "auto-extract",
      projectId: "github.com/acme/platform",
      extractMemories: () => [
        { content: "Tenant override note.", projectId: "github.com/acme/tenant-override" },
      ],
    })

    await onFinish({ output: "done" })

    expect(client.memories.add).toHaveBeenCalledWith({
      content: "Tenant override note.",
      projectId: "github.com/acme/tenant-override",
    })
  })
})
