import type { Memory } from "./memory.js";

// ── Formatters ──────────────────────────────────────────────────────

function groupByType(memories: Memory[]): { title: string; memories: Memory[] }[] {
  const groups: Record<string, Memory[]> = {};
  for (const m of memories) {
    const title =
      m.type === "rule" ? "Rules" :
      m.type === "decision" ? "Key Decisions" :
      m.type === "fact" ? "Project Facts" :
      m.type === "skill" ? "Skills" :
      "Notes";
    (groups[title] ??= []).push(m);
  }
  // Stable order: Rules → Key Decisions → Project Facts → Skills → Notes
  const order = ["Rules", "Key Decisions", "Project Facts", "Skills", "Notes"];
  return order
    .filter((t) => groups[t]?.length)
    .map((title) => ({ title, memories: groups[title] }));
}

export const AGENT_INSTRUCTIONS = `## Memory Management

When you learn something important about this project, save it for future sessions.

**Via CLI:**
- \`memories add "<decision>" --type decision\` — Architectural decisions
- \`memories add "<convention>" --type rule\` — Coding conventions
- \`memories add "<fact>" --type fact\` — Project facts

**Via MCP (if connected):**
Use the \`add_memory\` tool with content and type parameters.

**When to save:**
- Architectural decisions and their rationale
- Project-specific patterns or conventions
- Non-obvious setup, configuration, or gotchas
- Tricky bugs and how they were resolved`;

/**
 * Format memories into grouped markdown sections.
 */
export function formatMemoriesAsMarkdown(memories: Memory[], includeAgentInstructions = true): string {
  const sections = groupByType(memories);
  const memoriesContent = sections.length === 0 ? "" : sections
    .map(({ title, memories: mems }) => {
      const items = mems.map((m) => `- ${m.content}`).join("\n");
      return `## ${title}\n\n${items}`;
    })
    .join("\n\n");

  if (includeAgentInstructions) {
    return memoriesContent ? `${memoriesContent}\n\n${AGENT_INSTRUCTIONS}` : AGENT_INSTRUCTIONS;
  }
  return memoriesContent;
}

/**
 * Format memories as Cursor MDC with YAML frontmatter.
 */
export function formatCursorMdc(memories: Memory[]): string {
  const body = formatMemoriesAsMarkdown(memories, true);
  const frontmatter = [
    "---",
    "description: Project memories and rules from memories.sh",
    "globs:",
    "alwaysApply: true",
    "---",
  ].join("\n");
  return `${frontmatter}\n\n# Project Memories\n\n${body}`;
}

/**
 * Format memories for Windsurf with 6000 char truncation.
 */
export function formatWindsurf(memories: Memory[]): string {
  const full = formatMemoriesAsMarkdown(memories, true);
  const LIMIT = 6000;
  if (full.length <= LIMIT) return full;
  // Truncate on a line boundary
  const truncated = full.slice(0, LIMIT);
  const lastNewline = truncated.lastIndexOf("\n");
  return lastNewline > 0
    ? truncated.slice(0, lastNewline) + "\n\n> _Truncated to fit Windsurf 6000 char limit._"
    : truncated;
}
