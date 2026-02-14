import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as ui from "../lib/ui.js";
import { getDb, syncDb, readSyncConfig } from "../lib/db.js";
import { getProjectId } from "../lib/git.js";
import { nanoid } from "nanoid";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import {
  type ListedFile,
  type ExistingFile,
  type ApplyFile,
  type ShowFile,
  hashContent,
  OPTIONAL_CONFIG_PATHS,
  OPTIONAL_CONFIG_INTEGRATIONS,
  REDACTED_PLACEHOLDER,
} from "./files-constants.js";

import {
  type ConfigVaultEntry,
  sanitizeOptionalConfig,
  hydrateOptionalConfig,
  configProjectId,
  pushConfigSecretsToVault,
  fetchConfigSecretsFromVault,
  scanAllTargets,
} from "./files-helpers.js";

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

    ui.success(`Removed ${path} from sync`);
  });
