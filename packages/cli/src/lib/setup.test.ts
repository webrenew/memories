import { describe, it, expect } from "vitest";
import { toolSupportsMcp, toolSupportsGeneration, parseConfigFile } from "./setup.js";
import type { Tool } from "./setup-tools.js";

const cursorTool: Tool = {
  name: "Cursor",
  detectPaths: [".cursor"],
  mcpConfigPath: ".cursor/mcp.json",
  mcpConfigFormat: "cursor",
  generateCmd: "cursor",
};

const copilotTool: Tool = {
  name: "GitHub Copilot",
  detectPaths: [".github/copilot-instructions.md"],
  instructionFile: ".github/copilot-instructions.md",
  generateCmd: "copilot",
};

const noGenTool: Tool = {
  name: "Test Tool",
  detectPaths: [".test"],
};

describe("toolSupportsMcp", () => {
  it("returns true for tool with mcpConfigPath and mcpConfigFormat", () => {
    expect(toolSupportsMcp(cursorTool)).toBe(true);
  });

  it("returns false for tool without mcpConfigPath", () => {
    expect(toolSupportsMcp(copilotTool)).toBe(false);
  });
});

describe("toolSupportsGeneration", () => {
  it("returns true for tool with generateCmd", () => {
    expect(toolSupportsGeneration(cursorTool)).toBe(true);
  });

  it("returns false for tool without generateCmd", () => {
    expect(toolSupportsGeneration(noGenTool)).toBe(false);
  });
});

describe("parseConfigFile", () => {
  it("parses valid JSON", () => {
    const result = parseConfigFile('{"mcpServers": {}}');
    expect(result.mcpServers).toEqual({});
  });

  it("parses JSONC with comments", () => {
    const jsonc = `{
      // This is a comment
      "mcpServers": {}
    }`;
    const result = parseConfigFile(jsonc);
    expect(result.mcpServers).toEqual({});
  });

  it("handles block comments", () => {
    const jsonc = `{
      /* block comment */
      "servers": {"test": {}}
    }`;
    const result = parseConfigFile(jsonc);
    expect(result.servers).toBeDefined();
  });
});
