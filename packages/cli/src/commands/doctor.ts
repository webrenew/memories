import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { getDb, getConfigDir } from "../lib/db.js";
import { getProjectId } from "../lib/git.js";
import { join } from "node:path";

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; message: string }>;
}

export const doctorCommand = new Command("doctor")
  .description("Check memories health and diagnose issues")
  .option("--fix", "Attempt to fix issues found")
  .action(async (opts: { fix?: boolean }) => {
    try {
      console.log(chalk.bold("memories doctor\n"));

      const checks: Check[] = [
        {
          name: "Database file",
          run: async () => {
            const dbPath = join(getConfigDir(), "local.db");
            if (existsSync(dbPath)) {
              return { ok: true, message: `Found at ${dbPath}` };
            }
            return { ok: false, message: `Not found at ${dbPath}. Run: memories init` };
          },
        },
        {
          name: "Database connection",
          run: async () => {
            try {
              const db = await getDb();
              await db.execute("SELECT 1");
              return { ok: true, message: "Connected successfully" };
            } catch (e) {
              return { ok: false, message: `Connection failed: ${(e as Error).message}` };
            }
          },
        },
        {
          name: "Schema integrity",
          run: async () => {
            const db = await getDb();
            const result = await db.execute("PRAGMA integrity_check");
            const status = String(result.rows[0]?.integrity_check ?? "unknown");
            return status === "ok"
              ? { ok: true, message: "PRAGMA integrity_check: ok" }
              : { ok: false, message: `Integrity check failed: ${status}` };
          },
        },
        {
          name: "FTS index",
          run: async () => {
            const db = await getDb();
            try {
              // Verify FTS table exists and is queryable
              await db.execute(
                "SELECT rowid FROM memories_fts LIMIT 1",
              );
              // Verify search excludes soft-deleted records
              const leaked = await db.execute(`
                SELECT COUNT(*) as count FROM memories m
                JOIN memories_fts fts ON m.rowid = fts.rowid
                WHERE memories_fts MATCH '"*"' AND m.deleted_at IS NOT NULL
              `);
              const leakedCount = Number(leaked.rows[0]?.count ?? 0);
              if (leakedCount > 0) {
                return {
                  ok: false,
                  message: `${leakedCount} soft-deleted records still searchable via FTS`,
                };
              }
              const active = await db.execute(
                "SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL",
              );
              return { ok: true, message: `FTS operational, ${Number(active.rows[0]?.count ?? 0)} active memories indexed` };
            } catch {
              return { ok: false, message: "FTS table missing or corrupted" };
            }
          },
        },
        {
          name: "Git project detection",
          run: async () => {
            const projectId = getProjectId();
            if (projectId) {
              return { ok: true, message: `Detected: ${projectId}` };
            }
            return { ok: true, message: "Not in a git repo (global-only mode)" };
          },
        },
        {
          name: "Orphaned project memories",
          run: async () => {
            const db = await getDb();
            const result = await db.execute(
              "SELECT DISTINCT project_id FROM memories WHERE scope = 'project' AND deleted_at IS NULL AND project_id IS NOT NULL",
            );
            const projectIds = result.rows.map((r) => String(r.project_id));
            if (projectIds.length === 0) {
              return { ok: true, message: "No project memories found" };
            }
            return { ok: true, message: `${projectIds.length} project(s) with memories: ${projectIds.join(", ")}` };
          },
        },
        {
          name: "Soft-deleted records",
          run: async () => {
            const db = await getDb();
            const result = await db.execute(
              "SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NOT NULL",
            );
            const count = Number(result.rows[0]?.count ?? 0);
            if (count === 0) {
              return { ok: true, message: "No soft-deleted records" };
            }
            return { ok: true, message: `${count} soft-deleted records (run 'memories doctor --fix' to purge)` };
          },
        },
      ];

      let hasIssues = false;

      for (const check of checks) {
        const { ok, message } = await check.run();
        const icon = ok ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${icon} ${chalk.bold(check.name)}: ${message}`);
        if (!ok) hasIssues = true;
      }

      // Fix mode: purge deleted records and rebuild FTS
      if (opts.fix) {
        console.log(chalk.bold("\nRunning fixes...\n"));
        const db = await getDb();

        // Purge soft-deleted
        const purged = await db.execute(
          "DELETE FROM memories WHERE deleted_at IS NOT NULL",
        );
        console.log(`  ${chalk.green("✓")} Purged ${purged.rowsAffected} soft-deleted records`);

        // Rebuild FTS
        try {
          await db.execute("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
          console.log(`  ${chalk.green("✓")} Rebuilt FTS index`);
        } catch {
          console.log(`  ${chalk.yellow("⚠")} Could not rebuild FTS index`);
        }
      }

      console.log();
      if (hasIssues) {
        console.log(chalk.yellow("Some issues detected.") + (opts.fix ? "" : " Run with --fix to attempt repairs."));
      } else {
        console.log(chalk.green("All checks passed."));
      }
    } catch (error) {
      console.error(chalk.red("✗") + " Doctor failed:", error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });
