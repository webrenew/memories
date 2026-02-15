import { describe, it, expect } from "vitest";
import {
  emptyResult,
  mergeSettings,
  stripFrontmatter,
  extractPaths,
  safeRead,
} from "./tool-adapters-helpers.js";

describe("emptyResult", () => {
  it("returns object with empty arrays", () => {
    const result = emptyResult();
    expect(result.filesCreated).toEqual([]);
    expect(result.filesSkipped).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("mergeSettings", () => {
  it("merges permissions.allow arrays without duplicates", () => {
    const existing = { permissions: { allow: ["read"] } };
    const incoming = { permissions: { allow: ["read", "write"] } };
    const result = mergeSettings(existing, incoming);
    const perms = result.permissions as Record<string, unknown>;
    expect(perms.allow).toEqual(["read", "write"]);
  });

  it("preserves user keys not in base", () => {
    const existing = { myKey: "value" };
    const incoming = { otherKey: "other" };
    const result = mergeSettings(existing, incoming);
    expect(result.myKey).toBe("value");
    expect(result.otherKey).toBe("other");
  });

  it("handles empty base and update objects", () => {
    expect(mergeSettings({}, {})).toEqual({});
  });

  it("does not overwrite existing non-permission keys", () => {
    const existing = { theme: "dark" };
    const incoming = { theme: "light" };
    const result = mergeSettings(existing, incoming);
    expect(result.theme).toBe("dark");
  });
});

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter", () => {
    const content = "---\ntitle: Test\n---\n# Body";
    const result = stripFrontmatter(content);
    expect(result.frontmatter).toBe("title: Test");
    expect(result.body).toBe("# Body");
  });

  it("returns content unchanged when no frontmatter", () => {
    const content = "# Just markdown";
    const result = stripFrontmatter(content);
    expect(result.frontmatter).toBe("");
    expect(result.body).toBe("# Just markdown");
  });
});

describe("extractPaths", () => {
  it("parses paths from YAML frontmatter", () => {
    const frontmatter = 'paths:\n  - "src/**"\n  - "lib/**"';
    const result = extractPaths(frontmatter);
    expect(result).toEqual(["src/**", "lib/**"]);
  });

  it("returns empty array for no frontmatter", () => {
    expect(extractPaths("")).toEqual([]);
  });

  it("handles paths without quotes", () => {
    const frontmatter = "paths:\n  - src/api/**\n  - tests/**";
    const result = extractPaths(frontmatter);
    expect(result).toEqual(["src/api/**", "tests/**"]);
  });
});

describe("safeRead", () => {
  it("returns null for non-existent file", async () => {
    const result = await safeRead("/tmp/nonexistent-file-" + Date.now() + ".txt");
    expect(result).toBeNull();
  });
});
