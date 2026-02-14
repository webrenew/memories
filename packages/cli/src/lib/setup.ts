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
