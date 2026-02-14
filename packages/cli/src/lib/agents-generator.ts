import { writeFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { listMemories, type Memory, type MemoryType } from "./memory.js";
import { getProjectId } from "./git.js";
import { warn as uiWarn, error as uiError } from "./ui.js";

import { MARKER, makeFooter, hasOurMarker } from "./markers.js";

const AGENTS_DIR = ".agents";

/** Types included in instructions.md (non-path-scoped, non-note, non-skill) */
const INSTRUCTION_TYPES: MemoryType[] = ["rule", "decision", "fact"];

const HARNESS_HEADER = [
  "# Agent Harness",
  "",
  "- Use this as the baseline memory layer for the project.",
  "- Before coding, recall current context from the local memories store via MCP (`get_context`) or CLI (`memories recall`).",
  "- Memories are local-first: project + global records come from your local DB; cloud sync mirrors that state.",
  "- When rules conflict, prefer path-scoped rules, then project rules, then global rules.",
  "",
  "## Runtime Checklist",
  "",
  "- Start tasks with a context recall (`memories recall --json`).",
  "- Persist important decisions with `memories add` or MCP `add_memory`.",
  "- Edit source memories instead of hand-editing generated integration files.",
].join("\n");

// ── Result Types ─────────────────────────────────────────────────────

interface GenerateResult {
  filesCreated: string[];
  filesCleaned: string[];
  counts: {
    instructions: number;
    rules: number;
    skills: number;
    settings: boolean;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

// makeFooter imported from markers.ts

/**
 * Parse the comma-separated `paths` field from a memory into an array.
 */
function parsePaths(paths: string | null): string[] {
  if (!paths) return [];
  return paths.split(",").map((p) => p.trim()).filter(Boolean);
}

/**
 * Parse the JSON `metadata` field from a memory.
 * Returns an empty object on parse failure.
 */
function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Derive a filename from a memory's first path segment.
 * e.g. "src/api/**" → "src-api", falling back to "general".
 */
function filenameFromPath(paths: string[]): string {
  if (paths.length === 0) return "general";
  const first = paths[0];
  // Take up to two segments, strip globs
  const segments = first
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .split("/")
    .filter(Boolean)
    .slice(0, 2);
  return segments.length > 0 ? segments.join("-") : "general";
}

// hasOurMarker imported from markers.ts

// ── Fetch ────────────────────────────────────────────────────────────

/**
 * Fetch all memories relevant for .agents/ generation.
 * Includes rule, decision, fact, and skill types.
 */
async function fetchAllMemories(): Promise<Memory[]> {
  const projectId = getProjectId() ?? undefined;
  return listMemories({
    limit: 10000,
    types: [...INSTRUCTION_TYPES, "skill"],
    projectId,
  });
}

// ── 3a: instructions.md ──────────────────────────────────────────────

/**
 * Generate `.agents/instructions.md` from non-path-scoped rule/decision/fact memories.
 * Path-scoped memories are excluded (they go to rules/*.md instead).
 */
async function generateInstructions(
  memories: Memory[],
  outputDir: string,
): Promise<string[]> {
  // Filter: instruction types only, exclude path-scoped
  const filtered = memories.filter(
    (m) => INSTRUCTION_TYPES.includes(m.type) && !m.paths,
  );

  // Group by type
  const groups: Record<string, Memory[]> = {};
  for (const m of filtered) {
    const title =
      m.type === "rule" ? "Rules" :
      m.type === "decision" ? "Key Decisions" :
      "Project Facts";
    (groups[title] ??= []).push(m);
  }

  // Stable order
  const order = ["Rules", "Key Decisions", "Project Facts"];
  const memorySections = order
    .filter((t) => groups[t]?.length)
    .map((title) => {
      const items = groups[title].map((m) => `- ${m.content}`).join("\n");
      return `## ${title}\n\n${items}`;
    });
  const contentParts: string[] = [HARNESS_HEADER, "", "## Stored Memories", ""];
  if (memorySections.length > 0) {
    contentParts.push(memorySections.join("\n\n"));
  } else {
    contentParts.push('- No stored memories yet. Add one with `memories add --rule "..."`.');
  }

  const content = contentParts.join("\n") + makeFooter();

  const outPath = join(outputDir, AGENTS_DIR, "instructions.md");
  await mkdir(join(outputDir, AGENTS_DIR), { recursive: true });
  await writeFile(outPath, content, "utf-8");

  return [outPath];
}

// ── 3b: rules/*.md ──────────────────────────────────────────────────

/**
 * Generate `.agents/rules/*.md` files from path-scoped memories.
 * Groups by category, cleans stale files that have our marker.
 */
async function generateRules(
  memories: Memory[],
  outputDir: string,
): Promise<{ created: string[]; cleaned: string[] }> {
  // Filter: only memories with paths set
  const filtered = memories.filter((m) => {
    const paths = parsePaths(m.paths);
    return paths.length > 0;
  });

  const rulesDir = join(outputDir, AGENTS_DIR, "rules");
  await mkdir(rulesDir, { recursive: true });

  // Group by category (or derived filename)
  const groups = new Map<string, { paths: Set<string>; items: string[] }>();

  for (const m of filtered) {
    const paths = parsePaths(m.paths);
    const key = m.category || filenameFromPath(paths);

    if (!groups.has(key)) {
      groups.set(key, { paths: new Set(), items: [] });
    }
    const group = groups.get(key)!;
    for (const p of paths) group.paths.add(p);
    group.items.push(`- ${m.content}`);
  }

  // Determine which files we'll write
  const filesToWrite = new Set<string>();
  const created: string[] = [];

  for (const [key, group] of groups) {
    const filename = `${key}.md`;
    filesToWrite.add(filename);

    const pathsArray = [...group.paths];
    const frontmatter = [
      "---",
      "paths:",
      ...pathsArray.map((p) => `  - "${p}"`),
      "---",
    ].join("\n");

    const title = `# ${key.charAt(0).toUpperCase() + key.slice(1)} Rules`;
    const body = group.items.join("\n");
    const content = `${frontmatter}\n\n${title}\n\n${body}${makeFooter()}`;

    const outPath = join(rulesDir, filename);
    await writeFile(outPath, content, "utf-8");
    created.push(outPath);
  }

  // Clean stale files: remove .md files with our marker that we didn't regenerate
  const cleaned: string[] = [];
  try {
    const existing = await readdir(rulesDir);
    for (const file of existing) {
      if (!file.endsWith(".md")) continue;
      if (filesToWrite.has(file)) continue;

      const filePath = join(rulesDir, file);
      if (await hasOurMarker(filePath)) {
        await unlink(filePath);
        cleaned.push(filePath);
      }
    }
  } catch {
    // Directory may not exist yet on first run — that's fine
  }

  return { created, cleaned };
}

// ── 3c: skills/**/SKILL.md ──────────────────────────────────────────

/**
 * Generate `.agents/skills/{category}/SKILL.md` from skill-type memories.
 * Warns about skills without a category (they're skipped).
 * Cleans up stale skill directories that no longer have a matching memory.
 */
async function generateSkills(
  memories: Memory[],
  outputDir: string,
): Promise<string[]> {
  const allSkills = memories.filter((m) => m.type === "skill");
  const skipped = allSkills.filter((m) => !m.category);
  const filtered = allSkills.filter((m) => m.category);

  // Warn about skills missing category
  for (const m of skipped) {
    uiWarn(`Skipping skill memory ${m.id} — missing category (set with: memories edit ${m.id} --category <name>)`);
  }

  const created: string[] = [];
  const activeCategories = new Set<string>();

  for (const m of filtered) {
    const category = m.category!;
    activeCategories.add(category);
    const meta = parseMetadata(m.metadata);
 
    // Fallback to category when name is missing or empty string
    const name = typeof meta.name === "string" && meta.name ? meta.name : category;
    const description = typeof meta.description === "string" ? meta.description : "";

    const frontmatter = [
      "---",
      `name: ${name}`,
      ...(description ? [`description: ${description}`] : []),
      "---",
    ].join("\n");

    const content = `${frontmatter}\n\n${m.content}${makeFooter()}`;

    const skillDir = join(outputDir, AGENTS_DIR, "skills", category);
    await mkdir(skillDir, { recursive: true });

    const outPath = join(skillDir, "SKILL.md");
    await writeFile(outPath, content, "utf-8");
    created.push(outPath);
  }

  // Clean up stale skill directories
  const skillsRoot = join(outputDir, AGENTS_DIR, "skills");
  if (existsSync(skillsRoot)) {
    try {
      const dirs = await readdir(skillsRoot, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        if (activeCategories.has(d.name)) continue;

        // Only remove if the SKILL.md has our marker (don't touch user files)
        const skillPath = join(skillsRoot, d.name, "SKILL.md");
        if (existsSync(skillPath)) {
          const fileContent = await readFile(skillPath, "utf-8");
          if (fileContent.includes(MARKER)) {
            await unlink(skillPath);
            // Try removing the now-empty directory
            try {
              const { rmdir } = await import("node:fs/promises");
              await rmdir(join(skillsRoot, d.name));
            } catch {
              // Directory not empty or other issue — leave it
            }
          }
        }
      }
    } catch (error) {
      uiError("Failed to clean stale skills: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  }

  return created;
}

// ── 3d: settings.json ───────────────────────────────────────────────

/**
 * Generate `.agents/settings.json` stub if it doesn't already exist.
 * Does NOT overwrite — this file is user-managed.
 */
async function generateSettings(
  outputDir: string,
): Promise<string | null> {
  const outPath = join(outputDir, AGENTS_DIR, "settings.json");

  if (existsSync(outPath)) return null;

  await mkdir(join(outputDir, AGENTS_DIR), { recursive: true });

  const defaultSettings = {
    permissions: {
      allow: [] as string[],
      deny: [] as string[],
    },
    hooks: {},
    env: {},
  };

  await writeFile(outPath, JSON.stringify(defaultSettings, null, 2) + "\n", "utf-8");
  return outPath;
}

// ── Orchestrator ─────────────────────────────────────────────────────

/**
 * Generate the full `.agents/` directory from the memory store.
 * Calls all sub-generators, catches and logs errors for each individually.
 */
export async function generateAgentsDir(
  outputDir: string,
): Promise<GenerateResult> {
  const result: GenerateResult = {
    filesCreated: [],
    filesCleaned: [],
    counts: { instructions: 0, rules: 0, skills: 0, settings: false },
  };

  let memories: Memory[];
  try {
    memories = await fetchAllMemories();
  } catch (error) {
    uiError("Failed to fetch memories: " + (error instanceof Error ? error.message : "Unknown error"));
    return result;
  }

  // 3a: instructions.md
  try {
    const created = await generateInstructions(memories, outputDir);
    result.filesCreated.push(...created);
    result.counts.instructions = memories.filter(
      (m) => INSTRUCTION_TYPES.includes(m.type) && !m.paths,
    ).length;
  } catch (error) {
    uiError("Failed to generate instructions.md: " + (error instanceof Error ? error.message : "Unknown error"));
  }

  // 3b: rules/*.md
  try {
    const { created, cleaned } = await generateRules(memories, outputDir);
    result.filesCreated.push(...created);
    result.filesCleaned.push(...cleaned);
    result.counts.rules = created.length;
  } catch (error) {
    uiError("Failed to generate rules: " + (error instanceof Error ? error.message : "Unknown error"));
  }

  // 3c: skills/**/SKILL.md
  try {
    const created = await generateSkills(memories, outputDir);
    result.filesCreated.push(...created);
    result.counts.skills = created.length;
  } catch (error) {
    uiError("Failed to generate skills: " + (error instanceof Error ? error.message : "Unknown error"));
  }

  // 3d: settings.json
  try {
    const created = await generateSettings(outputDir);
    if (created) {
      result.filesCreated.push(created);
      result.counts.settings = true;
    }
  } catch (error) {
    uiError("Failed to generate settings.json: " + (error instanceof Error ? error.message : "Unknown error"));
  }

  return result;
}
