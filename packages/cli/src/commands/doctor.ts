import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { getDb, getConfigDir, repairFtsSchema } from "../lib/db.js";
import { getProjectId } from "../lib/git.js";
import { getApiClient, readAuth } from "../lib/auth.js";
import { detectTools, toolSupportsMcp } from "../lib/setup.js";
import * as ui from "../lib/ui.js";

interface Check {
  id: string;
  code: string;
  category: DoctorCheckCategory;
  name: string;
  run: () => Promise<DoctorCheckOutcome>;
}

type CheckStatus = "pass" | "warn" | "fail";
type DoctorCheckCategory = "config" | "database" | "mcp" | "cloud" | "project" | "data";

interface DoctorCheckOutcome {
  status: CheckStatus;
  message: string;
  remediation?: string[];
  details?: Record<string, unknown>;
}

interface DoctorCheckResult extends DoctorCheckOutcome {
  id: string;
  code: string;
  category: DoctorCheckCategory;
  name: string;
}

interface DoctorReport {
  schemaVersion: "1.1";
  generatedAt: string;
  ok: boolean;
  summary: {
    passed: number;
    warned: number;
    failed: number;
  };
  checks: DoctorCheckResult[];
  nextSteps: string[];
  fixes: {
    applied: boolean;
    actions: string[];
    errors: string[];
  };
}

interface RunDoctorChecksOptions {
  fix?: boolean;
  localOnly?: boolean;
}

const REQUIRED_FTS_TRIGGERS = ["memories_ai", "memories_ad", "memories_au"] as const;

function statusIcon(status: CheckStatus): string {
  if (status === "pass") return chalk.green("✓");
  if (status === "warn") return chalk.yellow("⚠");
  return chalk.red("✗");
}

function normalizeRemediation(remediation: string[] | undefined): string[] {
  if (!Array.isArray(remediation)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const step of remediation.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(step)) continue;
    seen.add(step);
    normalized.push(step);
  }
  return normalized;
}

function buildNextSteps(checks: DoctorCheckResult[]): string[] {
  const prioritized = checks
    .filter((check) => check.status !== "pass")
    .sort((a, b) => {
      const severity = (status: CheckStatus) => (status === "fail" ? 0 : 1);
      const severityDelta = severity(a.status) - severity(b.status);
      if (severityDelta !== 0) return severityDelta;
      return a.name.localeCompare(b.name);
    });

  const nextSteps: string[] = [];
  const seen = new Set<string>();

  for (const check of prioritized) {
    for (const step of normalizeRemediation(check.remediation)) {
      if (seen.has(step)) continue;
      seen.add(step);
      nextSteps.push(step);
    }
  }

  return nextSteps;
}

function cloudIssueRemediation(issues: string[] | undefined): string[] {
  const base = [
    "Run: memories org current",
    "Run: memories doctor --fix",
    "Open dashboard and review Integration Health in /app",
  ];

  if (!Array.isArray(issues) || issues.length === 0) {
    return base;
  }

  const mapped = issues.map((issue) => {
    if (issue.toLowerCase().includes("database is not provisioned")) {
      return "Run: memories login (or provision a workspace DB from dashboard)";
    }
    if (issue.toLowerCase().includes("graph schema")) {
      return "Run a graph mapping sync by opening dashboard /app or running a memory migration copy once";
    }
    if (issue.toLowerCase().includes("graph mappings are empty")) {
      return "Run a memory migration copy personal -> org to rebuild graph mappings";
    }
    return "";
  });

  return normalizeRemediation([...base, ...mapped]);
}

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
    await db.execute({
      sql: "INSERT INTO memories (id, content, scope, type, deleted_at) VALUES (?, ?, 'global', 'note', datetime('now'))",
      args: [probeId, "doctor write probe"],
    });
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

function buildChecks(options: RunDoctorChecksOptions = {}): Check[] {
  return [
    {
      id: "config_file",
      code: "CONFIG_FILE_MISSING",
      category: "config",
      name: "Project config",
      run: async () => {
        const configPath = join(process.cwd(), ".agents", "config.yaml");
        if (existsSync(configPath)) {
          return { status: "pass", message: `Found at ${configPath}` };
        }
        return {
          status: "warn",
          message: `Missing at ${configPath}`,
          remediation: [
            "Run: memories setup",
            "Or create config manually: mkdir -p .agents && printf 'name: my-project\\nversion: 0.1.0\\n' > .agents/config.yaml",
          ],
        };
      },
    },
    {
      id: "db_file",
      code: "DB_FILE_MISSING",
      category: "database",
      name: "Database file",
      run: async () => {
        const dbPath = join(getConfigDir(), "local.db");
        if (existsSync(dbPath)) {
          return { status: "pass", message: `Found at ${dbPath}` };
        }
        return {
          status: "fail",
          message: `Not found at ${dbPath}`,
          remediation: [
            "Run: memories setup",
            "If this persists, remove stale config dir and retry setup",
          ],
        };
      },
    },
    {
      id: "db_connection",
      code: "DB_CONNECTION_FAILED",
      category: "database",
      name: "Database connection",
      run: async () => {
        try {
          const db = await getDb();
          await db.execute("SELECT 1");
          return { status: "pass", message: "Connected successfully" };
        } catch (error) {
          return {
            status: "fail",
            message: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            remediation: [
              "Run: memories doctor --fix",
              "If unresolved, run: memories setup",
            ],
          };
        }
      },
    },
    {
      id: "schema_integrity",
      code: "DB_INTEGRITY_FAILED",
      category: "database",
      name: "Schema integrity",
      run: async () => {
        const db = await getDb();
        const result = await db.execute("PRAGMA integrity_check");
        const status = String(result.rows[0]?.integrity_check ?? "unknown");
        if (status === "ok") {
          return { status: "pass", message: "PRAGMA integrity_check: ok" };
        }
        return {
          status: "fail",
          message: `Integrity check failed: ${status}`,
          remediation: [
            "Run: memories doctor --fix",
            "If unresolved, backup and recreate local DB with memories setup",
          ],
        };
      },
    },
    {
      id: "fts_index",
      code: "FTS_INDEX_UNHEALTHY",
      category: "database",
      name: "FTS index",
      run: async () => {
        const db = await getDb();
        try {
          await db.execute("SELECT rowid FROM memories_fts LIMIT 1");
          const leaked = await db.execute(`
            SELECT COUNT(*) as count FROM memories m
            JOIN memories_fts fts ON m.rowid = fts.rowid
            WHERE memories_fts MATCH '"*"' AND m.deleted_at IS NOT NULL
          `);
          const leakedCount = Number(leaked.rows[0]?.count ?? 0);
          if (leakedCount > 0) {
            return {
              status: "fail",
              message: `${leakedCount} soft-deleted records still searchable via FTS`,
              remediation: ["Run: memories doctor --fix"],
            };
          }
          const active = await db.execute(
            "SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NULL",
          );
          return {
            status: "pass",
            message: `FTS operational, ${Number(active.rows[0]?.count ?? 0)} active memories indexed`,
          };
        } catch {
          return {
            status: "fail",
            message: "FTS table missing or corrupted",
            remediation: ["Run: memories doctor --fix"],
          };
        }
      },
    },
    {
      id: "write_path",
      code: "DB_WRITE_PATH_UNHEALTHY",
      category: "database",
      name: "Write path",
      run: async () => {
        const db = await getDb();
        const probe = await checkWritePath(db);
        if (probe.ok) {
          return { status: "pass", message: probe.message };
        }
        return {
          status: "fail",
          message: probe.message,
          remediation: [
            "Run: memories doctor --fix",
            "If unresolved, run: memories setup",
          ],
        };
      },
    },
    {
      id: "mcp_wiring",
      code: "MCP_WIRING_INCOMPLETE",
      category: "mcp",
      name: "MCP wiring",
      run: async () => {
        const detected = detectTools(process.cwd());
        const mcpTools = detected.filter((item) => toolSupportsMcp(item.tool));

        if (detected.length === 0) {
          return {
            status: "warn",
            message: "No supported integration config directories detected (e.g. .cursor, .claude, .windsurf, .vscode, .opencode, .factory, .agents)",
            remediation: [
              "Create or open your tool config directory, then run: memories setup",
              "Or configure manually with: memories init --skip-generate",
            ],
          };
        }

        if (mcpTools.length === 0) {
          return {
            status: "warn",
            message: "Detected integrations do not expose MCP config files (rules-only setup)",
            remediation: [
              "Run: memories setup and include a tool with MCP support (Cursor, Claude Code, Windsurf, VS Code, OpenCode, Factory, Amp)",
              "Or configure an MCP-capable tool manually, then rerun: memories doctor",
            ],
          };
        }

        const missing = mcpTools.filter((tool) => !tool.hasMcp).map((tool) => tool.tool.name);
        if (missing.length > 0) {
          return {
            status: "fail",
            message: `Missing MCP config for: ${missing.join(", ")}`,
            remediation: [
              "Run: memories setup",
              "Then verify by restarting your editor/tool",
            ],
          };
        }

        const configured = mcpTools.map((tool) => tool.tool.name).join(", ");
        return {
          status: "pass",
          message: `MCP configured for: ${configured}`,
        };
      },
    },
    {
      id: "cloud_integration",
      code: "CLOUD_INTEGRATION_UNHEALTHY",
      category: "cloud",
      name: "Cloud integration",
      run: async () => {
        if (options.localOnly) {
          return {
            status: "pass",
            message: "Skipped cloud checks (local-only mode)",
            details: {
              localOnly: true,
            },
          };
        }

        const auth = await readAuth();
        if (!auth) {
          return {
            status: "warn",
            message: "Not logged in (local-only mode)",
            remediation: [
              "Run: memories login",
              "Or rerun explicitly in local mode: memories doctor --local-only",
            ],
          };
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
                status: "warn",
                message: "Health endpoint unavailable on server (expected before latest web deploy)",
                remediation: [
                  "Deploy latest web API, then rerun: memories doctor",
                  "Until then, use local checks and dashboard basics",
                ],
              };
            }
            if (response.status === 401 || response.status === 403) {
              return {
                status: "fail",
                message: "Cloud auth rejected by API",
                remediation: [
                  "Run: memories logout",
                  "Run: memories login",
                ],
              };
            }
            return {
              status: "fail",
              message: `Health endpoint failed (${response.status}): ${text || response.statusText}`,
              remediation: [
                "Check internet/API URL and rerun: memories doctor",
                "If persistent, run: memories login",
              ],
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
            return {
              status: "fail",
              message: "Health endpoint returned malformed payload",
              remediation: [
                "Update to latest CLI and web deploy, then rerun: memories doctor",
              ],
            };
          }

          const workspace = health.workspace?.label ?? "unknown";
          const latency =
            typeof health.database?.latencyMs === "number" ? `${health.database.latencyMs}ms` : "n/a";
          const graph = health.graph?.health ?? "unavailable";
          const issueCount = Array.isArray(health.issues) ? health.issues.length : 0;
          const status = health.status ?? "error";

          if (status === "ok") {
            return {
              status: "pass",
              message: `status=ok, workspace=${workspace}, db=${latency}, graph=${graph}`,
            };
          }

          const remediation = cloudIssueRemediation(health.issues);
          if (status === "degraded") {
            return {
              status: "warn",
              message: `status=degraded, workspace=${workspace}, db=${latency}, graph=${graph}, ${issueCount} issue(s)`,
              remediation,
            };
          }

          return {
            status: "fail",
            message: `status=error, workspace=${workspace}, db=${latency}, graph=${graph}, ${issueCount} issue(s)`,
            remediation,
          };
        } catch (error) {
          return {
            status: "fail",
            message: `Cloud integration check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            remediation: [
              "Check network connectivity",
              "Run: memories login",
            ],
          };
        }
      },
    },
    {
      id: "git_project_detection",
      code: "PROJECT_DETECTION_INACTIVE",
      category: "project",
      name: "Git project detection",
      run: async () => {
        const projectId = getProjectId();
        if (projectId) {
          return { status: "pass", message: `Detected: ${projectId}` };
        }
        return { status: "pass", message: "Not in a git repo (global-only mode)" };
      },
    },
    {
      id: "orphaned_project_memories",
      code: "PROJECT_MEMORIES_PRESENT",
      category: "project",
      name: "Orphaned project memories",
      run: async () => {
        const db = await getDb();
        const result = await db.execute(
          "SELECT DISTINCT project_id FROM memories WHERE scope = 'project' AND deleted_at IS NULL AND project_id IS NOT NULL",
        );
        const projectIds = result.rows.map((row) => String(row.project_id));
        if (projectIds.length === 0) {
          return { status: "pass", message: "No project memories found" };
        }
        return {
          status: "pass",
          message: `${projectIds.length} project(s) with memories: ${projectIds.join(", ")}`,
        };
      },
    },
    {
      id: "soft_deleted_records",
      code: "SOFT_DELETED_RECORDS_FOUND",
      category: "data",
      name: "Soft-deleted records",
      run: async () => {
        const db = await getDb();
        const result = await db.execute("SELECT COUNT(*) as count FROM memories WHERE deleted_at IS NOT NULL");
        const count = Number(result.rows[0]?.count ?? 0);
        if (count === 0) {
          return { status: "pass", message: "No soft-deleted records" };
        }
        return {
          status: "warn",
          message: `${count} soft-deleted records`,
          remediation: ["Run: memories doctor --fix"],
        };
      },
    },
  ];
}

export async function runDoctorChecks(options: RunDoctorChecksOptions = {}): Promise<DoctorReport> {
  const checks = buildChecks(options);
  const results: DoctorCheckResult[] = [];
  const fixes: DoctorReport["fixes"] = {
    applied: false,
    actions: [],
    errors: [],
  };

  for (const check of checks) {
    const outcome = await check.run();
    results.push({
      id: check.id,
      code: check.code,
      category: check.category,
      name: check.name,
      status: outcome.status,
      message: outcome.message,
      remediation: normalizeRemediation(outcome.remediation),
      details: outcome.details,
    });
  }

  if (options.fix) {
    fixes.applied = true;
    const db = await getDb();
    try {
      const purged = await db.execute("DELETE FROM memories WHERE deleted_at IS NOT NULL");
      fixes.actions.push(`Purged ${purged.rowsAffected} soft-deleted records`);
    } catch (error) {
      fixes.errors.push(`Failed to purge soft-deleted records: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    try {
      await repairFtsSchema(db);
      fixes.actions.push("Repaired FTS schema and rebuilt index");
    } catch (error) {
      fixes.errors.push(`Failed to repair FTS schema: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  const passed = results.filter((result) => result.status === "pass").length;
  const warned = results.filter((result) => result.status === "warn").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const ok = failed === 0;
  const nextSteps = buildNextSteps(results);

  return {
    schemaVersion: "1.1",
    generatedAt: new Date().toISOString(),
    ok,
    summary: {
      passed,
      warned,
      failed,
    },
    checks: results,
    nextSteps,
    fixes,
  };
}

function printDoctorReport(report: DoctorReport, fixRequested: boolean): void {
  for (const check of report.checks) {
    const icon = statusIcon(check.status);
    const code = chalk.dim(`[${check.code}]`);
    console.log(`  ${icon} ${chalk.bold(check.name)} ${code}: ${check.message}`);
    if ((check.status === "warn" || check.status === "fail") && check.remediation && check.remediation.length > 0) {
      for (const step of check.remediation) {
        console.log(chalk.dim(`     ↳ ${step}`));
      }
    }
  }

  if (report.fixes.applied) {
    console.log(chalk.bold("\nFix actions:\n"));
    for (const action of report.fixes.actions) {
      console.log(`  ${chalk.green("✓")} ${action}`);
    }
    for (const error of report.fixes.errors) {
      console.log(`  ${chalk.yellow("⚠")} ${error}`);
    }
  }

  if (report.nextSteps.length > 0) {
    console.log(chalk.bold("\nNext steps:\n"));
    for (const step of report.nextSteps) {
      console.log(chalk.dim(`  • ${step}`));
    }
  }

  console.log();
  if (report.summary.failed > 0) {
    console.log(chalk.red("Critical issues detected.") + (fixRequested ? "" : " Run with --fix to attempt repairs."));
    return;
  }

  if (report.summary.warned > 0) {
    console.log(chalk.yellow("Checks passed with warnings.") + (fixRequested ? "" : " Review remediation steps above."));
    return;
  }

  console.log(chalk.green("All checks passed."));
}

export const doctorCommand = new Command("doctor")
  .description("Check memories health and diagnose issues")
  .option("--fix", "Attempt to fix issues found")
  .option("--json", "Output machine-readable JSON report")
  .option("--local-only", "Skip cloud health checks and treat local mode as healthy")
  .option("--strict", "Exit with code 1 when warnings or failures are present")
  .action(async (opts: { fix?: boolean; json?: boolean; strict?: boolean; localOnly?: boolean }) => {
    try {
      if (!opts.json) {
        console.log(chalk.bold("memories doctor\n"));
      }

      const report = await runDoctorChecks({
        fix: opts.fix,
        localOnly: opts.localOnly,
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printDoctorReport(report, Boolean(opts.fix));
      }

      if (opts.strict && (report.summary.failed > 0 || report.summary.warned > 0)) {
        process.exitCode = 1;
      }
    } catch (error) {
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              schemaVersion: "1.1",
              ok: false,
              summary: {
                passed: 0,
                warned: 0,
                failed: 1,
              },
              checks: [],
              nextSteps: ["Run: memories setup", "Retry: memories doctor --json"],
              fixes: {
                applied: Boolean(opts.fix),
                actions: [],
                errors: [],
              },
              error: {
                code: "DOCTOR_EXECUTION_FAILED",
                message: error instanceof Error ? error.message : "Unknown error",
              },
            },
            null,
            2,
          ),
        );
      } else {
        ui.error("Doctor failed: " + (error instanceof Error ? error.message : "Unknown error"));
      }
      process.exit(1);
    }
  });
