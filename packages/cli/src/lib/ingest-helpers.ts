import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, dirname, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import chalk from "chalk";
import { addMemory, type MemoryType, type AddMemoryOpts } from "./memory.js";

import { MARKER } from "./markers.js";

// ── Frontmatter Parsing ──────────────────────────────────────────────

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse YAML frontmatter delimited by `---` from file content.
 * Returns the parsed fields and the body text after the closing `---`.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const parsed = parseYaml(match[1]) as unknown;
    const frontmatter = (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      ? parsed as Record<string, unknown>
      : {};
    return { frontmatter, body: match[2] };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Parse MDC-style frontmatter (used by Cursor .mdc files).
 * MDC files use `---` delimiters just like YAML frontmatter.
 */
function parseMdcFrontmatter(content: string): ParsedFrontmatter {
  return parseFrontmatter(content);
}

// ── Shared Helpers ───────────────────────────────────────────────────

function hasMarker(content: string): boolean {
  return content.includes(MARKER);
}

/**
 * Extract bullet points from markdown body content.
 * Reuses the same logic as the existing extractMemories but with simpler output.
 */
export function extractBulletPoints(body: string): string[] {
  const results: string[] = [];
  const clean = body.replace(/<!--.*?-->/g, "").trim();

  for (const line of clean.split("\n")) {
    const trimmed = line.trim();

    // Bullet points (- or *)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text.length > 10 && text.length < 500) {
        results.push(text);
      }
      continue;
    }

    // Numbered items
    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      const text = numberedMatch[1].trim();
      if (text.length > 10 && text.length < 500) {
        results.push(text);
      }
      continue;
    }

    // Plain text lines
    if (trimmed.length > 20 && trimmed.length < 500 && !trimmed.startsWith("#") && !trimmed.startsWith(">")) {
      results.push(trimmed);
    }
  }

  return results;
}

// ── Dedup Key ────────────────────────────────────────────────────────

/**
 * Build a dedup key that includes both normalized content and paths.
 * Same content with different paths is NOT a duplicate.
 */
export function dedupKey(content: string, paths?: string[]): string {
  const normalized = content.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim();
  if (paths && paths.length > 0) {
    const sortedPaths = [...paths].sort().join("|");
    return `${normalized}::${sortedPaths}`;
  }
  return normalized;
}

// ── Directory Ingestion Results ──────────────────────────────────────

export interface IngestResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Known project-local skill directories across supported agent/tool configs.
 * Used for setup-time skill ingestion and `memories ingest skills`.
 */
export const PROJECT_SKILLS_DIRS = [
  ".agents/skills",
  ".claude/skills",
  ".cursor/skills",
  ".codex/skills",
  ".kiro/skills",
  ".kilo/skills",
  ".trae/skills",
  ".antigravity/skills",
  ".goose/skills",
  ".windsurf/skills",
  ".cline/skills",
  ".clinerules/skills",
  ".roo/skills",
  ".amp/skills",
  ".opencode/skills",
  ".factory/skills",
  ".gemini/skills",
] as const;

// ── Shared Rules Directory Ingestion ─────────────────────────────────

/**
 * Ingest rules from a directory of markdown files with paths frontmatter.
 * Shared logic used by Claude rules, .agents/rules, and other YAML-frontmatter rule dirs.
 */
async function ingestRulesFromDir(
  rulesDir: string,
  label: string,
  fileExtension: string,
  opts: { dryRun?: boolean; existingSet: Set<string>; typeOverride?: MemoryType },
): Promise<IngestResult> {
  const result: IngestResult = { imported: 0, skipped: 0, errors: [] };

  if (!existsSync(rulesDir)) return result;

  let files: string[];
  try {
    files = (await readdir(rulesDir)).filter((f) => f.endsWith(fileExtension));
  } catch (error) {
    result.errors.push(`Failed to read ${rulesDir}: ${error instanceof Error ? error.message : "Unknown error"}`);
    return result;
  }

  if (files.length === 0) return result;

  console.log(chalk.bold(`\n  ${label}`) + chalk.dim(` (${rulesDir}) — ${files.length} files`));

  for (const file of files) {
    const filePath = join(rulesDir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      if (hasMarker(content)) {
        console.log(chalk.dim(`    Skipping ${file} (generated by memories.sh)`));
        continue;
      }

      const { frontmatter, body } = parseFrontmatter(content);
      const paths = Array.isArray(frontmatter.paths)
        ? frontmatter.paths.map(String)
        : [];
      const category = basename(file, fileExtension);
      const items = extractBulletPoints(body);

      for (const text of items) {
        const type = opts.typeOverride ?? "rule";
        const key = dedupKey(text, paths);

        if (opts.existingSet.has(key)) {
          if (opts.dryRun) {
            console.log(`    ${chalk.dim("skip")}      ${chalk.dim(text)}`);
          }
          result.skipped++;
          continue;
        }

        if (opts.dryRun) {
          console.log(`    ${chalk.blue("rule".padEnd(9))} ${text}` + (paths.length > 0 ? chalk.dim(` [${paths.join(", ")}]`) : ""));
        } else {
          const addOpts: AddMemoryOpts = { type, category };
          if (paths.length > 0) addOpts.paths = paths;
          await addMemory(text, addOpts);
          result.imported++;
        }
        opts.existingSet.add(key);
      }
    } catch (error) {
      const msg = `Failed to process ${file}: ${error instanceof Error ? error.message : "Unknown error"}`;
      result.errors.push(msg);
      console.error(chalk.red("  ✗") + ` ${msg}`);
    }
  }

  return result;
}

// ── Claude Rules Ingestion ───────────────────────────────────────────

/**
 * Ingest `.claude/rules/*.md` files.
 * Parses YAML frontmatter for `paths:` array, extracts bullet points,
 * imports each as type: "rule" with paths and category from filename.
 */
export async function ingestClaudeRules(
  dir: string,
  opts: { dryRun?: boolean; existingSet: Set<string>; typeOverride?: MemoryType },
): Promise<IngestResult> {
  return ingestRulesFromDir(join(dir, ".claude", "rules"), "claude-rules", ".md", opts);
}

// ── Cursor Rules Ingestion ───────────────────────────────────────────

/**
 * Ingest `.cursor/rules/*.mdc` files.
 * Parses MDC frontmatter for `globs:` (comma-separated) and `alwaysApply:`.
 * Imports each as type: "rule" with paths and category from filename.
 */
export async function ingestCursorRules(
  dir: string,
  opts: { dryRun?: boolean; existingSet: Set<string>; typeOverride?: MemoryType },
): Promise<IngestResult> {
  const rulesDir = join(dir, ".cursor", "rules");
  const result: IngestResult = { imported: 0, skipped: 0, errors: [] };

  if (!existsSync(rulesDir)) {
    return result;
  }

  let files: string[];
  try {
    files = (await readdir(rulesDir)).filter((f) => f.endsWith(".mdc"));
  } catch (error) {
    result.errors.push(`Failed to read ${rulesDir}: ${error instanceof Error ? error.message : "Unknown error"}`);
    return result;
  }

  if (files.length === 0) return result;

  console.log(chalk.bold(`\n  cursor-rules`) + chalk.dim(` (${rulesDir}) — ${files.length} files`));

  for (const file of files) {
    const filePath = join(rulesDir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      if (hasMarker(content)) {
        console.log(chalk.dim(`    Skipping ${file} (generated by memories.sh)`));
        continue;
      }

      const { frontmatter, body } = parseMdcFrontmatter(content);

      // Parse globs: comma-separated string → paths array
      let paths: string[] = [];
      const alwaysApply = frontmatter.alwaysApply === true;

      if (!alwaysApply && typeof frontmatter.globs === "string") {
        paths = frontmatter.globs.split(",").map((g) => g.trim()).filter(Boolean);
      } else if (!alwaysApply && Array.isArray(frontmatter.globs)) {
        paths = frontmatter.globs.map(String).filter(Boolean);
      }

      const category = basename(file, ".mdc");
      const items = extractBulletPoints(body);

      for (const text of items) {
        const type = opts.typeOverride ?? "rule";
        const key = dedupKey(text, paths);

        if (opts.existingSet.has(key)) {
          if (opts.dryRun) {
            console.log(`    ${chalk.dim("skip")}      ${chalk.dim(text)}`);
          }
          result.skipped++;
          continue;
        }

        if (opts.dryRun) {
          const pathsLabel = alwaysApply ? chalk.dim(" [global]") : paths.length > 0 ? chalk.dim(` [${paths.join(", ")}]`) : "";
          console.log(`    ${chalk.blue("rule".padEnd(9))} ${text}${pathsLabel}`);
        } else {
          const addOpts: AddMemoryOpts = { type, category };
          if (paths.length > 0) addOpts.paths = paths;
          await addMemory(text, addOpts);
          result.imported++;
        }
        opts.existingSet.add(key);
      }
    } catch (error) {
      const msg = `Failed to process ${file}: ${error instanceof Error ? error.message : "Unknown error"}`;
      result.errors.push(msg);
      console.error(chalk.red("  ✗") + ` ${msg}`);
    }
  }

  return result;
}

// ── Skills Ingestion ─────────────────────────────────────────────────

/**
 * Ingest SKILL.md files from skills directories.
 * Parses YAML frontmatter for name/description, imports with type: "skill".
 */
export async function ingestSkills(
  dir: string,
  skillsDirs: readonly string[],
  opts: { dryRun?: boolean; existingSet: Set<string>; silent?: boolean },
): Promise<IngestResult> {
  const result: IngestResult = { imported: 0, skipped: 0, errors: [] };

  for (const skillsDir of skillsDirs) {
    const fullDir = join(dir, skillsDir);
    if (!existsSync(fullDir)) continue;

    const skillFiles = await findSkillFiles(fullDir);
    if (skillFiles.length === 0) continue;

    if (!opts.silent) {
      console.log(chalk.bold(`\n  skills`) + chalk.dim(` (${fullDir}) — ${skillFiles.length} files`));
    }

    for (const filePath of skillFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        if (hasMarker(content)) {
          if (!opts.silent) {
            console.log(chalk.dim(`    Skipping ${basename(dirname(filePath))}/SKILL.md (generated by memories.sh)`));
          }
          continue;
        }

        const { frontmatter, body } = parseFrontmatter(content);
        const category = basename(dirname(filePath));
        const name = typeof frontmatter.name === "string" ? frontmatter.name : category;
        const description = typeof frontmatter.description === "string" ? frontmatter.description : "";

        // Build metadata from all frontmatter fields
        const metadata: Record<string, unknown> = { ...frontmatter };

        const bodyContent = body.trim();
        if (!bodyContent) continue;

        const key = dedupKey(bodyContent);

        if (opts.existingSet.has(key)) {
          if (opts.dryRun && !opts.silent) {
            console.log(`    ${chalk.dim("skip")}      ${chalk.dim(name)}`);
          }
          result.skipped++;
          continue;
        }

        if (opts.dryRun) {
          if (!opts.silent) {
            console.log(`    ${chalk.magenta("skill".padEnd(9))} ${name}` + (description ? chalk.dim(` — ${description}`) : ""));
          }
        } else {
          await addMemory(bodyContent, {
            type: "skill",
            category,
            metadata,
          });
          result.imported++;
        }
        opts.existingSet.add(key);
      } catch (error) {
        const msg = `Failed to process ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`;
        result.errors.push(msg);
        console.error(chalk.red("  ✗") + ` ${msg}`);
      }
    }
  }

  return result;
}

/**
 * Recursively find all SKILL.md files in a directory.
 */
async function findSkillFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findSkillFiles(fullPath);
        results.push(...nested);
      } else if (entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory read failure — skip silently
  }

  return results;
}

// ── .agents/ Directory Ingestion ─────────────────────────────────────

/**
 * Ingest from the .agents directory.
 * Scans instructions.md, rules, and skills subdirectories.
 */
export async function ingestAgentsDir(
  dir: string,
  opts: { dryRun?: boolean; existingSet: Set<string>; typeOverride?: MemoryType },
): Promise<IngestResult> {
  const agentsDir = join(dir, ".agents");
  const result: IngestResult = { imported: 0, skipped: 0, errors: [] };

  if (!existsSync(agentsDir)) return result;

  // Ingest instructions.md (flat file, uses existing approach but with agents source name)
  const instructionsPath = join(agentsDir, "instructions.md");
  if (existsSync(instructionsPath)) {
    try {
      const content = await readFile(instructionsPath, "utf-8");
      if (!hasMarker(content)) {
        const items = extractBulletPoints(content);
        if (items.length > 0) {
          console.log(chalk.bold(`\n  agents`) + chalk.dim(` (${instructionsPath}) — ${items.length} items`));
          for (const text of items) {
            const type = opts.typeOverride ?? "rule";
            const key = dedupKey(text);

            if (opts.existingSet.has(key)) {
              if (opts.dryRun) {
                console.log(`    ${chalk.dim("skip")}      ${chalk.dim(text)}`);
              }
              result.skipped++;
              continue;
            }

            if (opts.dryRun) {
              console.log(`    ${chalk.blue("rule".padEnd(9))} ${text}`);
            } else {
              await addMemory(text, { type });
              result.imported++;
            }
            opts.existingSet.add(key);
          }
        }
      } else {
        console.log(chalk.dim(`    Skipping instructions.md (generated by memories.sh)`));
      }
    } catch (error) {
      result.errors.push(`Failed to process instructions.md: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Ingest rules/*.md (reuse shared helper)
  const agentsRulesDir = join(agentsDir, "rules");
  if (existsSync(agentsRulesDir)) {
    const rulesResult = await ingestRulesFromDir(agentsRulesDir, "agents-rules", ".md", opts);
    result.imported += rulesResult.imported;
    result.skipped += rulesResult.skipped;
    result.errors.push(...rulesResult.errors);
  }

  // Ingest skills
  const skillsResult = await ingestSkills(dir, [".agents/skills"], opts);
  result.imported += skillsResult.imported;
  result.skipped += skillsResult.skipped;
  result.errors.push(...skillsResult.errors);

  return result;
}
