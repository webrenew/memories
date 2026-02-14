export interface Tool {
  name: string;
  logo: string;
  slug: string;
  status: "Available" | "Coming Soon";
  desc: string;
  docsUrl: string;
  /** CLI command for `memories generate <cmd>` */
  cmd?: string;
  /** Output file path */
  file?: string;
}

/**
 * Canonical list of all supported tools/integrations.
 * Order determines display order across the site.
 */
export const TOOLS: Tool[] = [
  {
    name: "Claude Code",
    logo: "/logos/claude-code.svg",
    slug: "claude-code",
    status: "Available",
    desc: "Generates CLAUDE.md, path-scoped rules, skills, and settings.",
    docsUrl: "/docs/integrations/claude-code",
    cmd: "claude",
    file: "CLAUDE.md",
  },
  {
    name: "Cursor",
    logo: "/logos/cursor.svg",
    slug: "cursor",
    status: "Available",
    desc: "Generates .cursor/rules/ with globs frontmatter and skills.",
    docsUrl: "/docs/integrations/cursor",
    cmd: "cursor",
    file: ".cursor/rules/memories.mdc",
  },
  {
    name: "v0",
    logo: "/logos/v0.svg",
    slug: "v0",
    status: "Available",
    desc: "Vercel's AI frontend builder. Connects to memories.sh through MCP for live context.",
    docsUrl: "/docs/integrations/v0",
  },
  {
    name: "GitHub Copilot",
    logo: "/logos/copilot.svg",
    slug: "copilot",
    status: "Available",
    desc: "Generates .github/copilot-instructions.md.",
    docsUrl: "/docs/integrations/copilot",
    cmd: "copilot",
    file: ".github/copilot-instructions.md",
  },
  {
    name: "Windsurf",
    logo: "/logos/windsurf.svg",
    slug: "windsurf",
    status: "Available",
    desc: "Generates .windsurf/rules/memories.md.",
    docsUrl: "/docs/integrations/windsurf",
    cmd: "windsurf",
    file: ".windsurf/rules/memories.md",
  },
  {
    name: "Gemini",
    logo: "/logos/gemini.svg",
    slug: "gemini",
    status: "Available",
    desc: "Generates GEMINI.md for Google's coding agent.",
    docsUrl: "/docs/integrations/gemini",
    cmd: "gemini",
    file: "GEMINI.md",
  },
  {
    name: "Cline",
    logo: "/logos/cline.svg",
    slug: "cline",
    status: "Available",
    desc: "Generates .clinerules for the Cline VS Code extension.",
    docsUrl: "/docs/integrations/cline",
  },
  {
    name: "Roo",
    logo: "/logos/roo.svg",
    slug: "roo",
    status: "Available",
    desc: "Generates .roo/rules/ for the Roo Code agent.",
    docsUrl: "/docs/integrations/roo",
  },
  {
    name: "OpenCode",
    logo: "/logos/opencode.svg",
    slug: "opencode",
    status: "Available",
    desc: "Generates AGENTS.md for the OpenCode terminal agent.",
    docsUrl: "/docs/integrations/opencode",
  },
  {
    name: "Blackbox CLI",
    logo: "/logos/blackbox.svg",
    slug: "blackbox",
    status: "Available",
    desc: "Connects to memories.sh through MCP for live context and memory writes.",
    docsUrl: "/docs/integrations/blackbox",
  },
  {
    name: "Codex",
    logo: "/logos/codex.svg",
    slug: "codex",
    status: "Available",
    desc: "Generates AGENTS.md for the OpenAI Codex CLI agent.",
    docsUrl: "/docs/integrations/codex",
  },
  {
    name: "Amp",
    logo: "/logos/amp.svg",
    slug: "amp",
    status: "Available",
    desc: "Generates .amp/rules/ for the Amp coding agent.",
    docsUrl: "/docs/integrations/amp",
  },
  {
    name: "Kilo",
    logo: "/logos/kilo.svg",
    slug: "kilo",
    status: "Available",
    desc: "Generates config for the Kilo coding assistant.",
    docsUrl: "/docs/integrations/kilo",
  },
  {
    name: "Trae",
    logo: "/logos/trae.svg",
    slug: "trae",
    status: "Available",
    desc: "Generates rules for the Trae coding agent.",
    docsUrl: "/docs/integrations/trae",
  },
  {
    name: "Goose",
    logo: "/logos/goose.svg",
    slug: "goose",
    status: "Available",
    desc: "Generates .goose/rules/ for the Goose agent by Block.",
    docsUrl: "/docs/integrations/goose",
  },
  {
    name: "OpenClaw",
    logo: "/logos/openclaw.svg",
    slug: "openclaw",
    status: "Available",
    desc: "Open-source personal AI assistant with persistent memory and skill plugins.",
    docsUrl: "/docs/integrations/openclaw",
  },
  {
    name: "Antigravity",
    logo: "/logos/antigravity.svg",
    slug: "antigravity",
    status: "Available",
    desc: "Google's agent-first IDE powered by Gemini.",
    docsUrl: "/docs/integrations/antigravity",
  },
  {
    name: "Kiro",
    logo: "/logos/kiro-cli.svg",
    slug: "kiro",
    status: "Available",
    desc: "AWS's agentic AI IDE with CLI and autonomous agents.",
    docsUrl: "/docs/integrations/kiro",
  },
  {
    name: "Droid",
    logo: "/logos/droid.svg",
    slug: "droid",
    status: "Available",
    desc: "Factory AI's terminal coding agent for end-to-end dev workflows.",
    docsUrl: "/docs/integrations/factory",
  },
  {
    name: "Any MCP Client",
    logo: "/logos/mcp.svg",
    slug: "mcp",
    status: "Available",
    desc: "7 tools at full CLI parity with FTS5 search. For bolt.new, Lovable, and any MCP client.",
    docsUrl: "/docs/integrations/mcp",
  },
];

/** Tools that have a `memories generate <cmd>` command */
export const GENERATOR_TOOLS = TOOLS.filter(
  (t): t is Tool & { cmd: string; file: string } => !!t.cmd && !!t.file
);

/** All tools except the "Any MCP Client" meta-entry — used for logo marquees */
export const MARQUEE_TOOLS = TOOLS.filter((t) => t.slug !== "mcp");
