import { writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import chalk from "chalk";
import { MARKER, makeFooter, hasOurMarker } from "./markers.js";

// ── Types ────────────────────────────────────────────────────────────

export interface AdaptResult {
  filesCreated: string[];
  filesSkipped: string[];
  errors: string[];
}

interface FlatFileOptions {
  header?: string;
  maxLength?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function emptyResult(): AdaptResult {
  return { filesCreated: [], filesSkipped: [], errors: [] };
}

/**
 * Read a file and return its content, or null if missing/error.
 */
async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * List .md files in a directory. Returns empty array if directory doesn't exist.
 */
async function listMdFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath);
    return entries.filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

/**
 * List subdirectories containing SKILL.md files.
 */
async function listSkillDirs(skillsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = join(skillsDir, entry.name, "SKILL.md");
        if (existsSync(skillFile)) {
          dirs.push(entry.name);
        }
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Write a file only if it's new or contains our marker. Returns true if written.
 */
async function safeWrite(
  filePath: string,
  content: string,
  result: AdaptResult,
  force = false,
): Promise<boolean> {
  if (existsSync(filePath) && !force) {
    const ours = await hasOurMarker(filePath);
    if (!ours) {
      result.filesSkipped.push(filePath);
      return false;
    }
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  result.filesCreated.push(filePath);
  return true;
}

/**
 * Deep-merge settings.json: merge allow/deny arrays, preserve user keys.
 */
function mergeSettings(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing };

  for (const [key, val] of Object.entries(incoming)) {
    if (key === "permissions" && typeof val === "object" && val !== null) {
      const existPerms = (merged.permissions ?? {}) as Record<string, unknown>;
      const incomingPerms = val as Record<string, unknown>;

      const mergedPerms = { ...existPerms };
      for (const pKey of ["allow", "deny"] as const) {
        const existArr = Array.isArray(existPerms[pKey]) ? (existPerms[pKey] as string[]) : [];
        const incomingArr = Array.isArray(incomingPerms[pKey]) ? (incomingPerms[pKey] as string[]) : [];
        mergedPerms[pKey] = [...new Set([...existArr, ...incomingArr])];
      }
      // Keep other permission keys from incoming
      for (const [pk, pv] of Object.entries(incomingPerms)) {
        if (pk !== "allow" && pk !== "deny" && !(pk in mergedPerms)) {
          mergedPerms[pk] = pv;
        }
      }
      merged.permissions = mergedPerms;
    } else if (!(key in merged)) {
      merged[key] = val;
    }
  }

  return merged;
}

/**
 * Strip YAML frontmatter from markdown content.
 * Returns { frontmatter, body } where frontmatter is the raw YAML (without ---).
 */
function stripFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: content };
  return { frontmatter: match[1], body: match[2] };
}

/**
 * Extract `paths:` array values from YAML frontmatter string.
 */
function extractPaths(frontmatter: string): string[] {
  const paths: string[] = [];
  const lines = frontmatter.split("\n");
  let inPaths = false;

  for (const line of lines) {
    if (line.startsWith("paths:")) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const match = line.match(/^\s+-\s+"?(.+?)"?\s*$/);
      if (match) {
        paths.push(match[1]);
      } else {
        inPaths = false;
      }
    }
  }

  return paths;
}

// ── 4a: Claude Code Adapter ─────────────────────────────────────────

/**
 * Adapt `.agents/` directory to Claude Code configuration.
 *
 * - `instructions.md` → `CLAUDE.md` with header and marker
 * - `rules/*.md` → `.claude/rules/*.md` (copied with marker)
 * - `skills/**​/SKILL.md` → `.claude/skills/**​/SKILL.md` (copied)
 * - `settings.json` → `.claude/settings.json` (merged)
 */
export async function adaptForClaude(
  agentsDir: string,
  outputDir: string,
): Promise<AdaptResult> {
  const result = emptyResult();

  // 1. instructions.md → CLAUDE.md
  try {
    const instructions = await safeRead(join(agentsDir, "instructions.md"));
    if (instructions) {
      const content = `# Project Memories\n\n${instructions}${makeFooter()}`;
      await safeWrite(join(outputDir, "CLAUDE.md"), content, result);
    }
  } catch (error) {
    result.errors.push(`instructions.md: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // 2. rules/*.md → .claude/rules/*.md
  try {
    const ruleFiles = await listMdFiles(join(agentsDir, "rules"));
    for (const file of ruleFiles) {
      const content = await safeRead(join(agentsDir, "rules", file));
      if (!content) continue;

      // Ensure marker is present
      const out = content.includes(MARKER) ? content : content + makeFooter();
      await safeWrite(join(outputDir, ".claude", "rules", file), out, result);
    }
  } catch (error) {
    result.errors.push(`rules: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // 3. skills/**/SKILL.md → .claude/skills/**/SKILL.md
  try {
    const skillDirs = await listSkillDirs(join(agentsDir, "skills"));
    for (const dir of skillDirs) {
      const content = await safeRead(join(agentsDir, "skills", dir, "SKILL.md"));
      if (!content) continue;

      const out = content.includes(MARKER) ? content : content + makeFooter();
      await safeWrite(join(outputDir, ".claude", "skills", dir, "SKILL.md"), out, result);
    }
  } catch (error) {
    result.errors.push(`skills: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // 4. settings.json → .claude/settings.json (merge)
  try {
    const incomingRaw = await safeRead(join(agentsDir, "settings.json"));
    if (incomingRaw) {
      const incoming = JSON.parse(incomingRaw) as Record<string, unknown>;
      const existingPath = join(outputDir, ".claude", "settings.json");
      const existingRaw = await safeRead(existingPath);

      if (existingRaw) {
        const existing = JSON.parse(existingRaw) as Record<string, unknown>;
        const merged = mergeSettings(existing, incoming);
        await mkdir(join(outputDir, ".claude"), { recursive: true });
        await writeFile(existingPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
        result.filesCreated.push(existingPath);
      } else {
        await safeWrite(existingPath, JSON.stringify(incoming, null, 2) + "\n", result, true);
      }
    }
  } catch (error) {
    result.errors.push(`settings.json: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  return result;
}

// ── 4b: Cursor Adapter ──────────────────────────────────────────────

/**
 * Adapt `.agents/` directory to Cursor configuration.
 *
 * - `instructions.md` → `.cursor/rules/memories.mdc` with MDC frontmatter
 * - `rules/*.md` → `.cursor/rules/{name}.mdc` with paths→globs translation
 * - `skills/**​/SKILL.md` → `.cursor/skills/**​/SKILL.md` (copied)
 */
export async function adaptForCursor(
  agentsDir: string,
  outputDir: string,
): Promise<AdaptResult> {
  const result = emptyResult();

  // 1. instructions.md → .cursor/rules/memories.mdc
  try {
    const instructions = await safeRead(join(agentsDir, "instructions.md"));
    if (instructions) {
      // Strip existing marker from source before wrapping
      const body = instructions.replace(/\n<!-- Generated by memories\.sh at .+? -->/, "");
      const frontmatter = [
        "---",
        "description: Project memories and rules from memories.sh",
        "globs:",
        "alwaysApply: true",
        "---",
      ].join("\n");
      const content = `${frontmatter}\n\n# Project Memories\n\n${body.trim()}${makeFooter()}`;
      await safeWrite(join(outputDir, ".cursor", "rules", "memories.mdc"), content, result);
    }
  } catch (error) {
    result.errors.push(`instructions.md: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // 2. rules/*.md → .cursor/rules/{name}.mdc
  try {
    const ruleFiles = await listMdFiles(join(agentsDir, "rules"));
    for (const file of ruleFiles) {
      const content = await safeRead(join(agentsDir, "rules", file));
      if (!content) continue;

      const { frontmatter, body } = stripFrontmatter(content);
      const paths = extractPaths(frontmatter);

      // Build MDC frontmatter with globs
      const globs = paths.length > 0 ? paths.join(",") : "";
      const description = paths.length > 0
        ? `Rules for ${paths.join(", ")}`
        : `Rules from ${file}`;

      const mdcFrontmatter = [
        "---",
        `description: ${description}`,
        ...(globs ? [`globs: ${globs}`] : ["globs:"]),
        `alwaysApply: ${paths.length === 0}`,
        "---",
      ].join("\n");

      // Strip existing marker from body
      const cleanBody = body.replace(/\n<!-- Generated by memories\.sh at .+? -->/, "").trim();
      const mdcName = file.replace(/\.md$/, ".mdc");
      const out = `${mdcFrontmatter}\n\n${cleanBody}${makeFooter()}`;
      await safeWrite(join(outputDir, ".cursor", "rules", mdcName), out, result);
    }
  } catch (error) {
    result.errors.push(`rules: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  // 3. skills/**/SKILL.md → .cursor/skills/**/SKILL.md
  try {
    const skillDirs = await listSkillDirs(join(agentsDir, "skills"));
    for (const dir of skillDirs) {
      const content = await safeRead(join(agentsDir, "skills", dir, "SKILL.md"));
      if (!content) continue;

      const out = content.includes(MARKER) ? content : content + makeFooter();
      await safeWrite(join(outputDir, ".cursor", "skills", dir, "SKILL.md"), out, result);
    }
  } catch (error) {
    result.errors.push(`skills: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  return result;
}

// ── 4c: Flat-File Adapter ───────────────────────────────────────────

/**
 * Adapt `.agents/` directory to a single flat markdown file.
 *
 * Concatenates instructions.md and all rules into one file.
 * Used for Copilot, Windsurf, Cline, Roo, Gemini, etc.
 *
 * @param agentsDir - Path to `.agents/` directory
 * @param outputPath - Full path to the output file (e.g. `.github/copilot-instructions.md`)
 * @param options - Optional header and maxLength for truncation
 */
export async function adaptForFlatFile(
  agentsDir: string,
  outputPath: string,
  options?: FlatFileOptions,
): Promise<AdaptResult> {
  const result = emptyResult();
  const header = options?.header ?? "# Project Memories";
  const maxLength = options?.maxLength;

  try {
    const sections: string[] = [];

    // 1. Read instructions.md
    const instructions = await safeRead(join(agentsDir, "instructions.md"));
    if (instructions) {
      // Strip marker from source
      const clean = instructions.replace(/\n<!-- Generated by memories\.sh at .+? -->/, "").trim();
      if (clean) sections.push(clean);
    }

    // 2. Read all rules, strip frontmatter, annotate with path
    const ruleFiles = await listMdFiles(join(agentsDir, "rules"));
    for (const file of ruleFiles) {
      const content = await safeRead(join(agentsDir, "rules", file));
      if (!content) continue;

      const { frontmatter, body } = stripFrontmatter(content);
      const paths = extractPaths(frontmatter);
      const cleanBody = body.replace(/\n<!-- Generated by memories\.sh at .+? -->/, "").trim();

      if (cleanBody) {
        if (paths.length > 0) {
          sections.push(`### Rules for ${paths.join(", ")}\n\n${cleanBody}`);
        } else {
          sections.push(cleanBody);
        }
      }
    }

    if (sections.length === 0) {
      return result;
    }

    let content = `${header}\n\n${sections.join("\n\n")}`;

    // 4. Truncate if maxLength set
    if (maxLength && content.length > maxLength) {
      const truncated = content.slice(0, maxLength);
      const lastNewline = truncated.lastIndexOf("\n");
      content = lastNewline > 0
        ? truncated.slice(0, lastNewline) + "\n\n> _Truncated to fit character limit._"
        : truncated;
    }

    content += makeFooter();

    // Check overwrite safety
    if (existsSync(outputPath)) {
      const ours = await hasOurMarker(outputPath);
      if (!ours) {
        result.filesSkipped.push(outputPath);
        return result;
      }
    }

    await mkdir(join(outputPath, ".."), { recursive: true });
    await writeFile(outputPath, content, "utf-8");
    result.filesCreated.push(outputPath);
  } catch (error) {
    result.errors.push(`flat-file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  return result;
}

// ── Adapter Dispatch ─────────────────────────────────────────────────

/** Target names that have adapter support. */
export const ADAPTER_TARGETS = new Set([
  "claude", "cursor", "copilot", "windsurf", "cline", "roo", "gemini",
]);

/**
 * Run the appropriate adapter for a target name.
 * Returns null if no adapter exists for the given target.
 */
export async function runAdapter(
  targetName: string,
  agentsDir: string,
  outputDir: string,
): Promise<AdaptResult | null> {
  switch (targetName) {
    case "claude": return adaptForClaude(agentsDir, outputDir);
    case "cursor": return adaptForCursor(agentsDir, outputDir);
    case "copilot": return adaptForFlatFile(agentsDir, join(outputDir, ".github", "copilot-instructions.md"));
    case "windsurf": return adaptForFlatFile(agentsDir, join(outputDir, ".windsurf", "rules", "memories.md"), { maxLength: 6000 });
    case "cline": return adaptForFlatFile(agentsDir, join(outputDir, ".clinerules", "memories.md"));
    case "roo": return adaptForFlatFile(agentsDir, join(outputDir, ".roo", "rules", "memories.md"));
    case "gemini": return adaptForFlatFile(agentsDir, join(outputDir, "GEMINI.md"));
    default: return null;
  }
}

// ── Reporting ────────────────────────────────────────────────────────

/**
 * Log the result of an adapter run to the console.
 */
export function logAdaptResult(targetName: string, result: AdaptResult): void {
  for (const file of result.filesCreated) {
    console.log(chalk.green("✓") + ` Wrote ${targetName} → ${chalk.dim(file)}`);
  }
  for (const file of result.filesSkipped) {
    console.log(
      chalk.yellow("⚠") +
        ` Skipped ${chalk.dim(file)} (not generated by memories.sh, use --force)`,
    );
  }
  for (const error of result.errors) {
    console.error(chalk.red("✗") + ` ${targetName} adapter error: ${error}`);
  }
}
