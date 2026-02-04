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

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// Known config directories to scan
const CONFIG_DIRS = [
  { dir: ".agents", name: "Agents" },
  { dir: ".claude", name: "Claude" },
  { dir: ".cursor", name: "Cursor" },
  { dir: ".github/copilot", name: "Copilot" },
  { dir: ".windsurf", name: "Windsurf" },
  { dir: ".cline", name: "Cline" },
  { dir: ".codex", name: "Codex" },
  { dir: ".gemini", name: "Gemini" },
  { dir: ".roo", name: "Roo" },
  { dir: ".amp", name: "Amp" },
];

// File patterns to include
const INCLUDE_PATTERNS = [
  /\.md$/,
  /\.txt$/,
  /\.json$/,
  /\.yaml$/,
  /\.yml$/,
  /\.toml$/,
  /rules$/,
  /config$/,
];

// Patterns to exclude
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /\.DS_Store/,
  /\.log$/,
  /cache/i,
  /history/i,
  /session/i,
  /debug/i,
  /\.lock$/,
  /stats-cache/,
  /telemetry/,
  /todos/,
];

function shouldIncludeFile(filePath: string): boolean {
  // Check excludes first
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(filePath)) return false;
  }
  
  // Check includes
  for (const pattern of INCLUDE_PATTERNS) {
    if (pattern.test(filePath)) return true;
  }
  
  return false;
}

async function scanDirectory(dir: string, basePath: string = ""): Promise<{ path: string; fullPath: string }[]> {
  const files: { path: string; fullPath: string }[] = [];
  
  if (!existsSync(dir)) return files;
  
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = basePath ? join(basePath, entry.name) : entry.name;
    
    if (entry.isDirectory()) {
      // Recurse into subdirectories
      const subFiles = await scanDirectory(fullPath, relativePath);
      files.push(...subFiles);
    } else if (entry.isFile() && shouldIncludeFile(relativePath)) {
      files.push({ path: relativePath, fullPath });
    }
  }
  
  return files;
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
    const files = result.rows as SyncedFile[];
    
    if (files.length === 0) {
      console.log(chalk.dim("No synced files yet."));
      console.log(chalk.dim(`Run ${chalk.cyan("memories files ingest")} to import config files.`));
      return;
    }
    
    // Group by scope
    const byScope = new Map<string, SyncedFile[]>();
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
      for (const { dir, name } of CONFIG_DIRS) {
        const globalDir = join(home, dir);
        const files = await scanDirectory(globalDir);
        for (const file of files) {
          filesToIngest.push({
            path: join(dir, file.path),
            fullPath: file.fullPath,
            scope: "global",
            source: name,
          });
        }
      }
    }
    
    // Scan project configs
    if (opts.project) {
      for (const { dir, name } of CONFIG_DIRS) {
        const projectDir = join(cwd, dir);
        const files = await scanDirectory(projectDir);
        for (const file of files) {
          filesToIngest.push({
            path: join(dir, file.path),
            fullPath: file.fullPath,
            scope: "project", // Will be resolved to git remote
            source: name,
          });
        }
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
          const existingFile = existing.rows[0] as { id: string; hash: string };
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
    const files = result.rows as SyncedFile[];
    
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
    
    const file = result.rows[0] as SyncedFile;
    
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
