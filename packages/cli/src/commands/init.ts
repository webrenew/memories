import { Command } from "commander";
import chalk from "chalk";
import { confirm, checkbox, select } from "@inquirer/prompts";
import { getDb, getConfigDir } from "../lib/db.js";
import { getProjectId, getGitRoot } from "../lib/git.js";
import { addMemory } from "../lib/memory.js";
import { readAuth, getApiClient } from "../lib/auth.js";
import {
  detectTools,
  getAllTools,
  setupMcp,
  toolSupportsGeneration,
  toolSupportsMcp,
  type DetectedTool,
  type Tool,
} from "../lib/setup.js";
import { initConfig } from "../lib/config.js";
import {
  dedupKey,
  ingestSkills,
  PROJECT_SKILLS_DIRS,
  type IngestResult,
} from "../lib/ingest-helpers.js";
import { runDoctorChecks } from "./doctor.js";
import * as ui from "../lib/ui.js";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_API_URL = "https://memories.sh";
const PERSONAL_WORKSPACE_VALUE = "__personal_workspace__";
type SetupMode = "auto" | "local" | "cloud";
type SetupScope = "auto" | "project" | "global";

interface SetupOrganization {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
}

interface SetupUserProfile {
  id: string;
  email: string;
  current_org_id: string | null;
}

interface SetupOrganizationsResponse {
  organizations: SetupOrganization[];
}

interface SetupUserResponse {
  user: SetupUserProfile;
}

interface ResolvedWorkspaceTarget {
  orgId: string | null;
  label: string;
}

interface IntegrationHealthResponse {
  health?: {
    workspace?: {
      label?: string;
      hasDatabase?: boolean;
      canProvision?: boolean;
      ownerType?: "user" | "organization" | null;
    };
  };
}

function normalizeWorkspaceTarget(target: string): string {
  return target.trim().toLowerCase();
}

function isPersonalWorkspaceTarget(target: string): boolean {
  const normalized = normalizeWorkspaceTarget(target);
  return normalized === "personal" || normalized === "none";
}

function resolveWorkspaceTarget(
  organizations: SetupOrganization[],
  rawTarget: string,
): ResolvedWorkspaceTarget {
  if (isPersonalWorkspaceTarget(rawTarget)) {
    return {
      orgId: null,
      label: "Personal workspace",
    };
  }

  const target = normalizeWorkspaceTarget(rawTarget);
  const directMatch = organizations.find(
    (org) => org.id === rawTarget || normalizeWorkspaceTarget(org.slug) === target,
  );
  if (directMatch) {
    return {
      orgId: directMatch.id,
      label: `${directMatch.name} (${directMatch.slug})`,
    };
  }

  const exactNameMatches = organizations.filter(
    (org) => normalizeWorkspaceTarget(org.name) === target,
  );
  if (exactNameMatches.length === 1) {
    const org = exactNameMatches[0];
    return {
      orgId: org.id,
      label: `${org.name} (${org.slug})`,
    };
  }

  if (exactNameMatches.length > 1) {
    throw new Error(
      `Multiple organizations match "${rawTarget}". Use the organization slug or ID.`,
    );
  }

  const prefixSlugMatches = organizations.filter((org) =>
    normalizeWorkspaceTarget(org.slug).startsWith(target),
  );
  if (prefixSlugMatches.length === 1) {
    const org = prefixSlugMatches[0];
    return {
      orgId: org.id,
      label: `${org.name} (${org.slug})`,
    };
  }

  if (prefixSlugMatches.length > 1) {
    throw new Error(`Multiple organizations match "${rawTarget}". Be more specific.`);
  }

  throw new Error(
    `Organization "${rawTarget}" not found. Run ${chalk.cyan("memories org list")} for available targets.`,
  );
}

function workspaceLabel(organizations: SetupOrganization[], orgId: string | null): string {
  if (!orgId) return "Personal workspace";
  const org = organizations.find((item) => item.id === orgId);
  if (!org) return `Organization (${orgId})`;
  return `${org.name} (${org.slug})`;
}

function parseSetupMode(rawMode: string | undefined): SetupMode {
  if (!rawMode) return "auto";
  const normalized = rawMode.trim().toLowerCase();
  if (normalized === "auto" || normalized === "local" || normalized === "cloud") {
    return normalized;
  }
  throw new Error(`Invalid setup mode "${rawMode}". Use one of: auto, local, cloud.`);
}

function parseSetupScope(rawScope: string | undefined): SetupScope {
  if (!rawScope) return "auto";
  const normalized = rawScope.trim().toLowerCase();
  if (normalized === "auto" || normalized === "project" || normalized === "global") {
    return normalized;
  }
  throw new Error(`Invalid scope "${rawScope}". Use one of: auto, project, global.`);
}

async function buildExistingMemoryDedupSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const db = await getDb();
  const result = await db.execute("SELECT content, paths FROM memories WHERE deleted_at IS NULL");

  for (const row of result.rows) {
    const content = String(row.content);
    const pathsStr = row.paths ? String(row.paths) : null;
    const paths = pathsStr
      ? pathsStr.split(",").map((p) => p.trim()).filter(Boolean)
      : undefined;

    set.add(dedupKey(content));
    if (paths && paths.length > 0) {
      set.add(dedupKey(content, paths));
    }
  }

  return set;
}

async function importProjectSkillsAsMemories(cwd: string): Promise<IngestResult> {
  const existingSet = await buildExistingMemoryDedupSet();
  return ingestSkills(cwd, PROJECT_SKILLS_DIRS, { existingSet, silent: true });
}

function selectedTool(tool: Tool): DetectedTool {
  return {
    tool,
    hasConfig: false,
    hasMcp: false,
    hasInstructions: false,
    globalConfig: false,
  };
}

async function fetchOrganizationsAndProfile(apiFetch: ReturnType<typeof getApiClient>): Promise<{
  organizations: SetupOrganization[];
  user: SetupUserProfile;
}> {
  const [orgsRes, userRes] = await Promise.all([
    apiFetch("/api/orgs"),
    apiFetch("/api/user"),
  ]);

  if (!orgsRes.ok) {
    const text = await orgsRes.text();
    throw new Error(`Failed to fetch organizations: ${text || orgsRes.statusText}`);
  }

  if (!userRes.ok) {
    const text = await userRes.text();
    throw new Error(`Failed to fetch user profile: ${text || userRes.statusText}`);
  }

  const orgsBody = (await orgsRes.json()) as SetupOrganizationsResponse;
  const userBody = (await userRes.json()) as SetupUserResponse;

  return {
    organizations: orgsBody.organizations ?? [],
    user: userBody.user,
  };
}

async function switchWorkspace(
  apiFetch: ReturnType<typeof getApiClient>,
  orgId: string | null,
): Promise<void> {
  const response = await apiFetch("/api/user", {
    method: "PATCH",
    body: JSON.stringify({ current_org_id: orgId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to switch workspace: ${text || response.statusText}`);
  }
}

async function fetchIntegrationHealth(
  apiFetch: ReturnType<typeof getApiClient>,
): Promise<IntegrationHealthResponse | null> {
  const response = await apiFetch("/api/integration/health", { method: "GET" });
  if (!response.ok) return null;
  return (await response.json()) as IntegrationHealthResponse;
}

async function provisionWorkspaceDatabase(
  apiFetch: ReturnType<typeof getApiClient>,
): Promise<boolean> {
  const response = await apiFetch("/api/db/provision", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return response.ok;
}

export const initCommand = new Command("init")
  .alias("setup")
  .description("Initialize memories - set up MCP and instruction files for your AI tools")
  .option("-g, --global", "Initialize global rules (apply to all projects)")
  .option("-r, --rule <rule>", "Add an initial rule", (val, acc: string[]) => [...acc, val], [])
  .option("--api-url <url>", "API base URL for guided login", DEFAULT_API_URL)
  .option("--mode <mode>", "Setup mode: auto | local | cloud", "auto")
  .option("--scope <scope>", "Memory scope: auto | project | global", "auto")
  .option("--skip-mcp", "Skip MCP configuration")
  .option("--skip-generate", "Skip generating instruction files")
  .option("--skip-skill-ingest", "Skip importing existing project skills into memories")
  .option("--skip-auth", "Skip guided login for cloud sync")
  .option("--skip-workspace", "Skip guided workspace selection/provisioning")
  .option("--workspace <target>", "Set active workspace (org slug/id/name, or 'personal')")
  .option("--skip-verify", "Skip post-setup verification checks")
  .option("-y, --yes", "Auto-confirm all prompts")
  .action(async (opts: {
    global?: boolean;
    rule?: string[];
    apiUrl?: string;
    mode?: string;
    scope?: string;
    skipMcp?: boolean;
    skipGenerate?: boolean;
    skipSkillIngest?: boolean;
    skipAuth?: boolean;
    skipWorkspace?: boolean;
    workspace?: string;
    skipVerify?: boolean;
    yes?: boolean;
  }) => {
    try {
      ui.banner();
      
      console.log(chalk.dim("  One place for your rules. Works with every tool.\n"));

      let setupMode = parseSetupMode(opts.mode);
      const setupScope = parseSetupScope(opts.scope);
      if (
        setupMode === "auto" &&
        !opts.yes &&
        !opts.skipAuth &&
        !opts.skipWorkspace &&
        !opts.workspace
      ) {
        setupMode = await select<SetupMode>({
          message: "Choose setup mode:",
          choices: [
            {
              name: "Cloud + workspace (recommended) — login, select workspace, provision DB, run verification",
              value: "cloud",
            },
            {
              name: "Local only — skip login/workspace prompts",
              value: "local",
            },
          ],
          default: "cloud",
        });
      }

      const effectiveSkipAuth = setupMode === "local" ? true : Boolean(opts.skipAuth);
      const effectiveSkipWorkspace = setupMode === "local" ? true : Boolean(opts.skipWorkspace);
      const shouldRunCloudGuidance =
        !effectiveSkipAuth || !effectiveSkipWorkspace || Boolean(opts.workspace);
      const totalSteps = 4 + (shouldRunCloudGuidance ? 1 : 0) + (opts.skipVerify ? 0 : 1);
      const cwd = process.cwd();
      const initialConfigDir = getConfigDir();
      const firstInstall = !existsSync(join(initialConfigDir, "local.db"));

      ui.dim(
        shouldRunCloudGuidance
          ? "Setup mode: cloud + workspace guidance"
          : "Setup mode: local only",
      );

      if (firstInstall) {
        ui.info("First-time setup detected.");
        ui.dim("Global memories sync two ways across local tools and cloud IDEs (for example v0).");
        ui.dim("Create a global memory here and it appears there after sync, and vice versa.");
      }

      // Step 1: Database
      ui.step(1, totalSteps, "Setting up local storage...");
      await getDb();
      const configPath = await initConfig(cwd);
      const configDir = getConfigDir();
      ui.dim(`Database: ${configDir}/local.db`);
      ui.dim(`Config: ${configPath}`);

      // Step 2: Scope detection
      ui.step(2, totalSteps, "Detecting scope...");
      const projectId = getProjectId();
      const gitRoot = getGitRoot();
      let useGlobal = Boolean(opts.global);

      if (!opts.global) {
        if (setupScope === "global") {
          useGlobal = true;
        } else if (setupScope === "project") {
          if (!projectId) {
            useGlobal = true;
            ui.warn("Project scope requested, but no git project was detected. Falling back to global scope.");
          } else {
            useGlobal = false;
          }
        } else if (!opts.yes && projectId) {
          const selectedScope = await select<"project" | "global">({
            message: "Choose memory scope for setup:",
            choices: [
              {
                name: `Project scope (recommended) — ${projectId}`,
                value: "project",
              },
              {
                name: "Global scope — shared across projects and cloud IDE workflows",
                value: "global",
              },
            ],
            default: "project",
          });
          useGlobal = selectedScope === "global";
        } else {
          useGlobal = !projectId;
        }
      }

      if (useGlobal) {
        ui.success("Global scope (rules apply to all projects)");
      } else {
        ui.success("Project scope detected");
        if (projectId) ui.dim(`Project: ${projectId}`);
        if (gitRoot) ui.dim(`Root: ${gitRoot}`);
      }

      // Step 3: Detect and configure tools
      ui.step(3, totalSteps, "Detecting AI coding tools...");
      const allTools = getAllTools();
      let detected = detectTools(cwd);
      let preferGlobalMcpSetup = false;

      const detectedNames = new Set(detected.map((item) => item.tool.name));

      if (detected.length === 0) {
        ui.dim("No AI coding tools auto-detected.");
      }

      const shouldOfferSelection = !opts.yes && (!opts.skipMcp || !opts.skipGenerate);
      if (shouldOfferSelection) {
        const additionalTools = allTools.filter((tool) => !detectedNames.has(tool.name));
        if (additionalTools.length > 0) {
          const selected = await checkbox({
            message: detected.length === 0
              ? "Select integrations to configure"
              : "Select additional integrations to configure (optional)",
            choices: additionalTools.map((tool) => ({
              name: tool.name,
              value: tool.name,
              checked: false,
            })),
          });

          for (const toolName of selected) {
            const tool = additionalTools.find((item) => item.name === toolName);
            if (!tool) continue;
            detected.push(selectedTool(tool));
            detectedNames.add(tool.name);
          }
        }
      }

      if (firstInstall && !opts.skipMcp) {
        if (opts.yes) {
          preferGlobalMcpSetup = true;
        } else {
          console.log("");
          ui.info("Optional onboarding: initialize integration MCP configs globally.");
          ui.dim("This keeps memories available across local projects and cloud IDE workflows.");
          preferGlobalMcpSetup = await confirm({
            message: "Write MCP config to home-directory locations where supported?",
            default: true,
          });
        }
      }

      if (detected.length === 0) {
        ui.dim("No tools selected. MCP will work with any tool that supports it.");
      } else {
        for (const d of detected) {
          const scope = d.globalConfig ? chalk.dim(" [global]") : "";
          const mcpStatus = toolSupportsMcp(d.tool)
            ? (d.hasMcp ? chalk.green("✓ MCP") : chalk.dim("○ MCP"))
            : chalk.dim("— MCP");
          const rulesStatus = toolSupportsGeneration(d.tool)
            ? (d.hasInstructions ? chalk.green("✓ Rules") : chalk.dim("○ Rules"))
            : chalk.dim("— Rules");
          console.log(`  ${chalk.white(d.tool.name)}${scope} ${mcpStatus} ${rulesStatus}`);
          if (d.tool.setupHint) {
            ui.dim(`${d.tool.name}: ${d.tool.setupHint}`);
          }
        }

        // Configure MCP for detected tools
        if (!opts.skipMcp) {
          const toolsNeedingMcp = detected.filter((d) => toolSupportsMcp(d.tool) && !d.hasMcp);

          if (toolsNeedingMcp.length > 0) {
            console.log("");
            const shouldSetupMcp = opts.yes || await confirm({
              message: `Configure MCP for ${toolsNeedingMcp.map(d => d.tool.name).join(", ")}?`,
              default: true,
            });

            if (shouldSetupMcp) {
              for (const d of toolsNeedingMcp) {
                const supportsGlobalMcp = Boolean(
                  d.tool.globalMcpConfigPath || (d.tool.globalDetectPaths ?? []).length > 0,
                );
                const writeGlobal = d.globalConfig || ((preferGlobalMcpSetup || useGlobal) && supportsGlobalMcp);
                const result = await setupMcp(d.tool, { 
                  cwd, 
                  global: writeGlobal,
                });
                if (result.success) {
                  ui.success(`${d.tool.name}: ${result.message}`);
                  if (result.path) ui.dim(`  → ${result.path}`);
                } else {
                  ui.warn(`${d.tool.name}: ${result.message}`);
                }
              }
            }
          }
        }

        // Generate instruction files
        if (!opts.skipGenerate) {
          const toolsNeedingInstructions = detected.filter(
            (d) => toolSupportsGeneration(d.tool) && !d.hasInstructions,
          );

          if (toolsNeedingInstructions.length > 0) {
            console.log("");
            const shouldGenerate = opts.yes || await confirm({
              message: `Generate instruction files for ${toolsNeedingInstructions.map(d => d.tool.name).join(", ")}?`,
              default: true,
            });

            if (shouldGenerate) {
              const generatedKeys = new Set<string>();
              for (const d of toolsNeedingInstructions) {
                if (!d.tool.generateCmd) continue;
                const cmdArgs = [
                  process.argv[1],
                  "generate",
                  d.tool.generateCmd,
                  ...(d.tool.generateArgs ?? []),
                ];
                const key = cmdArgs.join("\u0000");
                if (generatedKeys.has(key)) {
                  ui.success(`${d.tool.name}: Reused generated output`);
                  continue;
                }

                try {
                  execFileSync("node", cmdArgs, {
                    cwd,
                    stdio: "pipe",
                  });
                  generatedKeys.add(key);
                  ui.success(`${d.tool.name}: Generated ${d.tool.instructionFile ?? "instructions"}`);
                } catch (error) {
                  const stderr = (
                    typeof error === "object" &&
                    error !== null &&
                    "stderr" in error &&
                    (error as { stderr?: Buffer | string }).stderr
                  )
                    ? String((error as { stderr?: Buffer | string }).stderr).trim()
                    : "";
                  const detail = stderr ? ` (${stderr.split("\n").at(-1)})` : "";
                  ui.warn(`${d.tool.name}: Failed to generate instructions${detail}`);
                }
              }
            }
          }
        }
      }

      // Step 4: Add initial rules if provided
      ui.step(4, totalSteps, "Finalizing...");

      // Project setup default: ingest existing agent skills into memories.
      if (!useGlobal && !opts.skipSkillIngest) {
        const skillImportResult = await importProjectSkillsAsMemories(cwd);
        if (skillImportResult.errors.length > 0) {
          ui.warn(`Skill import completed with ${skillImportResult.errors.length} error(s).`);
          for (const error of skillImportResult.errors) {
            ui.dim(error);
          }
        }

        if (skillImportResult.imported > 0) {
          ui.success(`Imported ${skillImportResult.imported} project skill ${skillImportResult.imported === 1 ? "memory" : "memories"}.`);
        } else if (skillImportResult.skipped > 0) {
          ui.dim(`Project skill memories already up to date (${skillImportResult.skipped} duplicates skipped).`);
        } else {
          ui.dim("No existing project skills found to import.");
        }
      } else if (useGlobal) {
        ui.dim("Skipping project skill import for global setup.");
      }

      if (opts.rule?.length) {
        ui.info("Adding rules...");
        for (const rule of opts.rule) {
          await addMemory(rule, { 
            type: "rule", 
            global: useGlobal 
          });
          ui.dim(`+ ${rule}`);
        }
      }

      // Auth status
      if (effectiveSkipWorkspace && opts.workspace) {
        if (setupMode === "local") {
          ui.warn("Ignoring --workspace because setup mode is local.");
        } else {
          ui.warn("Ignoring --workspace because --skip-workspace is set.");
        }
      }

      let auth = await readAuth();
      if (auth) {
        ui.success(`Syncing as ${chalk.bold(auth.email)}`);
      } else {
        ui.dim("Local only. Run " + chalk.cyan("memories login") + " to sync across machines.");
      }

      let currentStep = 4;

      if (shouldRunCloudGuidance) {
        currentStep += 1;
        ui.step(currentStep, totalSteps, "Guiding cloud and workspace setup...");

        if (!auth && !effectiveSkipAuth) {
          const shouldLogin = opts.yes || await confirm({
            message: "Log in now to enable cloud sync and workspace setup?",
            default: true,
          });

          if (shouldLogin) {
            try {
              execFileSync("node", [process.argv[1], "login", "--api-url", opts.apiUrl ?? DEFAULT_API_URL], {
                cwd,
                stdio: "inherit",
              });
              auth = await readAuth();
            } catch {
              ui.warn("Login did not complete. Continuing with local setup only.");
            }
          }
        }

        if (!auth) {
          ui.warn("Cloud guidance skipped (not logged in).");
          ui.dim(`Run ${chalk.cyan("memories login")} later to enable workspace setup and provisioning.`);
        } else {
          const apiFetch = getApiClient(auth);
          try {
            const { organizations, user } = await fetchOrganizationsAndProfile(apiFetch);

            let target: ResolvedWorkspaceTarget | null = null;

            if (!effectiveSkipWorkspace && opts.workspace) {
              target = resolveWorkspaceTarget(organizations, opts.workspace);
            } else if (!effectiveSkipWorkspace && organizations.length > 0 && !opts.yes) {
              const choices = [
                {
                  name: `Personal workspace${user.current_org_id === null ? chalk.dim(" (current)") : ""}`,
                  value: PERSONAL_WORKSPACE_VALUE,
                },
                ...organizations.map((org) => ({
                  name: `${org.name} (${org.slug}) ${chalk.dim(org.role)}${user.current_org_id === org.id ? chalk.dim(" (current)") : ""}`,
                  value: org.id,
                })),
              ];

              const selectedWorkspace = await select({
                message: "Choose active workspace for setup:",
                choices,
                default: user.current_org_id ?? PERSONAL_WORKSPACE_VALUE,
              });

              if (selectedWorkspace === PERSONAL_WORKSPACE_VALUE) {
                target = {
                  orgId: null,
                  label: "Personal workspace",
                };
              } else {
                const selectedOrg = organizations.find((org) => org.id === selectedWorkspace);
                if (selectedOrg) {
                  target = {
                    orgId: selectedOrg.id,
                    label: `${selectedOrg.name} (${selectedOrg.slug})`,
                  };
                }
              }
            }

            if (target && target.orgId !== user.current_org_id) {
              await switchWorkspace(apiFetch, target.orgId);
              ui.success(`Active workspace set to ${target.label}`);
            } else {
              ui.dim(`Active workspace: ${workspaceLabel(organizations, user.current_org_id)}`);
            }

            if (!effectiveSkipWorkspace) {
              const healthResponse = await fetchIntegrationHealth(apiFetch);
              const workspaceHealth = healthResponse?.health?.workspace;

              if (!workspaceHealth) {
                ui.warn("Could not verify workspace health from cloud API.");
              } else if (workspaceHealth.hasDatabase) {
                ui.success("Workspace database is provisioned.");
              } else if (workspaceHealth.canProvision) {
                const shouldProvision = opts.yes || await confirm({
                  message: "Active workspace has no cloud database. Provision now?",
                  default: true,
                });

                if (shouldProvision) {
                  const provisioned = await provisionWorkspaceDatabase(apiFetch);
                  if (provisioned) {
                    ui.success("Workspace database provisioned.");
                  } else {
                    ui.warn("Database provisioning failed. Run memories doctor for remediation steps.");
                  }
                } else {
                  ui.dim(`Run ${chalk.cyan("memories doctor")} to check and provision later.`);
                }
              } else {
                ui.warn("Active workspace has no cloud database and this account cannot provision it.");
                ui.dim("Ask an organization owner/admin to provision the workspace database.");
              }
            }
          } catch (error) {
            ui.warn(
              "Cloud guidance incomplete: " +
                (error instanceof Error ? error.message : "Unknown error"),
            );
          }
        }
      }

      if (!opts.skipVerify) {
        currentStep += 1;
        ui.step(currentStep, totalSteps, "Running integration verification...");
        const report = await runDoctorChecks();
        const problematicChecks = report.checks.filter((check) => check.status !== "pass");

        if (report.summary.failed > 0) {
          ui.warn(
            `Verification found ${report.summary.failed} failure(s) and ${report.summary.warned} warning(s).`,
          );
        } else if (report.summary.warned > 0) {
          ui.warn(`Verification passed with ${report.summary.warned} warning(s).`);
        } else {
          ui.success("Verification passed (auth, DB, MCP, and graph health checks).");
        }

        if (problematicChecks.length > 0) {
          console.log("");
          console.log(chalk.bold("  Verification fixes:"));
          for (const check of problematicChecks) {
            const icon = check.status === "warn" ? chalk.yellow("⚠") : chalk.red("✗");
            console.log(`  ${icon} ${chalk.bold(check.name)}: ${check.message}`);
            if (check.remediation && check.remediation.length > 0) {
              for (const step of check.remediation) {
                console.log(chalk.dim(`     ↳ ${step}`));
              }
            }
          }
        }
      }

      // Quick start guide
      console.log("");
      console.log(chalk.bold("  Quick Start:"));
      console.log("");
      console.log(chalk.dim("  Add rules:"));
      console.log(`     ${chalk.cyan("memories add --rule")} ${chalk.dim('"Always use TypeScript strict mode"')}`);
      console.log("");
      console.log(chalk.dim("  Regenerate instruction files after adding rules:"));
      console.log(`     ${chalk.cyan("memories generate all")}`);
      console.log("");
      console.log(chalk.dim("  Run full health checks any time:"));
      console.log(`     ${chalk.cyan("memories doctor --fix")}`);
      console.log("");
      console.log(chalk.dim("  Check/switch workspace:"));
      console.log(`     ${chalk.cyan("memories org current")} ${chalk.dim("or")} ${chalk.cyan("memories org use personal")}`);
      console.log("");
      console.log(chalk.dim("  Your rules will be available via MCP and in generated files."));
      console.log("");
    } catch (error) {
      if (error instanceof Error && error.name === "ExitPromptError") return;
      ui.error("Failed to initialize: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
