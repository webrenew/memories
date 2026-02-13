import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Must be set before any db import
process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-ingest-test-"));

import { addMemory } from "../lib/memory.js";
import { getDb } from "../lib/db.js";
import {
  parseFrontmatter,
  extractBulletPoints,
  dedupKey,
  ingestClaudeRules,
  ingestCursorRules,
  ingestSkills,
  PROJECT_SKILLS_DIRS,
} from "../lib/ingest-helpers.js";

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim();
}

async function getExistingSet(): Promise<Set<string>> {
  const db = await getDb();
  const result = await db.execute("SELECT content FROM memories WHERE deleted_at IS NULL");
  return new Set(result.rows.map((r) => normalize(String(r.content))));
}

describe("ingest dedup", () => {
  beforeAll(async () => {
    await getDb();
  });

  it("should not create duplicate memories on repeated addMemory", async () => {
    await addMemory("Always use strict TypeScript mode", { global: true, type: "rule" });

    const existingSet = await getExistingSet();

    const normalized = normalize("Always use strict TypeScript mode");
    expect(existingSet.has(normalized)).toBe(true);

    // Only add if not duplicate (simulating ingest behavior)
    const beforeSize = existingSet.size;
    if (!existingSet.has(normalized)) {
      await addMemory("Always use strict TypeScript mode", { global: true, type: "rule" });
    }

    const afterSet = await getExistingSet();
    expect(afterSet.size).toBe(beforeSize);
  });

  it("should detect duplicates with different whitespace/punctuation", async () => {
    await addMemory("Use pnpm as package manager", { global: true, type: "rule" });

    const existingSet = await getExistingSet();

    const variants = [
      "Use pnpm as package manager.",
      "Use  pnpm  as  package  manager",
      "use pnpm as package manager",
      "Use pnpm as package manager!",
    ];

    for (const v of variants) {
      expect(existingSet.has(normalize(v))).toBe(true);
    }
  });

  it("should allow genuinely new content", async () => {
    const existingSet = await getExistingSet();
    const newContent = "This is a completely unique memory for testing dedup";
    expect(existingSet.has(normalize(newContent))).toBe(false);
  });

  it("should also dedup within the same ingest batch", async () => {
    const batch = [
      "Prefer functional patterns over classes",
      "Use early returns to reduce nesting",
      "Prefer functional patterns over classes", // duplicate within batch
      "prefer functional patterns over classes.", // normalized duplicate
    ];

    const existingSet = new Set<string>();
    const imported: string[] = [];

    for (const content of batch) {
      const norm = content.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim();
      if (existingSet.has(norm)) continue;
      existingSet.add(norm);
      imported.push(content);
    }

    expect(imported).toHaveLength(2);
    expect(imported[0]).toBe("Prefer functional patterns over classes");
    expect(imported[1]).toBe("Use early returns to reduce nesting");
  });
});

describe("parseFrontmatter", () => {
  it("should parse YAML frontmatter with paths array", () => {
    const content = `---
paths:
  - "src/api/**"
  - "src/routes/**"
---

# API Rules

- Always validate request parameters before processing
- Use proper error status codes in responses`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.paths).toEqual(["src/api/**", "src/routes/**"]);
    expect(body).toContain("# API Rules");
    expect(body).toContain("Always validate request parameters");
  });

  it("should return empty frontmatter for content without delimiters", () => {
    const content = "Just plain markdown content without frontmatter";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it("should handle malformed YAML gracefully", () => {
    const content = `---
invalid: [yaml: {broken
---

Some body content here.`;

    const { frontmatter, body } = parseFrontmatter(content);
    // Should not throw, returns empty frontmatter
    expect(frontmatter).toEqual({});
    expect(body).toContain("Some body content");
  });

  it("should parse MDC-style frontmatter with globs", () => {
    const content = `---
globs: "*.ts, *.tsx"
alwaysApply: false
---

- Always use TypeScript strict mode for all new files`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.globs).toBe("*.ts, *.tsx");
    expect(frontmatter.alwaysApply).toBe(false);
    expect(body).toContain("Always use TypeScript strict mode");
  });

  it("should parse skill frontmatter with name and description", () => {
    const content = `---
name: React Patterns
description: Best practices for React component development
version: "1.0"
---

Use functional components with hooks for all new components.
Prefer composition over inheritance in component design.`;

    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("React Patterns");
    expect(frontmatter.description).toBe("Best practices for React component development");
    expect(frontmatter.version).toBe("1.0");
    expect(body).toContain("Use functional components");
  });
});

describe("extractBulletPoints", () => {
  it("should extract bullet points from markdown", () => {
    const body = `# Some Header

- This is the first bullet point item
- This is the second bullet point item
* This is an asterisk bullet item

Some short text.`;

    const items = extractBulletPoints(body);
    expect(items).toContain("This is the first bullet point item");
    expect(items).toContain("This is the second bullet point item");
    expect(items).toContain("This is an asterisk bullet item");
    // "Some short text." is too short (< 20 chars)
    expect(items).not.toContain("Some short text.");
  });

  it("should extract numbered items", () => {
    const body = `1. First numbered item in the list
2. Second numbered item in the list`;

    const items = extractBulletPoints(body);
    expect(items).toContain("First numbered item in the list");
    expect(items).toContain("Second numbered item in the list");
  });

  it("should skip headers, short lines, and blockquotes", () => {
    const body = `# Header
## Subheader
> This is a blockquote
short
- Valid bullet point that is long enough`;

    const items = extractBulletPoints(body);
    expect(items).not.toContain("Header");
    expect(items).not.toContain("Subheader");
    expect(items).not.toContain("This is a blockquote");
    expect(items).toHaveLength(1);
  });

  it("should strip HTML comments (markers)", () => {
    const body = `- Important rule that should be extracted
<!-- Generated by memories.sh at 2025-01-01 -->`;

    const items = extractBulletPoints(body);
    expect(items).toHaveLength(1);
    expect(items[0]).toBe("Important rule that should be extracted");
  });
});

describe("dedupKey", () => {
  it("should create content-only key when no paths", () => {
    const key = dedupKey("Always use TypeScript");
    expect(key).toBe("always use typescript");
  });

  it("should include paths in key when provided", () => {
    const key = dedupKey("Always use TypeScript", ["src/**"]);
    expect(key).toBe("always use typescript::src/**");
  });

  it("should sort paths for consistent keys", () => {
    const key1 = dedupKey("rule", ["b/**", "a/**"]);
    const key2 = dedupKey("rule", ["a/**", "b/**"]);
    expect(key1).toBe(key2);
  });

  it("should treat same content with different paths as different", () => {
    const key1 = dedupKey("Always validate input", ["src/api/**"]);
    const key2 = dedupKey("Always validate input", ["src/routes/**"]);
    expect(key1).not.toBe(key2);
  });

  it("should treat same content with and without paths as different", () => {
    const keyNoPaths = dedupKey("Always validate input");
    const keyWithPaths = dedupKey("Always validate input", ["src/api/**"]);
    expect(keyNoPaths).not.toBe(keyWithPaths);
  });
});

describe("PROJECT_SKILLS_DIRS", () => {
  it("includes Codex and other agent skill directories", () => {
    expect(PROJECT_SKILLS_DIRS).toContain(".codex/skills");
    expect(PROJECT_SKILLS_DIRS).toContain(".claude/skills");
    expect(PROJECT_SKILLS_DIRS).toContain(".agents/skills");
  });
});

describe("ingestClaudeRules", () => {
  it("should ingest .claude/rules/*.md files with paths frontmatter", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-claude-"));
    const rulesDir = join(tmpDir, ".claude", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(
      join(rulesDir, "api.md"),
      `---
paths:
  - "src/api/**"
  - "src/routes/**"
---

# API Rules

- Always validate request parameters before processing
- Use proper HTTP status codes for error responses`,
    );

    const existingSet = new Set<string>();
    const result = await ingestClaudeRules(tmpDir, {
      dryRun: true,
      existingSet,
    });

    // Dry run — nothing imported, but items counted as would-be imported
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    // existingSet should be populated with the items
    expect(existingSet.size).toBeGreaterThan(0);
  });

  it("should skip files with our marker", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-claude-marker-"));
    const rulesDir = join(tmpDir, ".claude", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(
      join(rulesDir, "generated.md"),
      `---
paths:
  - "src/**"
---

- Some rule that was generated by us

<!-- Generated by memories.sh at 2025-01-01 -->`,
    );

    const existingSet = new Set<string>();
    const result = await ingestClaudeRules(tmpDir, {
      dryRun: true,
      existingSet,
    });

    expect(existingSet.size).toBe(0);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("should return empty result for non-existent directory", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-claude-empty-"));
    const existingSet = new Set<string>();
    const result = await ingestClaudeRules(tmpDir, {
      dryRun: true,
      existingSet,
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should derive category from filename", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-claude-cat-"));
    const rulesDir = join(tmpDir, ".claude", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(
      join(rulesDir, "testing.md"),
      `- Always write tests for new business logic functions`,
    );

    const existingSet = new Set<string>();
    const result = await ingestClaudeRules(tmpDir, {
      existingSet,
    });

    // Check the memory was imported with correct category
    const db = await getDb();
    const memories = await db.execute("SELECT category FROM memories WHERE content LIKE '%write tests%' AND deleted_at IS NULL");
    expect(memories.rows.length).toBeGreaterThan(0);
    expect(memories.rows[0].category).toBe("testing");
  });
});

describe("ingestCursorRules", () => {
  it("should ingest .cursor/rules/*.mdc files with globs frontmatter", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-cursor-"));
    const rulesDir = join(tmpDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(
      join(rulesDir, "typescript.mdc"),
      `---
globs: "*.ts, *.tsx"
alwaysApply: false
---

- Always use strict TypeScript mode for all project files
- Avoid using the any type in TypeScript declarations`,
    );

    const existingSet = new Set<string>();
    const result = await ingestCursorRules(tmpDir, {
      dryRun: true,
      existingSet,
    });

    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(existingSet.size).toBeGreaterThan(0);
  });

  it("should handle alwaysApply: true by not setting paths", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-cursor-global-"));
    const rulesDir = join(tmpDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(
      join(rulesDir, "global.mdc"),
      `---
globs: "**/*"
alwaysApply: true
---

- Use conventional commits for all repository changes`,
    );

    const existingSet = new Set<string>();
    const result = await ingestCursorRules(tmpDir, {
      existingSet,
    });

    // Imported with no paths (global rule)
    const db = await getDb();
    const memories = await db.execute("SELECT paths FROM memories WHERE content LIKE '%conventional commits%' AND deleted_at IS NULL");
    expect(memories.rows.length).toBeGreaterThan(0);
    // paths should be null since alwaysApply is true
    expect(memories.rows[0].paths).toBeNull();
  });

  it("should skip .mdc files with our marker", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-cursor-marker-"));
    const rulesDir = join(tmpDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(
      join(rulesDir, "generated.mdc"),
      `---
globs: "*.ts"
---

- Some generated rule content that should be skipped

<!-- Generated by memories.sh -->`,
    );

    const existingSet = new Set<string>();
    const result = await ingestCursorRules(tmpDir, {
      dryRun: true,
      existingSet,
    });

    expect(existingSet.size).toBe(0);
  });
});

describe("ingestSkills", () => {
  it("should ingest SKILL.md files with frontmatter metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-skills-"));
    const skillDir = join(tmpDir, ".agents", "skills", "react-patterns");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: React Patterns
description: Best practices for React development
---

Use functional components with hooks for all new components.
Prefer composition over inheritance in component design patterns.`,
    );

    const existingSet = new Set<string>();
    const result = await ingestSkills(tmpDir, [".agents/skills"], {
      dryRun: true,
      existingSet,
    });

    expect(result.errors).toHaveLength(0);
    expect(existingSet.size).toBeGreaterThan(0);
  });

  it("should skip SKILL.md files with our marker", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-skills-marker-"));
    const skillDir = join(tmpDir, ".agents", "skills", "generated-skill");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: Generated Skill
---

Some skill content here that was auto-generated by the tool.

<!-- Generated by memories.sh -->`,
    );

    const existingSet = new Set<string>();
    const result = await ingestSkills(tmpDir, [".agents/skills"], {
      dryRun: true,
      existingSet,
    });

    expect(existingSet.size).toBe(0);
  });

  it("should use parent directory as category", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-skills-cat-"));
    const skillDir = join(tmpDir, ".agents", "skills", "typescript-guide");
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: TypeScript Guide
description: Guide for writing TypeScript code
---

Use strict mode and avoid any types in all TypeScript files.`,
    );

    const existingSet = new Set<string>();
    await ingestSkills(tmpDir, [".agents/skills"], { existingSet });

    const db = await getDb();
    const memories = await db.execute("SELECT category, type, metadata FROM memories WHERE content LIKE '%strict mode%avoid any%' AND deleted_at IS NULL");
    expect(memories.rows.length).toBeGreaterThan(0);
    expect(memories.rows[0].category).toBe("typescript-guide");
    expect(memories.rows[0].type).toBe("skill");

    // Check metadata contains frontmatter fields
    const metadata = JSON.parse(String(memories.rows[0].metadata));
    expect(metadata.name).toBe("TypeScript Guide");
    expect(metadata.description).toBe("Guide for writing TypeScript code");
  });

  it("should scan multiple skill directories", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ingest-skills-multi-"));

    // Create skills in .agents/skills/
    const agentsSkillDir = join(tmpDir, ".agents", "skills", "skill-a");
    mkdirSync(agentsSkillDir, { recursive: true });
    writeFileSync(
      join(agentsSkillDir, "SKILL.md"),
      `---
name: Skill A
---

This is skill A content that should be imported into memory.`,
    );

    // Create skills in .claude/skills/
    const claudeSkillDir = join(tmpDir, ".claude", "skills", "skill-b");
    mkdirSync(claudeSkillDir, { recursive: true });
    writeFileSync(
      join(claudeSkillDir, "SKILL.md"),
      `---
name: Skill B
---

This is skill B content that should also be imported here.`,
    );

    const existingSet = new Set<string>();
    const result = await ingestSkills(tmpDir, [".agents/skills", ".claude/skills"], {
      existingSet,
    });

    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);
  });
});

describe("path-scoped dedup", () => {
  it("should treat same content with different paths as non-duplicates", () => {
    const set = new Set<string>();

    const key1 = dedupKey("Always validate input", ["src/api/**"]);
    set.add(key1);

    const key2 = dedupKey("Always validate input", ["src/routes/**"]);
    expect(set.has(key2)).toBe(false);
  });

  it("should treat same content+paths as duplicates", () => {
    const set = new Set<string>();

    const key1 = dedupKey("Always validate input", ["src/api/**"]);
    set.add(key1);

    const key2 = dedupKey("Always validate input", ["src/api/**"]);
    expect(set.has(key2)).toBe(true);
  });
});
