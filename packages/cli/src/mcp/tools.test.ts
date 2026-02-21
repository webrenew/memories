import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCoreTools } from "./tools.js";

describe("registerCoreTools", () => {
  it("registers reminder MCP tools", () => {
    const names: string[] = [];

    const server = {
      tool(name: string) {
        names.push(name);
      },
    } as unknown as McpServer;

    registerCoreTools(server, null);

    expect(names).toContain("add_reminder");
    expect(names).toContain("list_reminders");
    expect(names).toContain("run_due_reminders");
    expect(names).toContain("enable_reminder");
    expect(names).toContain("disable_reminder");
    expect(names).toContain("delete_reminder");
  });
});
