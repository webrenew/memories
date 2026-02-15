import { describe, it, expect } from "vitest";
import { TOOLS, getAllTools, MEMORIES_MCP_CONFIG, MEMORIES_MCP_CONFIG_OPENCODE } from "./setup-tools.js";

describe("TOOLS", () => {
  it("has 19 entries", () => {
    expect(TOOLS.length).toBe(19);
  });

  it("each tool has name and detectPaths defined", () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(Array.isArray(tool.detectPaths)).toBe(true);
    }
  });

  it("known tools exist: Cursor, Claude Code, VS Code", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("Cursor");
    expect(names).toContain("Claude Code");
    expect(names).toContain("VS Code");
  });

  it("at least one tool has mcpConfigFormat defined", () => {
    const withFormat = TOOLS.filter((t) => t.mcpConfigFormat);
    expect(withFormat.length).toBeGreaterThan(0);
  });
});

describe("getAllTools", () => {
  it("returns a copy of the TOOLS array", () => {
    const result = getAllTools();
    expect(result).toEqual(TOOLS);
    expect(result).not.toBe(TOOLS); // different reference
  });
});

describe("MEMORIES_MCP_CONFIG", () => {
  it("has command and args", () => {
    expect(MEMORIES_MCP_CONFIG.command).toBe("npx");
    expect(MEMORIES_MCP_CONFIG.args).toContain("serve");
  });
});

describe("MEMORIES_MCP_CONFIG_OPENCODE", () => {
  it("has type local and command array", () => {
    expect(MEMORIES_MCP_CONFIG_OPENCODE.type).toBe("local");
    expect(Array.isArray(MEMORIES_MCP_CONFIG_OPENCODE.command)).toBe(true);
  });
});
