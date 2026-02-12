import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { getDb, getConfigDir, repairFtsSchema } from "../lib/db.js";
import { getProjectId } from "../lib/git.js";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { getApiClient, readAuth } from "../lib/auth.js";

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; message: string }>;
}

const REQUIRED_FTS_TRIGGERS = ["memories_ai", "memories_ad", "memories_au"] as const;

export async function checkWritePath(db: Client): Promise<{ ok: boolean; message: string }> {
  const triggerResult = await db.execute(
    `SELECT name FROM sqlite_master
     WHERE type = 'trigger'
       AND name IN ('memories_ai', 'memories_ad', 'memories_au')`,
  );
  const present = new Set(triggerResult.rows.map((row) => String(row.name)));
  const missing = REQUIRED_FTS_TRIGGERS.filter((name) => !present.has(name));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing FTS trigger(s): ${missing.join(", ")}`,
    };
  }

  const probeId = `doctor_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    // Insert as soft-deleted first. If a subsequent update fails, this avoids leaving an active probe memory.
    await db.execute({
      sql: "INSERT INTO memories (id, content, scope, type, deleted_at) VALUES (?, ?, 'global', 'note', datetime('now'))",
      args: [probeId, "doctor write probe"],
    });

    // Bring active, then soft-delete again to exercise the same trigger path used by `forget`.
    await db.execute({
      sql: "UPDATE memories SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?",
      args: [probeId],
    });
    await db.execute({
      sql: "UPDATE memories SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      args: [probeId],
    });
    await db.execute({
      sql: "DELETE FROM memories WHERE id = ?",
      args: [probeId],
    });

    return { ok: true, message: "Insert/update/delete trigger path is healthy" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Write probe failed: ${message}` };
  } finally {
    try {
      await db.execute({
        sql: "DELETE FROM memories WHERE id = ?",
        args: [probeId],
      });
    } catch {
      // Best-effort cleanup only.
    }
  }
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
          name: "Write path",
          run: async () => {
            const db = await getDb();
            return checkWritePath(db);
          },
        },
        {
          name: "Cloud integration",
          run: async () => {
            const auth = await readAuth();
            if (!auth) {
              return { ok: true, message: "Not logged in (local-only mode). Run 'memories login' for cloud checks" };
            }

            try {
              const apiFetch = getApiClient(auth);
              const response = await apiFetch("/api/integration/health", {
                method: "GET",
              });

              if (!response.ok) {
                const text = await response.text();
                if (response.status === 404) {
                  return {
                    ok: true,
                    message: "Health endpoint unavailable on server (expected before latest web deploy)",
                  };
                }
                return {
                  ok: false,
                  message: `Health endpoint failed (${response.status}): ${text || response.statusText}`,
                };
              }

              const body = (await response.json()) as {
                health?: {
                  status?: "ok" | "degraded" | "error";
                  workspace?: { label?: string };
                  database?: { latencyMs?: number | null };
                  graph?: { health?: string };
                  issues?: string[];
                };
              };

              const health = body.health;
              if (!health) {
                return { ok: false, message: "Health endpoint returned malformed payload" };
              }

              const workspace = health.workspace?.label ?? "unknown";
              const latency =
                typeof health.database?.latencyMs === "number" ? `${health.database.latencyMs}ms` : "n/a";
              const graph = health.graph?.health ?? "unavailable";
              const issueCount = Array.isArray(health.issues) ? health.issues.length : 0;
              const status = health.status ?? "error";
              const ok = status === "ok";
              const issueSuffix = issueCount > 0 ? `, ${issueCount} issue(s)` : "";

              return {
                ok,
                message: `status=${status}, workspace=${workspace}, db=${latency}, graph=${graph}${issueSuffix}`,
              };
            } catch (error) {
              return {
                ok: false,
                message: `Cloud integration check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              };
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

        // Hard-repair FTS table + triggers and rebuild index from active records.
        try {
          await repairFtsSchema(db);
          console.log(`  ${chalk.green("✓")} Repaired FTS schema and rebuilt index`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.log(`  ${chalk.yellow("⚠")} Could not repair FTS schema: ${message}`);
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
