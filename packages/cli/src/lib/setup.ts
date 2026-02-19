import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import {
  type Tool,
  TOOLS,
  MEMORIES_MCP_CONFIG,
  MEMORIES_MCP_CONFIG_OPENCODE,
} from "./setup-tools.js";
import { MARKER, makeFooter } from "./markers.js";

// Re-export for backward compatibility
export { type Tool, getAllTools } from "./setup-tools.js";

interface McpConfig {
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  servers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  mcp?: Record<string, { type: string; command?: string[]; url?: string; headers?: Record<string, string> }>;
  [key: string]: unknown;
}

export interface DetectedTool {
  tool: Tool;
  hasConfig: boolean;
  hasMcp: boolean;
  hasInstructions: boolean;
  globalConfig: boolean;
}

export interface InstallGlobalSkillsGuidesOptions {
  homeDir?: string;
  dryRun?: boolean;
  tools?: Tool[];
  commandExistsFn?: (command: string) => boolean;
}

export interface InstallGlobalSkillsGuidesResult {
  created: string[];
  updated: string[];
  skipped: string[];
  errors: string[];
}

const GLOBAL_SKILLS_TARGETS: Record<string, string[]> = {
  "Cursor": [".cursor/SKILLS.md"],
  "Claude Code": [".claude/SKILLS.md"],
  "Windsurf": [".windsurf/SKILLS.md"],
  "VS Code": [".vscode/SKILLS.md"],
  "OpenCode": [".opencode/SKILLS.md", ".config/opencode/SKILLS.md"],
  "Factory": [".factory/SKILLS.md"],
  "Kiro": [".kiro/SKILLS.md"],
  "Kilo": [".kilo/SKILLS.md"],
  "Trae": [".trae/SKILLS.md"],
  "Antigravity": [".antigravity/SKILLS.md", ".gemini/antigravity/SKILLS.md"],
  "Goose": [".goose/SKILLS.md"],
  "OpenClaw": [".openclaw/workspace/SKILLS.md"],
  "Gemini": [".gemini/SKILLS.md"],
  "Cline": [".clinerules/SKILLS.md"],
  "Roo": [".roo/SKILLS.md"],
  "Amp": [".amp/SKILLS.md"],
  "Agent Harness (.agents)": [".codex/SKILLS.md"],
};

export function toolSupportsMcp(
  tool: Tool,
): tool is Tool & { mcpConfigPath: string; mcpConfigFormat: "cursor" | "claude" | "vscode" | "opencode" } {
  return Boolean(tool.mcpConfigPath && tool.mcpConfigFormat);
}

export function toolSupportsGeneration(
  tool: Tool,
): tool is Tool & { generateCmd: string; generateArgs?: string[] } {
  return Boolean(tool.generateCmd);
}

function commandExists(command: string): boolean {
  try {
    if (process.platform === "win32") {
      execSync(`where ${command}`, { stdio: "ignore" });
    } else {
      execSync(`command -v ${command}`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

function globalSkillTargetsForTool(tool: Tool): string[] {
  return GLOBAL_SKILLS_TARGETS[tool.name] ?? [];
}

function hasGlobalToolSignal(
  tool: Tool,
  home: string,
  commandExistsFn: (command: string) => boolean,
): boolean {
  const detectPaths = tool.globalDetectPaths ?? [];
  if (detectPaths.some((path) => existsSync(join(home, path)))) {
    return true;
  }

  const mcpPath = tool.globalMcpConfigPath ?? tool.mcpConfigPath;
  if (mcpPath && existsSync(join(home, mcpPath))) {
    return true;
  }

  if ((tool.detectCommands ?? []).some((command) => commandExistsFn(command))) {
    return true;
  }

  const targets = globalSkillTargetsForTool(tool);
  return targets.some((path) => existsSync(join(home, dirname(path))));
}

function buildGlobalSkillsGuide(toolName: string): string {
  return [
    `# memories.sh Skill Guide (${toolName})`,
    "",
    "Use `memories` as your persistent context layer on this machine.",
    "",
    "## When To Use `memories`",
    "- At the start of every new task/session, fetch relevant context first.",
    "- Before editing unfamiliar code, search for prior decisions and constraints.",
    "- After durable decisions or discoveries, persist them for future sessions.",
    "",
    "## Read Context First",
    "1. Prefer MCP: call `get_context` with the active task query.",
    "2. CLI fallback: run `memories recall \"<task>\" --json`.",
    "3. For targeted lookups: `search_memories` (MCP) or `memories search \"<query>\"`.",
    "",
    "## Write Context Deliberately",
    "- Add durable items only: `add_memory` (MCP) or `memories add` (CLI).",
    "- Memory type guide:",
    "  - `rule`: standards/constraints that should always apply",
    "  - `decision`: tradeoffs and choices that explain why",
    "  - `fact`: stable project knowledge (limits, endpoints, environment facts)",
    "  - `note`: temporary or low-confidence context",
    "- Edit existing memories (`edit_memory` / `memories edit`) instead of duplicating.",
    "",
    "## Guardrails",
    "- Never store secrets, credentials, or tokens.",
    "- Keep memories atomic, specific, and reusable.",
    "- Prefer project-scoped memory for repo-specific context; use global for personal defaults.",
  ].join("\n");
}

export function parseConfigFile(content: string): McpConfig {
  try {
    return JSON.parse(content) as McpConfig;
  } catch {
    // Basic JSONC compatibility for configs that include comments.
    const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(withoutLineComments) as McpConfig;
  }
}

/**
 * Detect which AI coding tools are installed/configured
 */
export function detectTools(cwd: string = process.cwd()): DetectedTool[] {
  const home = homedir();
  const detected: DetectedTool[] = [];

  for (const tool of TOOLS) {
    const hasProjectConfig = tool.detectPaths.some((path) => existsSync(join(cwd, path)));
    const hasCommandConfig = (tool.detectCommands ?? []).some((command) => commandExists(command));
    const globalDetectPaths = tool.globalDetectPaths ?? [];
    const hasGlobalConfig = globalDetectPaths.some((path) => existsSync(join(home, path)));

    const hasProjectMcp = tool.mcpConfigPath ? existsSync(join(cwd, tool.mcpConfigPath)) : false;
    const globalMcpConfigPath = tool.globalMcpConfigPath ?? tool.mcpConfigPath;
    const hasGlobalMcp = globalMcpConfigPath ? existsSync(join(home, globalMcpConfigPath)) : false;
    const hasMcp = hasProjectMcp || hasGlobalMcp;

    const hasInstructions = tool.instructionFile
      ? existsSync(join(cwd, tool.instructionFile))
      : false;
    const instructionSignalsTool = tool.instructionFile
      ? tool.detectPaths.includes(tool.instructionFile)
      : false;
    const shouldDetect = hasProjectConfig
      || hasGlobalConfig
      || hasMcp
      || hasCommandConfig
      || (instructionSignalsTool && hasInstructions);

    if (shouldDetect) {
      detected.push({
        tool,
        hasConfig: shouldDetect,
        hasMcp,
        hasInstructions,
        globalConfig: !hasProjectConfig && !hasCommandConfig && (hasGlobalConfig || hasGlobalMcp),
      });
    }
  }

  return detected;
}

/**
 * Install/update global SKILLS.md guidance in detected tool config homes.
 * Never overwrites user-authored files unless they were previously generated by memories.sh.
 */
export async function installGlobalSkillsGuides(
  options: InstallGlobalSkillsGuidesOptions = {},
): Promise<InstallGlobalSkillsGuidesResult> {
  const {
    homeDir = homedir(),
    dryRun = false,
    tools = TOOLS,
    commandExistsFn = commandExists,
  } = options;

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const seenTargets = new Set<string>();

  for (const tool of tools) {
    const targets = globalSkillTargetsForTool(tool);
    if (targets.length === 0) continue;
    if (!hasGlobalToolSignal(tool, homeDir, commandExistsFn)) continue;

    const nextContent = `${buildGlobalSkillsGuide(tool.name)}${makeFooter()}\n`;

    for (const relativeTarget of targets) {
      const absoluteTarget = join(homeDir, relativeTarget);
      if (seenTargets.has(absoluteTarget)) continue;
      seenTargets.add(absoluteTarget);

      try {
        if (existsSync(absoluteTarget)) {
          const existing = await readFile(absoluteTarget, "utf-8");
          if (!existing.includes(MARKER)) {
            skipped.push(absoluteTarget);
            continue;
          }
          if (!dryRun) {
            await writeFile(absoluteTarget, nextContent, "utf-8");
          }
          updated.push(absoluteTarget);
          continue;
        }

        if (!dryRun) {
          await mkdir(dirname(absoluteTarget), { recursive: true });
          await writeFile(absoluteTarget, nextContent, "utf-8");
        }
        created.push(absoluteTarget);
      } catch (error) {
        errors.push(`${absoluteTarget}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }

  return { created, updated, skipped, errors };
}

/**
 * Add memories MCP server to a tool's config
 */
export async function setupMcp(
  tool: Tool,
  options: { cwd?: string; global?: boolean; dryRun?: boolean } = {}
): Promise<{ success: boolean; message: string; path?: string }> {
  const { cwd = process.cwd(), global: useGlobal = false, dryRun = false } = options;
  const home = homedir();

  if (!toolSupportsMcp(tool)) {
    return {
      success: false,
      message: `${tool.name} does not support MCP auto-configuration`,
    };
  }

  // Determine config path
  const resolvedMcpPath = useGlobal
    ? (tool.globalMcpConfigPath ?? tool.mcpConfigPath)
    : tool.mcpConfigPath;
  const configPath = useGlobal ? join(home, resolvedMcpPath) : join(cwd, resolvedMcpPath);

  try {
    let config: McpConfig = {};

    // Read existing config if it exists
    if (existsSync(configPath)) {
      const content = await readFile(configPath, "utf-8");
      config = parseConfigFile(content);
    }

    if (tool.mcpConfigFormat === "opencode") {
      const mcp = config.mcp ?? {};
      if (mcp.memories) {
        return {
          success: true,
          message: "MCP already configured",
          path: configPath,
        };
      }

      config.mcp = {
        ...mcp,
        memories: MEMORIES_MCP_CONFIG_OPENCODE,
      };

      if (typeof config.$schema !== "string") {
        config.$schema = "https://opencode.ai/config.json";
      }
    } else {
      // Check if memories is already configured
      const serversKey = tool.mcpConfigFormat === "vscode" ? "servers" : "mcpServers";
      const servers = config[serversKey] ?? {};

      if (servers.memories) {
        return {
          success: true,
          message: "MCP already configured",
          path: configPath,
        };
      }

      // Add memories server
      config[serversKey] = {
        ...servers,
        memories: MEMORIES_MCP_CONFIG,
      };
    }

    if (dryRun) {
      return {
        success: true,
        message: `Would add MCP config to ${configPath}`,
        path: configPath,
      };
    }

    // Write config
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    return {
      success: true,
      message: "MCP configured",
      path: configPath,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to setup MCP: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
