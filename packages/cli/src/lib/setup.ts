import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

export interface Tool {
  name: string;
  detectPaths: string[];
  globalDetectPaths?: string[];
  mcpConfigPath?: string;
  mcpConfigFormat?: "cursor" | "claude" | "vscode";
  instructionFile?: string;
  generateCmd?: string;
  generateArgs?: string[];
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
    detectPaths: [".opencode", ".opencode/instructions.md", ".opencode/mcp.json"],
    globalDetectPaths: [".opencode"],
    mcpConfigPath: ".opencode/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".opencode/instructions.md",
    generateCmd: "claude",
    generateArgs: ["--output", ".opencode/instructions.md"],
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
    detectPaths: [".agents", ".agents/instructions.md", "AGENTS.md", ".codex"],
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
];

// MCP server configuration for memories
const MEMORIES_MCP_CONFIG = {
  command: "npx",
  args: ["-y", "@memories.sh/cli", "serve"],
};

interface McpConfig {
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  servers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
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
): tool is Tool & { mcpConfigPath: string; mcpConfigFormat: "cursor" | "claude" | "vscode" } {
  return Boolean(tool.mcpConfigPath && tool.mcpConfigFormat);
}

export function toolSupportsGeneration(
  tool: Tool,
): tool is Tool & { generateCmd: string; generateArgs?: string[] } {
  return Boolean(tool.generateCmd);
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
    const globalDetectPaths = tool.globalDetectPaths ?? [];
    const hasGlobalConfig = globalDetectPaths.some((path) => existsSync(join(home, path)));

    const hasProjectMcp = tool.mcpConfigPath ? existsSync(join(cwd, tool.mcpConfigPath)) : false;
    const hasGlobalMcp = tool.mcpConfigPath ? existsSync(join(home, tool.mcpConfigPath)) : false;
    const hasMcp = hasProjectMcp || hasGlobalMcp;

    const hasInstructions = tool.instructionFile
      ? existsSync(join(cwd, tool.instructionFile))
      : false;

    if (hasProjectConfig || hasGlobalConfig || hasMcp || hasInstructions) {
      detected.push({
        tool,
        hasConfig: hasProjectConfig || hasGlobalConfig || hasMcp || hasInstructions,
        hasMcp,
        hasInstructions,
        globalConfig: !hasProjectConfig && (hasGlobalConfig || hasGlobalMcp),
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
  const configPath = useGlobal 
    ? join(home, tool.mcpConfigPath)
    : join(cwd, tool.mcpConfigPath);

  try {
    let config: McpConfig = {};
    
    // Read existing config if it exists
    if (existsSync(configPath)) {
      const content = await readFile(configPath, "utf-8");
      config = JSON.parse(content);
    }

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
