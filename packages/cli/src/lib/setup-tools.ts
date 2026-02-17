// ─── Tool Definitions ─────────────────────────────────────────────────────────

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
export const TOOLS: Tool[] = [
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
    detectCommands: ["droid", "factory"],
    globalDetectPaths: [".factory"],
    mcpConfigPath: ".factory/mcp.json",
    mcpConfigFormat: "cursor",
    instructionFile: ".factory/instructions.md",
    generateCmd: "factory",
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
    detectCommands: ["codex"],
    instructionFile: ".agents/instructions.md",
    generateCmd: "agents",
  },
];

// ─── MCP Config Constants ─────────────────────────────────────────────────────

export const MEMORIES_MCP_CONFIG = {
  command: "npx",
  args: ["-y", "@memories.sh/cli", "serve"],
};

export const MEMORIES_MCP_CONFIG_OPENCODE = {
  type: "local" as const,
  command: ["npx", "-y", "@memories.sh/cli", "serve"],
};

/**
 * Get all supported tools
 */
export function getAllTools(): Tool[] {
  return [...TOOLS];
}
