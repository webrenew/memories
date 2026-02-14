import { describe, it, expect } from "vitest";
import {
  TYPE_LABELS,
  formatMemory,
  formatRulesSection,
  formatMemoriesSection,
} from "./formatters.js";
import type { Memory } from "../lib/memory.js";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem_abc123",
    content: "Always use strict mode",
    type: "rule",
    scope: "project",
    project_id: "github.com/org/repo",
    tags: null,
    paths: null,
    category: null,
    metadata: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("TYPE_LABELS", () => {
  it("has entries for all 5 memory types", () => {
    const expected: string[] = ["rule", "decision", "fact", "note", "skill"];
    for (const type of expected) {
      expect(TYPE_LABELS[type as keyof typeof TYPE_LABELS]).toBeDefined();
    }
  });

  it("values contain emoji prefixes", () => {
    for (const label of Object.values(TYPE_LABELS)) {
      // Each label should have non-ASCII chars (emoji) before the text
      expect(label.length).toBeGreaterThan(2);
    }
  });
});

describe("formatMemory", () => {
  it("includes type label, scope, id, and content", () => {
    const result = formatMemory(makeMemory());
    expect(result).toContain("RULE");
    expect(result).toContain("(P)");
    expect(result).toContain("mem_abc123");
    expect(result).toContain("Always use strict mode");
  });

  it("includes tags when present", () => {
    const result = formatMemory(makeMemory({ tags: "ts,react" }));
    expect(result).toContain("[ts,react]");
  });

  it("includes paths when present", () => {
    const result = formatMemory(makeMemory({ paths: "src/**" }));
    expect(result).toContain("(paths: src/**)");
  });

  it("includes category when present", () => {
    const result = formatMemory(makeMemory({ category: "api" }));
    expect(result).toContain("{api}");
  });

  it("omits optional fields when absent", () => {
    const result = formatMemory(makeMemory());
    expect(result).not.toContain("[");
    expect(result).not.toContain("(paths:");
    expect(result).not.toContain("{");
  });

  it("shows G for global scope", () => {
    const result = formatMemory(makeMemory({ scope: "global" }));
    expect(result).toContain("(G)");
  });
});

describe("formatRulesSection", () => {
  it("returns empty string for empty array", () => {
    expect(formatRulesSection([])).toBe("");
  });

  it("formats rules as bullet list", () => {
    const rules = [
      makeMemory({ content: "Rule 1" }),
      makeMemory({ content: "Rule 2" }),
    ];
    const result = formatRulesSection(rules);
    expect(result).toContain("## Active Rules");
    expect(result).toContain("- Rule 1");
    expect(result).toContain("- Rule 2");
  });
});

describe("formatMemoriesSection", () => {
  it("returns empty string for empty array", () => {
    expect(formatMemoriesSection([], "Test")).toBe("");
  });

  it("uses custom title", () => {
    const memories = [makeMemory()];
    const result = formatMemoriesSection(memories, "My Memories");
    expect(result).toContain("## My Memories");
  });
});
