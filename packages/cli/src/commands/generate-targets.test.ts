import { describe, it, expect } from "vitest";
import { TARGETS, TRACK_BY_DEFAULT } from "./generate-targets.js";

describe("TARGETS", () => {
  it("has 9 entries", () => {
    expect(TARGETS.length).toBe(9);
  });

  it("each target has name, defaultPath, description, and format", () => {
    for (const target of TARGETS) {
      expect(target.name).toBeTruthy();
      expect(target.defaultPath).toBeTruthy();
      expect(target.description).toBeTruthy();
      expect(typeof target.format).toBe("function");
    }
  });

  it("includes cursor, claude, and factory targets", () => {
    const names = TARGETS.map((t) => t.name);
    expect(names).toContain("cursor");
    expect(names).toContain("claude");
    expect(names).toContain("factory");
  });

  it("each format function returns a string", () => {
    for (const target of TARGETS) {
      const result = target.format([]);
      expect(typeof result).toBe("string");
    }
  });
});

describe("TRACK_BY_DEFAULT", () => {
  it("contains CLAUDE.md, .agents/, and Factory instructions", () => {
    expect(TRACK_BY_DEFAULT.has("CLAUDE.md")).toBe(true);
    expect(TRACK_BY_DEFAULT.has(".agents/")).toBe(true);
    expect(TRACK_BY_DEFAULT.has(".factory/instructions.md")).toBe(true);
  });
});
