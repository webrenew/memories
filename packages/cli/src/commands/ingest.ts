import { Command } from "commander";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { addMemory, isMemoryType, MEMORY_TYPES, type MemoryType } from "../lib/memory.js";
import { getDb } from "../lib/db.js";
import {
  dedupKey,
  ingestClaudeRules,
  ingestCursorRules,
  ingestSkills,
  ingestAgentsDir,
  PROJECT_SKILLS_DIRS,
  type IngestResult,
} from "../lib/ingest-helpers.js";

// Re-export dedupKey for use in flat-file dedup (unifies with directory-based dedup)
const normalizeForDedup = (s: string): string => dedupKey(s);

interface IngestSource {
  name: string;
  paths: string[];
  description: string;
}

const SOURCES: IngestSource[] = [
  { name: "cursor", paths: [".cursor/rules/memories.mdc", ".cursorrules"], description: "Cursor rules" },
  { name: "claude", paths: ["CLAUDE.md"], description: "Claude Code instructions" },
  { name: "agents", paths: ["AGENTS.md"], description: "AGENTS.md" },
  { name: "copilot", paths: [".github/copilot-instructions.md"], description: "GitHub Copilot instructions" },
  { name: "windsurf", paths: [".windsurf/rules/memories.md", ".windsurfrules"], description: "Windsurf rules" },
  { name: "cline", paths: [".clinerules/memories.md", ".clinerules"], description: "Cline rules" },
  { name: "roo", paths: [".roo/rules/memories.md"], description: "Roo rules" },
  { name: "gemini", paths: ["GEMINI.md"], description: "Gemini instructions" },
];

/** Directory-based source names that trigger specialized parsers */
const DIRECTORY_SOURCES = new Set([
  "claude-rules",
  "cursor-rules",
  "skills",
]);

/** Path patterns that map to directory-based ingestion */
const DIRECTORY_PATH_PATTERNS: Array<{ pattern: string; handler: string }> = [
  { pattern: ".claude/rules/", handler: "claude-rules" },
  { pattern: ".claude/rules", handler: "claude-rules" },
  { pattern: ".cursor/rules/", handler: "cursor-rules" },
  { pattern: ".cursor/rules", handler: "cursor-rules" },
  ...PROJECT_SKILLS_DIRS.flatMap((dir) => ([
    { pattern: `${dir}/`, handler: "skills" },
    { pattern: dir, handler: "skills" },
  ])),
  { pattern: ".agents/", handler: "agents-dir" },
  { pattern: ".agents", handler: "agents-dir" },
];

import { MARKER } from "../lib/markers.js";

function inferType(line: string): MemoryType {
  const lower = line.toLowerCase();
  if (lower.includes("always") || lower.includes("never") || lower.includes("must") || lower.includes("prefer")) {
    return "rule";
  }
  if (lower.includes("chose") || lower.includes("decided") || lower.includes("because") || lower.includes("instead of")) {
    return "decision";
  }
  if (lower.match(/\b(is|are|has|uses|runs on|version|limit)\b/)) {
    return "fact";
  }
  return "rule";
}

function extractMemories(content: string): { content: string; type: MemoryType }[] {
  const memories: { content: string; type: MemoryType }[] = [];

  // Strip YAML frontmatter
  const stripped = content.replace(/^---[\s\S]*?---\n*/m, "");

  // Strip our own marker
  const clean = stripped.replace(/<!--.*?-->/g, "").trim();

  for (const line of clean.split("\n")) {
    const trimmed = line.trim();

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text.length > 10 && text.length < 500) {
        memories.push({ content: text, type: inferType(text) });
      }
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      const text = numberedMatch[1].trim();
      if (text.length > 10 && text.length < 500) {
        memories.push({ content: text, type: inferType(text) });
      }
      continue;
    }

    if (trimmed.length > 20 && trimmed.length < 500 && !trimmed.startsWith("#") && !trimmed.startsWith(">")) {
      memories.push({ content: trimmed, type: inferType(trimmed) });
    }
  }

  return memories;
}

// normalize removed — using dedupKey from ingest-helpers for consistent dedup

/**
 * Build the dedup set from existing memories in the database.
 * Includes both content-only keys and content+paths keys for path-scoped dedup.
 */
async function buildDedupSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const db = await getDb();
  const result = await db.execute("SELECT content, paths FROM memories WHERE deleted_at IS NULL");
  for (const row of result.rows) {
    const content = String(row.content);
    const pathsStr = row.paths ? String(row.paths) : null;
    const paths = pathsStr ? pathsStr.split(",").map((p) => p.trim()).filter(Boolean) : undefined;

    // Add both content-only and content+paths keys for comprehensive dedup
    set.add(normalizeForDedup(content));
    if (paths && paths.length > 0) {
      set.add(dedupKey(content, paths));
    }
  }
  return set;
}

/**
 * Resolve a source argument to a directory handler name, or null if it's a flat-file source.
 */
function resolveDirectorySource(source: string): string | null {
  if (DIRECTORY_SOURCES.has(source)) return source;

  for (const { pattern, handler } of DIRECTORY_PATH_PATTERNS) {
    if (source === pattern || source.endsWith(pattern)) return handler;
  }

  return null;
}

/**
 * Run a directory-based ingestion handler.
 */
async function runDirectoryIngest(
  handler: string,
  cwd: string,
  opts: { dryRun?: boolean; existingSet: Set<string>; typeOverride?: MemoryType },
): Promise<IngestResult> {
  switch (handler) {
    case "claude-rules":
      return ingestClaudeRules(cwd, opts);
    case "cursor-rules":
      return ingestCursorRules(cwd, opts);
    case "skills":
      return ingestSkills(cwd, PROJECT_SKILLS_DIRS, opts);
    case "agents-dir":
      return ingestAgentsDir(cwd, opts);
    default:
      return { imported: 0, skipped: 0, errors: [`Unknown handler: ${handler}`] };
  }
}

export const ingestCommand = new Command("ingest")
  .description("Import memories from existing IDE rule files")
  .argument("[source]", "Source to import from (cursor, claude, claude-rules, cursor-rules, skills, agents, copilot, windsurf, cline, roo, gemini, or file/dir path)")
  .option("--type <type>", "Override type for all imported memories")
  .option("--dry-run", "Preview without importing")
  .option("--all", "Scan all known IDE rule file locations")
  .option("--no-dedup", "Skip duplicate detection")
  .action(async (source: string | undefined, opts: { type?: string; dryRun?: boolean; all?: boolean; dedup?: boolean }) => {
    try {
      // Validate --type early
      if (opts.type && !isMemoryType(opts.type)) {
        console.error(chalk.red("✗") + ` Invalid type "${opts.type}". Valid types: ${MEMORY_TYPES.join(", ")}`);
        process.exit(1);
      }

      const cwd = process.cwd();

      // Build dedup set from existing memories
      const existingSet = new Set<string>();
      if (opts.dedup !== false) {
        const populated = await buildDedupSet();
        for (const key of populated) existingSet.add(key);
      }

      const typeOverride = opts.type && isMemoryType(opts.type) ? opts.type : undefined;
      let totalImported = 0;
      let totalSkipped = 0;

      if (opts.all) {
        // ── Flat-file sources ────────────────────────────────────────
        const filesToProcess: { name: string; path: string }[] = [];
        for (const src of SOURCES) {
          for (const p of src.paths) {
            if (existsSync(p)) {
              filesToProcess.push({ name: src.name, path: p });
            }
          }
        }

        const flatResult = await ingestFlatFiles(filesToProcess, existingSet, opts, typeOverride);
        totalImported += flatResult.imported;
        totalSkipped += flatResult.skipped;

        // ── Directory-based sources ──────────────────────────────────
        const dirOpts = { dryRun: opts.dryRun, existingSet, typeOverride };

        const [claudeResult, cursorResult, skillsResult] = await Promise.all([
          runDirectoryIngest("claude-rules", cwd, dirOpts),
          runDirectoryIngest("cursor-rules", cwd, dirOpts),
          runDirectoryIngest("skills", cwd, dirOpts),
        ]);
        totalImported += claudeResult.imported + cursorResult.imported + skillsResult.imported;
        totalSkipped += claudeResult.skipped + cursorResult.skipped + skillsResult.skipped;

        if (totalImported === 0 && totalSkipped === 0 && filesToProcess.length === 0) {
          console.log(chalk.dim("No IDE rule files found."));
          return;
        }
      } else if (source) {
        // Check if this is a directory-based source
        const dirHandler = resolveDirectorySource(source);
        if (dirHandler) {
          const dirOpts = { dryRun: opts.dryRun, existingSet, typeOverride };
          const result = await runDirectoryIngest(dirHandler, cwd, dirOpts);
          totalImported += result.imported;
          totalSkipped += result.skipped;

          if (result.imported === 0 && result.skipped === 0 && result.errors.length === 0) {
            console.log(chalk.dim(`No importable files found for "${source}".`));
            return;
          }
        } else {
          // Flat-file source handling (existing behavior)
          const filesToProcess: { name: string; path: string }[] = [];

          const known = SOURCES.find((s) => s.name === source);
          if (known) {
            for (const p of known.paths) {
              if (existsSync(p)) {
                filesToProcess.push({ name: known.name, path: p });
                break;
              }
            }
            if (filesToProcess.length === 0) {
              console.error(chalk.red("✗") + ` No ${known.description} file found at: ${known.paths.join(", ")}`);
              process.exit(1);
            }
          } else if (existsSync(source)) {
            filesToProcess.push({ name: "file", path: source });
          } else {
            const allSources = [...SOURCES.map((s) => s.name), ...DIRECTORY_SOURCES];
            console.error(chalk.red("✗") + ` Unknown source "${source}". Valid: ${allSources.join(", ")}, or a file path`);
            process.exit(1);
          }

          const flatResult = await ingestFlatFiles(filesToProcess, existingSet, opts, typeOverride);
          totalImported += flatResult.imported;
          totalSkipped += flatResult.skipped;
        }
      } else {
        console.error(chalk.red("✗") + " Specify a source or use --all");
        process.exit(1);
      }

      if (opts.dryRun) {
        const skipMsg = totalSkipped > 0 ? ` (${totalSkipped} duplicates skipped)` : "";
        console.log(chalk.dim(`\n  Dry run — no memories imported.${skipMsg} Remove --dry-run to import.`));
      } else if (totalImported > 0 || totalSkipped > 0) {
        const skipMsg = totalSkipped > 0 ? chalk.dim(` (${totalSkipped} duplicates skipped)`) : "";
        console.log(chalk.green("\n✓") + ` Imported ${totalImported} memories` + skipMsg);
      }
    } catch (error) {
      console.error(chalk.red("✗") + " Failed to ingest:", error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });

/**
 * Ingest flat files (the original behavior).
 * Extracted to a helper for reuse in both --all and single-source modes.
 */
async function ingestFlatFiles(
  filesToProcess: { name: string; path: string }[],
  existingSet: Set<string>,
  opts: { dryRun?: boolean; dedup?: boolean },
  typeOverride?: MemoryType,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const file of filesToProcess) {
    const content = await readFile(file.path, "utf-8");

    // Skip files we generated
    if (content.includes(MARKER)) {
      console.log(chalk.dim(`  Skipping ${file.path} (generated by memories.sh)`));
      continue;
    }

    const memories = extractMemories(content);

    if (memories.length === 0) {
      console.log(chalk.dim(`  No importable memories found in ${file.path}`));
      continue;
    }

    console.log(chalk.bold(`\n  ${file.name}`) + chalk.dim(` (${file.path}) — ${memories.length} items`));

    for (const mem of memories) {
      const type = typeOverride ?? mem.type;

      // Check for duplicates
      if (opts.dedup !== false && existingSet.has(normalizeForDedup(mem.content))) {
        if (opts.dryRun) {
          console.log(`    ${chalk.dim("skip")}      ${chalk.dim(mem.content)}`);
        }
        skipped++;
        continue;
      }

      if (opts.dryRun) {
        const typeColor = type === "rule" ? chalk.blue : type === "decision" ? chalk.yellow : type === "fact" ? chalk.green : chalk.dim;
        console.log(`    ${typeColor(type.padEnd(9))} ${mem.content}`);
      } else {
        await addMemory(mem.content, { type });
        existingSet.add(normalizeForDedup(mem.content));
        imported++;
      }
    }
  }

  return { imported, skipped };
}
