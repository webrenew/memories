import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import chalk from "chalk";

export interface Tool {
  name: string;
  detectPaths: string[];
  detectCommands?: string[];
  globalDetectPaths?: string[];
  mcpConfigPath?: string;
  globalMcpConfigPath?: string;
  mcpConfigFormat?: "cursor" | "claude" | "vscode" | "opencode";
  instructionFile?: string;
  generateCmd?: string;
  generateArgs?: string[];
  setupHint?: string;
}

// Tool definitions with their config locations
const TOOLS: Tool[] = [
  {
    name: "Cursor",
    detectPaths: [".cursor", ".cursor/rules/memories.mdc"],
    globalDetectPaths: [".cursor"],
    mcpConfigPath: ".cursor/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".cursor/rules/memories.mdc",
    generateCmd: "cursor",
  },
  {
    name: "Claude Code",
    detectPaths: [".claude", "CLAUDE.md", ".mcp.json"],
    globalDetectPaths: [".claude"],
    mcpConfigPath: ".mcp.json",
    mcpConfigFormat: "claude",
    instructionFile: "CLAUDE.md",
    generateCmd: "claude",
  },
  {
    name: "Windsurf",
    detectPaths: [".windsurf", ".windsurf/rules/memories.md", ".windsurfrules"],
    globalDetectPaths: [".windsurf"],
    mcpConfigPath: ".windsurf/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".windsurf/rules/memories.md",
    generateCmd: "windsurf",
  },
  {
    name: "VS Code",
    detectPaths: [".vscode", ".vscode/mcp.json"],
    globalDetectPaths: [".vscode"],
    mcpConfigPath: ".vscode/mcp.json",
    mcpConfigFormat: "vscode",
  },
  {
    name: "OpenCode",
    detectPaths: [".opencode", ".opencode/instructions.md", "opencode.json", ".opencode/mcp.json"],
    detectCommands: ["opencode"],
    globalDetectPaths: [".config/opencode/opencode.json", ".opencode"],
    mcpConfigPath: "opencode.json",
    globalMcpConfigPath: ".config/opencode/opencode.json",
    mcpConfigFormat: "opencode",
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
    setupHint: "OpenCode supports both .agents/ and opencode.json MCP configuration.",
  },
  {
    name: "Factory",
    detectPaths: [".factory", ".factory/instructions.md", ".factory/mcp.json"],
    globalDetectPaths: [".factory"],
    mcpConfigPath: ".factory/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".factory/instructions.md",
    generateCmd: "claude",
    generateArgs: ["--output", ".factory/instructions.md"],
  },
  {
    name: "Kiro",
    detectPaths: [".kiro", ".kiro/settings/mcp.json", ".kiro/mcp.json"],
    detectCommands: ["kiro"],
    globalDetectPaths: [".kiro", ".kiro/settings/mcp.json"],
    mcpConfigPath: ".kiro/settings/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
  {
    name: "Kilo",
    detectPaths: [".kilo", ".kilo/mcp.json"],
    detectCommands: ["kilo"],
    globalDetectPaths: [".kilo", ".kilo/mcp.json"],
    mcpConfigPath: ".kilo/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
  {
    name: "Trae",
    detectPaths: [".trae", ".trae/mcp.json"],
    detectCommands: ["trae"],
    globalDetectPaths: [".trae", ".trae/mcp.json"],
    mcpConfigPath: ".trae/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
  {
    name: "Antigravity",
    detectPaths: [".antigravity", ".antigravity/mcp.json", "mcp_config.json"],
    detectCommands: ["antigravity"],
    globalDetectPaths: [".gemini/antigravity/mcp_config.json", ".antigravity"],
    mcpConfigPath: ".antigravity/mcp.json",
    globalMcpConfigPath: ".gemini/antigravity/mcp_config.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
  {
    name: "Goose",
    detectPaths: [".goose", ".goose/rules"],
    detectCommands: ["goose"],
    globalDetectPaths: [".goose"],
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
    setupHint: "Configure Goose MCP in Goose settings if you need live memory access.",
  },
  {
    name: "OpenClaw",
    detectPaths: [
      ".openclaw/workspace/AGENTS.md",
      ".openclaw/workspace/SOUL.md",
      ".openclaw/workspace/TOOLS.md",
      ".openclaw/workspace/IDENTITY.md",
      ".openclaw/workspace/USER.md",
      ".openclaw/workspace/HEARTBEAT.md",
      ".openclaw/workspace/BOOTSTRAP.md",
      ".openclaw/workspace/BOOT.md",
      ".openclaw/workspace/MEMORY.md",
      ".openclaw/workspace/skills",
      ".openclaw/workspace/memory",
    ],
    detectCommands: ["openclaw"],
    globalDetectPaths: [
      ".openclaw/workspace/AGENTS.md",
      ".openclaw/workspace/SOUL.md",
      ".openclaw/workspace/TOOLS.md",
      ".openclaw/workspace/IDENTITY.md",
      ".openclaw/workspace/USER.md",
      ".openclaw/workspace/HEARTBEAT.md",
      ".openclaw/workspace/BOOTSTRAP.md",
      ".openclaw/workspace/BOOT.md",
      ".openclaw/workspace/MEMORY.md",
      ".openclaw/workspace/skills",
      ".openclaw/workspace/memory",
    ],
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
    setupHint: "OpenClaw uses workspace artifacts (AGENTS/SOUL/TOOLS/IDENTITY/USER/HEARTBEAT/BOOTSTRAP + skills) under ~/.openclaw/workspace.",
  },
  {
    name: "Blackbox CLI",
    detectPaths: [],
    detectCommands: ["blackbox"],
    setupHint: "Add memories manually: blackbox mcp add memories http://127.0.0.1:3030/mcp -t http",
  },
  {
    name: "GitHub Copilot",
    detectPaths: [".github/copilot-instructions.md"],
    instructionFile: ".github/copilot-instructions.md",
    generateCmd: "copilot",
  },
  {
    name: "Gemini",
    detectPaths: ["GEMINI.md"],
    instructionFile: "GEMINI.md",
    generateCmd: "gemini",
  },
  {
    name: "Cline",
    detectPaths: [".clinerules", ".clinerules/memories.md"],
    instructionFile: ".clinerules/memories.md",
    generateCmd: "cline",
  },
  {
    name: "Roo",
    detectPaths: [".roo", ".roo/rules/memories.md"],
    instructionFile: ".roo/rules/memories.md",
    generateCmd: "roo",
  },
  {
    name: "Amp",
    detectPaths: [".amp", ".amp/mcp.json"],
    globalDetectPaths: [".amp"],
    mcpConfigPath: ".amp/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
  {
    name: "Agent Harness (.agents)",
    detectPaths: [".agents", ".agents/instructions.md", "AGENTS.md", ".codex", ".opencode"],
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
];

// MCP server configuration for memories
const MEMORIES_MCP_CONFIG = {
  command: "npx",
  args: ["-y", "@memories.sh/cli", "serve"],
};

const MEMORIES_MCP_CONFIG_OPENCODE = {
  type: "local" as const,
  command: ["npx", "-y", "@memories.sh/cli", "serve"],
};

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

function parseConfigFile(content: string): McpConfig {
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
 * Get all supported tools
 */
export function getAllTools(): Tool[] {
  return [...TOOLS];
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

/**
 * Format detected tools for display
 */
export function formatDetectedTools(detected: DetectedTool[]): string {
  if (detected.length === 0) {
    return chalk.dim("No AI coding tools detected");
  }

  return detected.map(d => {
    const mcpStatus = toolSupportsMcp(d.tool)
      ? (d.hasMcp ? chalk.green("✓ MCP") : chalk.dim("○ MCP"))
      : chalk.dim("— MCP");
    const rulesStatus = toolSupportsGeneration(d.tool)
      ? (d.hasInstructions ? chalk.green("✓ Rules") : chalk.dim("○ Rules"))
      : chalk.dim("— Rules");

    const scope = d.globalConfig ? chalk.dim(" [global]") : "";
    
    return `${chalk.white(d.tool.name)}${scope} ${mcpStatus} ${rulesStatus}`;
  }).join("\n  ");
}
