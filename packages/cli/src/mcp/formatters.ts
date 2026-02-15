import type { Memory, MemoryType } from "../lib/memory.js";
import {
  formatStorageWarningsForText,
  getStorageWarnings,
  type StorageWarning,
} from "../lib/storage-health.js";

// ─── Type Labels ──────────────────────────────────────────────────────────────

export const TYPE_LABELS: Record<MemoryType, string> = {
  rule: "📌 RULE",
  decision: "💡 DECISION",
  fact: "📋 FACT",
  note: "📝 NOTE",
  skill: "🔧 SKILL",
};

// ─── Format Helpers ───────────────────────────────────────────────────────────

export function formatMemory(m: Memory): string {
  const tags = m.tags ? ` [${m.tags}]` : "";
  const scope = m.scope === "global" ? "G" : "P";
  const typeLabel = TYPE_LABELS[m.type] || "📝 NOTE";
  const paths = m.paths ? ` (paths: ${m.paths})` : "";
  const cat = m.category ? ` {${m.category}}` : "";
  return `${typeLabel} (${scope}) ${m.id}: ${m.content}${tags}${paths}${cat}`;
}

export function formatRulesSection(rules: Memory[]): string {
  if (rules.length === 0) return "";
  return `## Active Rules\n${rules.map(r => `- ${r.content}`).join("\n")}`;
}

export function formatMemoriesSection(memories: Memory[], title: string): string {
  if (memories.length === 0) return "";
  return `## ${title}\n${memories.map(formatMemory).join("\n")}`;
}

// ─── Tool Response Types ──────────────────────────────────────────────────────

export interface ToolTextPart {
  type: "text";
  text: string;
}

export interface ToolResponsePayload {
  content: ToolTextPart[];
  isError?: boolean;
  [key: string]: unknown;
}

// ─── Storage Warning Helper ───────────────────────────────────────────────────

export async function withStorageWarnings(
  result: ToolResponsePayload,
  warningsOverride?: StorageWarning[]
): Promise<ToolResponsePayload> {
  if (result.isError) return result;

  if (result.content.length === 0) return result;

  try {
    const warnings = warningsOverride ?? (await getStorageWarnings()).warnings;
    if (warnings.length === 0) return result;

    const warningBlock = formatStorageWarningsForText(warnings);
    if (!warningBlock) return result;

    const nextContent = [...result.content];
    const textPart = nextContent[0];
    nextContent[0] = {
      ...textPart,
      text: `${textPart.text}\n\n${warningBlock}`,
    };

    return {
      ...result,
      content: nextContent,
    };
  } catch {
    return result;
  }
}
