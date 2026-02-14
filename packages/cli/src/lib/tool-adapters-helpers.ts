import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { hasOurMarker } from "./markers.js";

// ─── Types ────────────────────────────────────────────────────────────

export interface AdaptResult {
  filesCreated: string[];
  filesSkipped: string[];
  errors: string[];
}

export interface FlatFileOptions {
  header?: string;
  maxLength?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function emptyResult(): AdaptResult {
  return { filesCreated: [], filesSkipped: [], errors: [] };
}

/**
 * Read a file and return its content, or null if missing/error.
 */
export async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * List .md files in a directory. Returns empty array if directory doesn't exist.
 */
export async function listMdFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath);
    return entries.filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

/**
 * List subdirectories containing SKILL.md files.
 */
export async function listSkillDirs(skillsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = join(skillsDir, entry.name, "SKILL.md");
        if (existsSync(skillFile)) {
          dirs.push(entry.name);
        }
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Write a file only if it's new or contains our marker. Returns true if written.
 */
export async function safeWrite(
  filePath: string,
  content: string,
  result: AdaptResult,
  force = false,
): Promise<boolean> {
  if (existsSync(filePath) && !force) {
    const ours = await hasOurMarker(filePath);
    if (!ours) {
      result.filesSkipped.push(filePath);
      return false;
    }
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  result.filesCreated.push(filePath);
  return true;
}

/**
 * Deep-merge settings.json: merge allow/deny arrays, preserve user keys.
 */
export function mergeSettings(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing };

  for (const [key, val] of Object.entries(incoming)) {
    if (key === "permissions" && typeof val === "object" && val !== null) {
      const existPerms = (merged.permissions ?? {}) as Record<string, unknown>;
      const incomingPerms = val as Record<string, unknown>;

      const mergedPerms = { ...existPerms };
      for (const pKey of ["allow", "deny"] as const) {
        const existArr = Array.isArray(existPerms[pKey]) ? (existPerms[pKey] as string[]) : [];
        const incomingArr = Array.isArray(incomingPerms[pKey]) ? (incomingPerms[pKey] as string[]) : [];
        mergedPerms[pKey] = [...new Set([...existArr, ...incomingArr])];
      }
      // Keep other permission keys from incoming
      for (const [pk, pv] of Object.entries(incomingPerms)) {
        if (pk !== "allow" && pk !== "deny" && !(pk in mergedPerms)) {
          mergedPerms[pk] = pv;
        }
      }
      merged.permissions = mergedPerms;
    } else if (!(key in merged)) {
      merged[key] = val;
    }
  }

  return merged;
}

/**
 * Strip YAML frontmatter from markdown content.
 * Returns { frontmatter, body } where frontmatter is the raw YAML (without ---).
 */
export function stripFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: "", body: content };
  return { frontmatter: match[1], body: match[2] };
}

/**
 * Extract `paths:` array values from YAML frontmatter string.
 */
export function extractPaths(frontmatter: string): string[] {
  const paths: string[] = [];
  const lines = frontmatter.split("\n");
  let inPaths = false;

  for (const line of lines) {
    if (line.startsWith("paths:")) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const match = line.match(/^\s+-\s+"?(.+?)"?\s*$/);
      if (match) {
        paths.push(match[1]);
      } else {
        inPaths = false;
      }
    }
  }

  return paths;
}
