import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoreTools } from "./tools.js";

const memoryMocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  getRules: vi.fn(),
  listMemories: vi.fn(),
  searchMemories: vi.fn(),
}));

vi.mock("../lib/memory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/memory.js")>()),
  ...memoryMocks,
}));

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function captureCoreToolHandlers(projectId: string | null): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool(
      name: string,
      _description?: string,
      _schema?: Record<string, unknown>,
      handler?: ToolHandler,
    ) {
      if (handler) {
        handlers.set(name, handler);
      }
    },
  } as unknown as McpServer;

  registerCoreTools(server, projectId);
  return handlers;
}

function lastProjectId(
  mock: { mock: { calls: unknown[][] } },
  optionsArgumentIndex: number,
): string | undefined {
  const lastCall = mock.mock.calls[mock.mock.calls.length - 1];
  const options = lastCall?.[optionsArgumentIndex] as { projectId?: string } | undefined;
  return options?.projectId;
}

describe("registerCoreTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMocks.getContext.mockResolvedValue({ rules: [], memories: [] });
    memoryMocks.getRules.mockResolvedValue([]);
    memoryMocks.listMemories.mockResolvedValue([]);
    memoryMocks.searchMemories.mockResolvedValue([]);
  });

  it("registers reminder MCP tools", () => {
    const names: string[] = [];
    const schemas = new Map<string, Record<string, unknown>>();

    const server = {
      tool(name: string, _description?: string, schema?: Record<string, unknown>) {
        names.push(name);
        if (schema) {
          schemas.set(name, schema);
        }
      },
    } as unknown as McpServer;

    registerCoreTools(server, null);

    expect(names).toContain("add_reminder");
    expect(names).toContain("list_reminders");
    expect(names).toContain("run_due_reminders");
    expect(names).toContain("enable_reminder");
    expect(names).toContain("disable_reminder");
    expect(names).toContain("delete_reminder");
    expect(names).toContain("start_session");
    expect(names).toContain("checkpoint_session");
    expect(names).toContain("end_session");
    expect(names).toContain("snapshot_session");
    expect(names).toContain("consolidate_memories");

    expect(schemas.get("get_context")).toHaveProperty("mode");
    expect(schemas.get("get_context")).toHaveProperty("session_id");
    expect(schemas.get("get_context")).toHaveProperty("budget_tokens");
    expect(schemas.get("get_context")).toHaveProperty("turn_count");
    expect(schemas.get("get_context")).toHaveProperty("turn_budget");
    expect(schemas.get("get_context")).toHaveProperty("last_activity_at");
    expect(schemas.get("get_context")).toHaveProperty("inactivity_threshold_minutes");
    expect(schemas.get("get_context")).toHaveProperty("task_completed");
    expect(schemas.get("get_context")).toHaveProperty("project_id");
    expect(schemas.get("add_memory")).toHaveProperty("layer");
    expect(schemas.get("start_session")).toHaveProperty("project_id");
    expect(schemas.get("checkpoint_session")).toHaveProperty("session_id");
    expect(schemas.get("checkpoint_session")).toHaveProperty("kind");
    expect(schemas.get("end_session")).toHaveProperty("status");
    expect(schemas.get("snapshot_session")).toHaveProperty("source_trigger");
    expect(schemas.get("snapshot_session")).toHaveProperty("transcript_md");
    expect(schemas.get("consolidate_memories")).toHaveProperty("types");
    expect(schemas.get("consolidate_memories")).toHaveProperty("dry_run");
    expect(schemas.get("consolidate_memories")).toHaveProperty("project_id");

    // Backward + forward compatibility for core SDK client and existing callers.
    expect(schemas.get("search_memories")).toHaveProperty("type");
    expect(schemas.get("search_memories")).toHaveProperty("types");
    expect(schemas.get("search_memories")).toHaveProperty("layer");
    expect(schemas.get("search_memories")).toHaveProperty("project_id");

    expect(schemas.get("get_rules")).toHaveProperty("project_id");
    expect(schemas.get("list_memories")).toHaveProperty("type");
    expect(schemas.get("list_memories")).toHaveProperty("types");
    expect(schemas.get("list_memories")).toHaveProperty("layer");
    expect(schemas.get("list_memories")).toHaveProperty("tags");
    expect(schemas.get("list_memories")).toHaveProperty("project_id");
  });

  it("uses an explicit read scope and falls back to the startup project", async () => {
    const startupProjectId = "github.com/webrenew/startup-project";
    const explicitProjectId = "github.com/webrenew/explicit-project";
    const handlers = captureCoreToolHandlers(startupProjectId);
    const readTools = [
      {
        name: "get_context",
        args: { query: "scope probe" },
        mock: memoryMocks.getContext,
        optionsArgumentIndex: 1,
      },
      {
        name: "search_memories",
        args: { query: "scope probe" },
        mock: memoryMocks.searchMemories,
        optionsArgumentIndex: 1,
      },
      {
        name: "get_rules",
        args: {},
        mock: memoryMocks.getRules,
        optionsArgumentIndex: 0,
      },
      {
        name: "list_memories",
        args: {},
        mock: memoryMocks.listMemories,
        optionsArgumentIndex: 0,
      },
    ];

    for (const { name, args, mock, optionsArgumentIndex } of readTools) {
      const handler = handlers.get(name);
      expect(handler, `${name} handler`).toBeDefined();

      await handler!({ ...args, project_id: `  ${explicitProjectId}  ` });
      expect(lastProjectId(mock, optionsArgumentIndex), `${name} explicit scope`).toBe(explicitProjectId);

      mock.mockClear();
      await handler!(args);
      expect(lastProjectId(mock, optionsArgumentIndex), `${name} omitted scope`).toBe(startupProjectId);

      mock.mockClear();
      await handler!({ ...args, project_id: "   " });
      expect(lastProjectId(mock, optionsArgumentIndex), `${name} blank scope`).toBe(startupProjectId);
    }
  });
});
