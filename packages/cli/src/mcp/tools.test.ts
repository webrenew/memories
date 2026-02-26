import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoreTools } from "./tools.js";

describe("registerCoreTools", () => {
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

    expect(schemas.get("get_context")).toHaveProperty("mode");
    expect(schemas.get("get_context")).toHaveProperty("session_id");
    expect(schemas.get("get_context")).toHaveProperty("budget_tokens");
    expect(schemas.get("add_memory")).toHaveProperty("layer");
    expect(schemas.get("start_session")).toHaveProperty("project_id");
    expect(schemas.get("checkpoint_session")).toHaveProperty("session_id");
    expect(schemas.get("checkpoint_session")).toHaveProperty("kind");
    expect(schemas.get("end_session")).toHaveProperty("status");
    expect(schemas.get("snapshot_session")).toHaveProperty("source_trigger");
    expect(schemas.get("snapshot_session")).toHaveProperty("transcript_md");

    // Backward + forward compatibility for core SDK client and existing callers.
    expect(schemas.get("search_memories")).toHaveProperty("type");
    expect(schemas.get("search_memories")).toHaveProperty("types");
    expect(schemas.get("search_memories")).toHaveProperty("layer");

    expect(schemas.get("list_memories")).toHaveProperty("type");
    expect(schemas.get("list_memories")).toHaveProperty("types");
    expect(schemas.get("list_memories")).toHaveProperty("layer");
    expect(schemas.get("list_memories")).toHaveProperty("tags");
  });
});
