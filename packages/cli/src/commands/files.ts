import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getDb, syncDb, readSyncConfig } from "../lib/db.js";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { homedir } from "node:os";

interface SyncedFile {
  id: string;
  path: string;
  content: string;
  hash: string;
  scope: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

type ListedFile = Pick<SyncedFile, "id" | "path" | "hash" | "scope" | "source" | "updated_at">;
type ExistingFile = Pick<SyncedFile, "id" | "hash">;
type ApplyFile = Pick<SyncedFile, "id" | "path" | "content" | "scope" | "source">;
type ShowFile = Pick<SyncedFile, "content" | "scope" | "source" | "updated_at">;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// Specific file paths and patterns to sync from each tool directory
// Only sync: instruction files, commands, skills, rules, and essential configs
const SYNC_TARGETS = [
  // .agents - Agent instruction files, commands, tasks, and skills
  { dir: ".agents", files: ["instructions.md", "settings.json"] },
  { dir: ".agents/commands", pattern: /\.md$/ },
  { dir: ".agents/tasks", pattern: /\.(md|txt)$/ },
  { dir: ".agents/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .claude - Claude Code instructions, commands, rules, hooks, and tasks
  { dir: ".claude", files: ["CLAUDE.md", "settings.json", "settings.local.json"] },
  { dir: ".claude/commands", pattern: /\.md$/ },
  { dir: ".claude/rules", pattern: /\.(md|rules)$/ },
  { dir: ".claude/hooks", pattern: /\.(json|sh)$/ },
  { dir: ".claude/tasks", pattern: /\.(md|txt)$/ },
  { dir: ".claude/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .cursor - Cursor rules and MCP config
  { dir: ".cursor", files: ["mcp.json", "rules.md"] },
  { dir: ".cursor/rules", pattern: /\.(md|mdc|txt)$/ },
  { dir: ".cursor/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .codex - Codex config, rules, and tasks
  { dir: ".codex", files: ["config.toml", "AGENTS.md", "instructions.md"] },
  { dir: ".codex/rules", pattern: /\.(md|rules)$/ },
  { dir: ".codex/tasks", pattern: /\.(md|txt)$/ },
  { dir: ".codex/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },

  // Kiro config
  { dir: ".kiro/settings", files: ["mcp.json"] },
  { dir: ".kiro/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },

  // Kilo config
  { dir: ".kilo", files: ["mcp.json"] },
  { dir: ".kilo/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },

  // Trae config
  { dir: ".trae", files: ["mcp.json"] },
  { dir: ".trae/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },

  // Antigravity config
  { dir: ".antigravity", files: ["mcp.json", "mcp_config.json"] },
  { dir: ".antigravity/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },

  // Goose config
  { dir: ".goose/rules", pattern: /\.(md|txt)$/ },
  { dir: ".goose/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .windsurf - Windsurf rules
  { dir: ".windsurf", files: ["rules.md", "cascade.json"] },
  { dir: ".windsurf/rules", pattern: /\.(md|txt)$/ },
  { dir: ".windsurf/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .cline - Cline rules
  { dir: ".cline", files: ["rules.md", "CLINE.md", "cline_rules.md"] },
  { dir: ".cline/rules", pattern: /\.(md|txt)$/ },
  { dir: ".cline/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .github/copilot - Copilot instructions
  { dir: ".github/copilot", files: ["instructions.md"] },
  
  // .gemini - Gemini instructions
  { dir: ".gemini", files: ["GEMINI.md", "settings.json"] },
  { dir: ".gemini/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .roo - Roo config and rules
  { dir: ".roo", files: ["config.json", "rules.md"] },
  { dir: ".roo/rules", pattern: /\.(md|txt)$/ },
  { dir: ".roo/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .amp - Amp rules
  { dir: ".amp", files: ["AGENTS.md", "rules.md"] },
  { dir: ".amp/rules", pattern: /\.(md|txt)$/ },
  { dir: ".amp/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .opencode - OpenCode instructions
  { dir: ".", files: ["opencode.json", "opencode.jsonc"] },
  { dir: ".config/opencode", files: ["opencode.json"] },
  { dir: ".opencode", files: ["instructions.md"] },
  { dir: ".opencode/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
  
  // .factory - Factory/Droid config
  { dir: ".factory", files: ["config.json", "instructions.md"] },
  { dir: ".factory/droids", pattern: /\.(md|yaml|yml)$/ },
  { dir: ".factory/tasks", pattern: /\.(md|txt)$/ },
  { dir: ".factory/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },

  // OpenClaw workspace artifacts
  { dir: ".openclaw/workspace", files: ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md", "BOOT.md", "MEMORY.md", "memory.md"] },
  { dir: ".openclaw/workspace/memory", pattern: /\.md$/ },
  { dir: ".openclaw/workspace/skills", pattern: /\.(md|json|yaml|yml|toml|txt)$/, recurse: true },
];

interface SyncTarget {
  dir: string;
  files?: string[];
  pattern?: RegExp;
  recurse?: boolean;
}

async function scanTarget(baseDir: string, target: SyncTarget, relativeTo: string = ""): Promise<{ path: string; fullPath: string; source: string }[]> {
  const results: { path: string; fullPath: string; source: string }[] = [];
  const targetDir = join(baseDir, target.dir);
  
  if (!existsSync(targetDir)) return results;
  
  // Get tool name from first part of dir (e.g., ".agents" -> "Agents")
  const sourceRoot = target.dir.split("/")[0].replace(/^\./, "");
  const source = sourceRoot
    ? sourceRoot.replace(/^(.)/, (_, c) => c.toUpperCase())
    : "Project";
  
  // If specific files are listed, just check for those
  if (target.files) {
    for (const file of target.files) {
      const fullPath = join(targetDir, file);
      if (existsSync(fullPath)) {
        const stats = await stat(fullPath);
        if (stats.isFile()) {
          results.push({
            path: join(target.dir, file),
            fullPath,
            source,
          });
        }
      }
    }
    return results;
  }
  
  // Otherwise scan with pattern
  if (!target.pattern) return results;
  
  const entries = await readdir(targetDir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(targetDir, entry.name);
    const relativePath = join(target.dir, entry.name);
    
    if (entry.isDirectory() && target.recurse) {
      // Recurse into subdirectories
      const subTarget: SyncTarget = { dir: relativePath, pattern: target.pattern, recurse: true };
      const subResults = await scanTarget(baseDir, subTarget, relativeTo);
      results.push(...subResults);
    } else if (entry.isFile() && target.pattern.test(entry.name)) {
      results.push({ path: relativePath, fullPath, source });
    }
  }
  
  return results;
}

async function scanAllTargets(baseDir: string): Promise<{ path: string; fullPath: string; source: string }[]> {
  const results: { path: string; fullPath: string; source: string }[] = [];
  
  for (const target of SYNC_TARGETS) {
    const targetResults = await scanTarget(baseDir, target);
    results.push(...targetResults);
  }
  
  return results;
}

export const filesCommand = new Command("files")
  .description("Manage synced config files (.agents, .cursor, .claude, etc.)");

// List files
filesCommand
  .command("list")
  .alias("ls")
  .description("List synced files")
  .option("-s, --scope <scope>", "Filter by scope (global or project path)")
  .action(async (opts) => {
    const db = await getDb();
    
    let sql = "SELECT id, path, hash, scope, source, updated_at FROM files WHERE deleted_at IS NULL";
    const args: string[] = [];
    
    if (opts.scope) {
      sql += " AND scope = ?";
      args.push(opts.scope);
    }
    
    sql += " ORDER BY scope, path";
    
    const result = await db.execute({ sql, args });
    const files = result.rows as unknown as ListedFile[];
    
    if (files.length === 0) {
      console.log(chalk.dim("No synced files yet."));
      console.log(chalk.dim(`Run ${chalk.cyan("memories files ingest")} to import config files.`));
      return;
    }
    
    // Group by scope
    const byScope = new Map<string, ListedFile[]>();
    for (const file of files) {
      const scope = file.scope;
      if (!byScope.has(scope)) byScope.set(scope, []);
      byScope.get(scope)!.push(file);
    }
    
    for (const [scope, scopeFiles] of byScope) {
      const scopeLabel = scope === "global" 
        ? chalk.blue("Global") 
        : chalk.yellow(scope.replace("github.com/", ""));
      
      console.log(`\n${scopeLabel} ${chalk.dim(`(${scopeFiles.length} files)`)}`);
      console.log(chalk.dim("─".repeat(50)));
      
      for (const file of scopeFiles) {
        const source = file.source ? chalk.dim(` [${file.source}]`) : "";
        console.log(`  ${chalk.white(file.path)}${source}`);
      }
    }
    
    console.log();
  });

// Ingest files from local config directories
filesCommand
  .command("ingest")
  .description("Import files from .agents, .cursor, .claude and other config directories")
  .option("-g, --global", "Ingest global configs from home directory", true)
  .option("-p, --project", "Ingest project configs from current directory")
  .option("--dry-run", "Show what would be imported without making changes")
  .action(async (opts) => {
    const db = await getDb();
    const home = homedir();
    const cwd = process.cwd();
    
    const filesToIngest: { path: string; fullPath: string; scope: string; source: string }[] = [];
    
    // Scan global configs
    if (opts.global !== false) {
      const files = await scanAllTargets(home);
      for (const file of files) {
        filesToIngest.push({
          ...file,
          scope: "global",
        });
      }
    }
    
    // Scan project configs
    if (opts.project) {
      const files = await scanAllTargets(cwd);
      for (const file of files) {
        filesToIngest.push({
          ...file,
          scope: "project", // Will be resolved to git remote
        });
      }
    }
    
    if (filesToIngest.length === 0) {
      console.log(chalk.dim("No config files found to import."));
      return;
    }
    
    if (opts.dryRun) {
      console.log(chalk.bold(`Would import ${filesToIngest.length} files:\n`));
      for (const file of filesToIngest) {
        const scopeLabel = file.scope === "global" ? chalk.blue("G") : chalk.yellow("P");
        console.log(`  ${scopeLabel} ${file.path} ${chalk.dim(`[${file.source}]`)}`);
      }
      return;
    }
    
    const spinner = ora(`Importing ${filesToIngest.length} files...`).start();
    
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const file of filesToIngest) {
      try {
        const content = await readFile(file.fullPath, "utf-8");
        const hash = hashContent(content);
        
        // Check if file already exists
        const existing = await db.execute({
          sql: "SELECT id, hash FROM files WHERE path = ? AND scope = ? AND deleted_at IS NULL",
          args: [file.path, file.scope],
        });
        
        if (existing.rows.length > 0) {
          const existingFile = existing.rows[0] as unknown as ExistingFile;
          if (existingFile.hash === hash) {
            skipped++;
            continue;
          }
          
          // Update existing file
          await db.execute({
            sql: "UPDATE files SET content = ?, hash = ?, updated_at = datetime('now') WHERE id = ?",
            args: [content, hash, existingFile.id],
          });
          updated++;
        } else {
          // Insert new file
          const id = nanoid(12);
          await db.execute({
            sql: `INSERT INTO files (id, path, content, hash, scope, source) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [id, file.path, content, hash, file.scope, file.source],
          });
          imported++;
        }
      } catch (err) {
        // Skip files that can't be read
      }
    }
    
    // Sync to cloud if enabled
    const sync = await readSyncConfig();
    if (sync) {
      spinner.text = "Syncing to cloud...";
      await syncDb();
    }
    
    spinner.succeed(`Imported ${imported} new, updated ${updated}, skipped ${skipped} unchanged`);
  });

// Push local files to disk (apply synced files)
filesCommand
  .command("apply")
  .description("Write synced files to disk (restore from cloud)")
  .option("-g, --global", "Apply global files to home directory")
  .option("-p, --project", "Apply project files to current directory")
  .option("--dry-run", "Show what would be written without making changes")
  .option("-f, --force", "Overwrite existing files without prompting")
  .action(async (opts) => {
    const db = await getDb();
    const home = homedir();
    const cwd = process.cwd();
    
    let sql = "SELECT id, path, content, scope, source FROM files WHERE deleted_at IS NULL";
    const args: string[] = [];
    
    if (opts.global && !opts.project) {
      sql += " AND scope = 'global'";
    } else if (opts.project && !opts.global) {
      sql += " AND scope != 'global'";
    }
    
    const result = await db.execute({ sql, args });
    const files = result.rows as unknown as ApplyFile[];
    
    if (files.length === 0) {
      console.log(chalk.dim("No files to apply."));
      return;
    }
    
    if (opts.dryRun) {
      console.log(chalk.bold(`Would write ${files.length} files:\n`));
      for (const file of files) {
        const baseDir = file.scope === "global" ? home : cwd;
        const targetPath = join(baseDir, file.path);
        const exists = existsSync(targetPath);
        const status = exists ? chalk.yellow("(overwrite)") : chalk.green("(new)");
        console.log(`  ${targetPath} ${status}`);
      }
      return;
    }
    
    const spinner = ora(`Applying ${files.length} files...`).start();
    
    let written = 0;
    let skippedExisting = 0;
    
    for (const file of files) {
      const baseDir = file.scope === "global" ? home : cwd;
      const targetPath = join(baseDir, file.path);
      
      // Check if file exists and we're not forcing
      if (existsSync(targetPath) && !opts.force) {
        const existingContent = await readFile(targetPath, "utf-8");
        const existingHash = hashContent(existingContent);
        const newHash = hashContent(file.content);
        
        if (existingHash !== newHash) {
          skippedExisting++;
          continue;
        }
      }
      
      // Ensure directory exists
      await mkdir(dirname(targetPath), { recursive: true });
      
      // Write file
      await writeFile(targetPath, file.content, "utf-8");
      written++;
    }
    
    if (skippedExisting > 0) {
      spinner.succeed(`Applied ${written} files, skipped ${skippedExisting} (use --force to overwrite)`);
    } else {
      spinner.succeed(`Applied ${written} files`);
    }
  });

// Show file content
filesCommand
  .command("show <path>")
  .description("Show content of a synced file")
  .action(async (path) => {
    const db = await getDb();
    
    const result = await db.execute({
      sql: "SELECT content, scope, source, updated_at FROM files WHERE path = ? AND deleted_at IS NULL",
      args: [path],
    });
    
    if (result.rows.length === 0) {
      console.log(chalk.red(`File not found: ${path}`));
      return;
    }
    
    const file = result.rows[0] as unknown as ShowFile;
    
    console.log(chalk.dim(`# ${path}`));
    console.log(chalk.dim(`# Scope: ${file.scope} | Source: ${file.source || "unknown"}`));
    console.log(chalk.dim(`# Updated: ${file.updated_at}`));
    console.log(chalk.dim("─".repeat(50)));
    console.log(file.content);
  });

// Delete a synced file
filesCommand
  .command("forget <path>")
  .description("Remove a file from sync (soft delete)")
  .action(async (path) => {
    const db = await getDb();
    
    const result = await db.execute({
      sql: "UPDATE files SET deleted_at = datetime('now') WHERE path = ? AND deleted_at IS NULL",
      args: [path],
    });
    
    if (result.rowsAffected === 0) {
      console.log(chalk.red(`File not found: ${path}`));
      return;
    }
    
    // Sync to cloud if enabled
    const sync = await readSyncConfig();
    if (sync) {
      await syncDb();
    }
    
    console.log(chalk.green(`✓ Removed ${path} from sync`));
  });
