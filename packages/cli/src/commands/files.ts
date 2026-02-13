import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getDb, syncDb, readSyncConfig } from "../lib/db.js";
import { readAuth, getApiClient } from "../lib/auth.js";
import { getProjectId } from "../lib/git.js";
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

// Optional app-level config files. These can include credentials or environment-specific settings.
const OPTIONAL_CONFIG_TARGETS = [
  { dir: ".config/opencode", files: ["opencode.json"] },
  { dir: ".openclaw", files: ["openclaw.json"] },
];

interface SyncTarget {
  dir: string;
  files?: string[];
  pattern?: RegExp;
  recurse?: boolean;
}

function getSyncTargets(includeConfig: boolean): readonly SyncTarget[] {
  return includeConfig
    ? [...SYNC_TARGETS, ...OPTIONAL_CONFIG_TARGETS]
    : SYNC_TARGETS;
}

function listOptionalConfigPaths(): string[] {
  const paths: string[] = [];
  for (const target of OPTIONAL_CONFIG_TARGETS) {
    if (!target.files) continue;
    for (const file of target.files) {
      paths.push(join(target.dir, file));
    }
  }
  return paths;
}

const OPTIONAL_CONFIG_PATHS = new Set(listOptionalConfigPaths());
const OPTIONAL_CONFIG_INTEGRATIONS = new Map<string, string>([
  [join(".config/opencode", "opencode.json"), "opencode"],
  [join(".openclaw", "openclaw.json"), "openclaw"],
]);
const REDACTED_PLACEHOLDER = "[REDACTED]";
const CLOUD_AUTH_REQUIRED_MESSAGE =
  "Cloud config secret sync requires login. Run memories login, or use local-only mode (omit --include-config).";
const SENSITIVE_CONFIG_KEY_PATTERN = [
  "token",
  "secret",
  "password",
  "passphrase",
  "api[_-]?key",
  "private[_-]?key",
  "client[_-]?secret",
  "access[_-]?token",
  "refresh[_-]?token",
  "authorization",
  "cookie",
].join("|");
const SENSITIVE_DOUBLE_QUOTED_VALUE_RE = new RegExp(
  `("([^"\\\\]*(?:${SENSITIVE_CONFIG_KEY_PATTERN})[^"\\\\]*)"\\s*:\\s*)"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`,
  "gi",
);
const SENSITIVE_SINGLE_QUOTED_VALUE_RE = new RegExp(
  `('([^'\\\\]*(?:${SENSITIVE_CONFIG_KEY_PATTERN})[^'\\\\]*)'\\s*:\\s*)'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'`,
  "gi",
);

interface OptionalConfigSanitization {
  content: string;
  redactions: number;
  secrets: Record<string, string>;
}

interface ConfigVaultEntry {
  scope: "global" | "project";
  project_id?: string;
  integration: string;
  config_path: string;
  secrets: Record<string, string>;
}

interface VaultOperationResult {
  error?: string;
  proRequired?: boolean;
  unauthenticated?: boolean;
}

function sanitizeOptionalConfig(path: string, content: string): OptionalConfigSanitization {
  if (!OPTIONAL_CONFIG_PATHS.has(path)) {
    return { content, redactions: 0, secrets: {} };
  }

  const secrets: Record<string, string> = {};
  let redactions = 0;
  let sanitized = content.replace(SENSITIVE_DOUBLE_QUOTED_VALUE_RE, (_match, prefix, key, value) => {
    if (typeof key === "string" && typeof value === "string") {
      secrets[key] = value;
    }
    redactions += 1;
    return `${prefix}"${REDACTED_PLACEHOLDER}"`;
  });

  sanitized = sanitized.replace(SENSITIVE_SINGLE_QUOTED_VALUE_RE, (_match, prefix, key, value) => {
    if (typeof key === "string" && typeof value === "string") {
      secrets[key] = value;
    }
    redactions += 1;
    return `${prefix}'${REDACTED_PLACEHOLDER}'`;
  });

  return { content: sanitized, redactions, secrets };
}

function hydrateOptionalConfig(path: string, content: string, secrets: Record<string, string>): { content: string; hydrated: number } {
  if (!OPTIONAL_CONFIG_PATHS.has(path)) {
    return { content, hydrated: 0 };
  }

  let hydrated = 0;
  let out = content.replace(SENSITIVE_DOUBLE_QUOTED_VALUE_RE, (match, prefix, key, value) => {
    if (value !== REDACTED_PLACEHOLDER) return match;
    const secret = secrets[key];
    if (typeof secret !== "string" || secret.length === 0) return match;
    hydrated += 1;
    return `${prefix}"${secret}"`;
  });

  out = out.replace(SENSITIVE_SINGLE_QUOTED_VALUE_RE, (match, prefix, key, value) => {
    if (value !== REDACTED_PLACEHOLDER) return match;
    const secret = secrets[key];
    if (typeof secret !== "string" || secret.length === 0) return match;
    hydrated += 1;
    return `${prefix}'${secret}'`;
  });

  return { content: out, hydrated };
}

function configProjectId(scope: string, cwd: string): string | null {
  if (scope === "global") return null;
  return getProjectId(cwd);
}

async function pushConfigSecretsToVault(entries: ConfigVaultEntry[]): Promise<{ synced: number } & VaultOperationResult> {
  if (entries.length === 0) return { synced: 0 };

  const auth = await readAuth();
  if (!auth) {
    return { synced: 0, unauthenticated: true, error: CLOUD_AUTH_REQUIRED_MESSAGE };
  }

  const apiFetch = getApiClient(auth);
  const response = await apiFetch("/api/files/config-secrets", {
    method: "POST",
    body: JSON.stringify({ entries }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    if (response.status === 403) {
      return {
        synced: 0,
        proRequired: true,
        error: bodyText || "Vault-backed config secret sync is a Pro feature.",
      };
    }
    return {
      synced: 0,
      error: bodyText || `Failed to sync config secrets (${response.status})`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as { synced?: number };
  return { synced: payload.synced ?? 0 };
}

async function fetchConfigSecretsFromVault(params: {
  scope: "global" | "project";
  projectId?: string | null;
  integration: string;
  configPath: string;
}): Promise<{ secrets: Record<string, string> } & VaultOperationResult> {
  const auth = await readAuth();
  if (!auth) {
    return { secrets: {}, unauthenticated: true, error: CLOUD_AUTH_REQUIRED_MESSAGE };
  }

  const apiFetch = getApiClient(auth);
  const query = new URLSearchParams({
    scope: params.scope,
    integration: params.integration,
    config_path: params.configPath,
  });
  if (params.scope === "project" && params.projectId) {
    query.set("project_id", params.projectId);
  }

  const response = await apiFetch(`/api/files/config-secrets?${query.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    if (response.status === 403) {
      return {
        secrets: {},
        proRequired: true,
        error: bodyText || "Vault-backed config secret hydration is a Pro feature.",
      };
    }
    if (response.status === 404) {
      return { secrets: {} };
    }
    return {
      secrets: {},
      error: bodyText || `Failed to fetch config secrets (${response.status})`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as { secrets?: Record<string, string> };
  return { secrets: payload.secrets ?? {} };
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

async function scanAllTargets(
  baseDir: string,
  options: { includeConfig?: boolean } = {},
): Promise<{ path: string; fullPath: string; source: string }[]> {
  const { includeConfig = false } = options;
  const results: { path: string; fullPath: string; source: string }[] = [];
  const targets = getSyncTargets(includeConfig);
  
  for (const target of targets) {
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
  .option(
    "--include-config",
    "Include app-level config JSON files (for example ~/.openclaw/openclaw.json)",
  )
  .option("--dry-run", "Show what would be imported without making changes")
  .action(async (opts) => {
    const db = await getDb();
    const home = homedir();
    const cwd = process.cwd();
    const includeConfig = Boolean(opts.includeConfig);
    const projectId = getProjectId(cwd);
    
    const filesToIngest: { path: string; fullPath: string; scope: string; source: string }[] = [];
    
    // Scan global configs
    if (opts.global !== false) {
      const files = await scanAllTargets(home, { includeConfig });
      for (const file of files) {
        filesToIngest.push({
          ...file,
          scope: "global",
        });
      }
    }
    
    // Scan project configs
    if (opts.project) {
      const files = await scanAllTargets(cwd, { includeConfig });
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
    let redactedFileCount = 0;
    let redactedValueCount = 0;
    const vaultEntries: ConfigVaultEntry[] = [];
    
    for (const file of filesToIngest) {
      try {
        let content = await readFile(file.fullPath, "utf-8");
        const sanitized = sanitizeOptionalConfig(file.path, content);
        content = sanitized.content;
        if (sanitized.redactions > 0) {
          redactedFileCount += 1;
          redactedValueCount += sanitized.redactions;
          if (includeConfig && Object.keys(sanitized.secrets).length > 0) {
            const integration = OPTIONAL_CONFIG_INTEGRATIONS.get(file.path);
            if (integration) {
              const scope = file.scope === "global" ? "global" : "project";
              const scopedProjectId = scope === "project" ? projectId : null;
              if (scope === "global" || scopedProjectId) {
                const entry: ConfigVaultEntry = {
                  scope,
                  integration,
                  config_path: file.path,
                  secrets: sanitized.secrets,
                };
                if (scope === "project" && scopedProjectId) {
                  entry.project_id = scopedProjectId;
                }
                vaultEntries.push(entry);
              }
            }
          }
        }
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
    if (redactedFileCount > 0) {
      console.log(
        chalk.yellow(
          `Redacted ${redactedValueCount} sensitive value${redactedValueCount === 1 ? "" : "s"} in ${redactedFileCount} config file${redactedFileCount === 1 ? "" : "s"}.`,
        ),
      );
      console.log(chalk.dim("Store secrets in Supabase Vault (or env vars), not in synced memory/file stores."));
      if (includeConfig && vaultEntries.length > 0) {
        const vaultResult = await pushConfigSecretsToVault(vaultEntries);
        if (vaultResult.synced > 0) {
          console.log(chalk.green(`Synced ${vaultResult.synced} config secret value${vaultResult.synced === 1 ? "" : "s"} to Vault.`));
        } else if (vaultResult.error) {
          const message = vaultResult.error.includes("{")
            ? "Failed to sync config secrets to Vault."
            : vaultResult.error;
          console.log(chalk.red(message));
          if (vaultResult.proRequired) {
            console.log(chalk.dim("Upgrade to Pro to enable scoped Vault-backed config secret sync."));
          } else if (vaultResult.unauthenticated) {
            process.exitCode = 1;
          }
        }
      } else if (includeConfig && opts.project && !projectId) {
        console.log(chalk.yellow("Skipped project-scoped Vault sync for config secrets (no git project id detected)."));
      }
    }
  });

// Push local files to disk (apply synced files)
filesCommand
  .command("apply")
  .description("Write synced files to disk (restore from cloud)")
  .option("-g, --global", "Apply global files to home directory")
  .option("-p, --project", "Apply project files to current directory")
  .option(
    "--include-config",
    "Include app-level config JSON files (for example ~/.openclaw/openclaw.json)",
  )
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
    const includeConfig = Boolean(opts.includeConfig);
    const projectId = getProjectId(cwd);
    const files = (result.rows as unknown as ApplyFile[]).filter((file) =>
      includeConfig || !OPTIONAL_CONFIG_PATHS.has(file.path),
    );
    
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
    let appliedRedactedConfigs = 0;
    let hydratedSecretValues = 0;
    let hydrationWarnings = 0;
    let hasAuthErrors = false;
    
    for (const file of files) {
      const baseDir = file.scope === "global" ? home : cwd;
      const targetPath = join(baseDir, file.path);
      let contentToWrite = file.content;

      if (
        includeConfig &&
        OPTIONAL_CONFIG_PATHS.has(file.path) &&
        contentToWrite.includes(REDACTED_PLACEHOLDER)
      ) {
        const integration = OPTIONAL_CONFIG_INTEGRATIONS.get(file.path);
        if (integration) {
          const scope = file.scope === "global" ? "global" : "project";
          const scopedProjectId = configProjectId(file.scope, cwd);
          if (scope === "global" || scopedProjectId) {
            const secretResult = await fetchConfigSecretsFromVault({
              scope,
              projectId: scopedProjectId,
              integration,
              configPath: file.path,
            });
            if (Object.keys(secretResult.secrets).length > 0) {
              const hydrated = hydrateOptionalConfig(file.path, contentToWrite, secretResult.secrets);
              contentToWrite = hydrated.content;
              hydratedSecretValues += hydrated.hydrated;
            } else if (secretResult.error) {
              hydrationWarnings += 1;
              const fallbackMessage = secretResult.error.includes("{")
                ? `Could not hydrate ${file.path} from Vault.`
                : secretResult.error;
              if (secretResult.unauthenticated) {
                hasAuthErrors = true;
              }
              const color = secretResult.unauthenticated ? chalk.red : chalk.yellow;
              console.log(color(fallbackMessage));
              if (secretResult.proRequired) {
                console.log(chalk.dim("Upgrade to Pro to enable scoped Vault-backed config secret hydration."));
              }
            }
          }
        }
      }
      
      // Check if file exists and we're not forcing
      if (existsSync(targetPath) && !opts.force) {
        const existingContent = await readFile(targetPath, "utf-8");
        const existingHash = hashContent(existingContent);
        const newHash = hashContent(contentToWrite);
        
        if (existingHash !== newHash) {
          skippedExisting++;
          continue;
        }
      }
      
      // Ensure directory exists
      await mkdir(dirname(targetPath), { recursive: true });
      
      // Write file
      await writeFile(targetPath, contentToWrite, "utf-8");
      written++;
      if (OPTIONAL_CONFIG_PATHS.has(file.path) && contentToWrite.includes(REDACTED_PLACEHOLDER)) {
        appliedRedactedConfigs += 1;
      }
    }
    
    if (skippedExisting > 0) {
      spinner.succeed(`Applied ${written} files, skipped ${skippedExisting} (use --force to overwrite)`);
    } else {
      spinner.succeed(`Applied ${written} files`);
    }
    if (appliedRedactedConfigs > 0) {
      console.log(
        chalk.yellow(
          `Applied ${appliedRedactedConfigs} config file${appliedRedactedConfigs === 1 ? "" : "s"} with redacted secret placeholders.`,
        ),
      );
      console.log(chalk.dim("Populate any remaining placeholders from Supabase Vault (or env vars) after apply."));
    }
    if (hydratedSecretValues > 0) {
      console.log(chalk.green(`Hydrated ${hydratedSecretValues} config secret value${hydratedSecretValues === 1 ? "" : "s"} from Vault.`));
    }
    if (includeConfig && opts.project && !projectId) {
      console.log(chalk.yellow("Project-scoped config secret hydration was skipped (no git project id detected)."));
    }
    if (hydrationWarnings > 0) {
      console.log(chalk.dim(`Config secret hydration completed with ${hydrationWarnings} warning${hydrationWarnings === 1 ? "" : "s"}.`));
    }
    if (hasAuthErrors) {
      process.exitCode = 1;
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
