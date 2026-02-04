import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

interface Tool {
  name: string;
  configDir: string;
  mcpConfigPath: string;
  mcpConfigFormat: "cursor" | "claude" | "vscode";
  instructionFile: string;
  generateCmd: string;
}

// Tool definitions with their config locations
const TOOLS: Tool[] = [
  {
    name: "Cursor",
    configDir: ".cursor",
    mcpConfigPath: ".cursor/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".cursor/rules/memories.mdc",
    generateCmd: "cursor",
  },
  {
    name: "Claude Code",
    configDir: ".claude",
    mcpConfigPath: ".mcp.json",
    mcpConfigFormat: "claude",
    instructionFile: "CLAUDE.md",
    generateCmd: "claude",
  },
  {
    name: "Windsurf",
    configDir: ".windsurf",
    mcpConfigPath: ".windsurf/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".windsurf/rules/memories.md",
    generateCmd: "windsurf",
  },
  {
    name: "VS Code",
    configDir: ".vscode",
    mcpConfigPath: ".vscode/mcp.json",
    mcpConfigFormat: "vscode",
    instructionFile: ".github/copilot-instructions.md",
    generateCmd: "copilot",
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
    // Check project-level config
    const projectConfigDir = join(cwd, tool.configDir);
    const projectMcpPath = join(cwd, tool.mcpConfigPath);
    const projectInstructionPath = join(cwd, tool.instructionFile);
    
    // Check global config (for tools like Cursor that use ~/.cursor/)
    const globalConfigDir = join(home, tool.configDir);
    const globalMcpPath = join(home, tool.mcpConfigPath);

    const hasProjectConfig = existsSync(projectConfigDir);
    const hasGlobalConfig = existsSync(globalConfigDir);
    
    if (hasProjectConfig || hasGlobalConfig) {
      detected.push({
        tool,
        hasConfig: hasProjectConfig || hasGlobalConfig,
        hasMcp: existsSync(projectMcpPath) || existsSync(globalMcpPath),
        hasInstructions: existsSync(projectInstructionPath),
        globalConfig: !hasProjectConfig && hasGlobalConfig,
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
    const status: string[] = [];
    if (d.hasMcp) status.push(chalk.green("MCP"));
    if (d.hasInstructions) status.push(chalk.green("Rules"));
    
    const statusStr = status.length > 0 
      ? chalk.dim(` (${status.join(", ")})`)
      : chalk.dim(" (not configured)");
    
    const scope = d.globalConfig ? chalk.dim(" [global]") : "";
    
    return `${chalk.white(d.tool.name)}${scope}${statusStr}`;
  }).join("\n  ");
}
