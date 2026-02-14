import type { Memory } from "../lib/memory.js";
import { formatMemoriesAsMarkdown, formatCursorMdc, formatWindsurf } from "../lib/formatters.js";

// ─── Target Registry ─────────────────────────────────────────────────

export interface Target {
  name: string;
  defaultPath: string;
  description: string;
  format: (memories: Memory[]) => string;
}

export const TARGETS: Target[] = [
  {
    name: "cursor",
    defaultPath: ".cursor/rules/memories.mdc",
    description: "Cursor rules file (.cursor/rules/memories.mdc)",
    format: formatCursorMdc,
  },
  {
    name: "claude",
    defaultPath: "CLAUDE.md",
    description: "Claude Code instructions (CLAUDE.md)",
    format: (m) => `# Project Memories\n\n${formatMemoriesAsMarkdown(m)}`,
  },
  {
    name: "agents",
    defaultPath: ".agents/",
    description: ".agents/ directory (instructions, rules, skills, settings)",
    // format is unused for agents — handled by generateAgentsDir
    format: (m) => `# Project Memories\n\n${formatMemoriesAsMarkdown(m)}`,
  },
  {
    name: "copilot",
    defaultPath: ".github/copilot-instructions.md",
    description: "GitHub Copilot instructions (.github/copilot-instructions.md)",
    format: (m) => `# Project Memories\n\n${formatMemoriesAsMarkdown(m)}`,
  },
  {
    name: "windsurf",
    defaultPath: ".windsurf/rules/memories.md",
    description: "Windsurf rules (.windsurf/rules/memories.md)",
    format: formatWindsurf,
  },
  {
    name: "cline",
    defaultPath: ".clinerules/memories.md",
    description: "Cline rules (.clinerules/memories.md)",
    format: (m) => `# Project Memories\n\n${formatMemoriesAsMarkdown(m)}`,
  },
  {
    name: "roo",
    defaultPath: ".roo/rules/memories.md",
    description: "Roo rules (.roo/rules/memories.md)",
    format: (m) => `# Project Memories\n\n${formatMemoriesAsMarkdown(m)}`,
  },
  {
    name: "gemini",
    defaultPath: "GEMINI.md",
    description: "Gemini instructions (GEMINI.md)",
    format: (m) => `# Project Memories\n\n${formatMemoriesAsMarkdown(m)}`,
  },
];

// Files users likely want git-tracked (shared with team)
export const TRACK_BY_DEFAULT = new Set(["CLAUDE.md", ".agents/", "GEMINI.md", ".github/copilot-instructions.md"]);
