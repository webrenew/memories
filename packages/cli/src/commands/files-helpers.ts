import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readAuth, getApiClient } from "../lib/auth.js";
import { getProjectId } from "../lib/git.js";
import {
  type SyncTarget,
  OPTIONAL_CONFIG_PATHS,
  REDACTED_PLACEHOLDER,
  CLOUD_AUTH_REQUIRED_MESSAGE,
  SENSITIVE_DOUBLE_QUOTED_VALUE_RE,
  SENSITIVE_SINGLE_QUOTED_VALUE_RE,
  getSyncTargets,
} from "./files-constants.js";

export interface OptionalConfigSanitization {
  content: string;
  redactions: number;
  secrets: Record<string, string>;
}

export interface ConfigVaultEntry {
  scope: "global" | "project";
  project_id?: string;
  integration: string;
  config_path: string;
  secrets: Record<string, string>;
}

export interface VaultOperationResult {
  error?: string;
  proRequired?: boolean;
  unauthenticated?: boolean;
}

export function sanitizeOptionalConfig(path: string, content: string): OptionalConfigSanitization {
  if (!OPTIONAL_CONFIG_PATHS.has(path)) {
    return { content, redactions: 0, secrets: {} };
  }

  const secrets: Record<string, string> = {};
  let redactions = 0;
  let sanitized = content.replace(SENSITIVE_DOUBLE_QUOTED_VALUE_RE, (_match, prefix, key, value) => {
    if (typeof key === "string" && typeof value === "string") {
      secrets[key] = value;
    }
    redactions += 1;
    return `${prefix}"${REDACTED_PLACEHOLDER}"`;
  });

  sanitized = sanitized.replace(SENSITIVE_SINGLE_QUOTED_VALUE_RE, (_match, prefix, key, value) => {
    if (typeof key === "string" && typeof value === "string") {
      secrets[key] = value;
    }
    redactions += 1;
    return `${prefix}'${REDACTED_PLACEHOLDER}'`;
  });

  return { content: sanitized, redactions, secrets };
}

export function hydrateOptionalConfig(path: string, content: string, secrets: Record<string, string>): { content: string; hydrated: number } {
  if (!OPTIONAL_CONFIG_PATHS.has(path)) {
    return { content, hydrated: 0 };
  }

  let hydrated = 0;
  let out = content.replace(SENSITIVE_DOUBLE_QUOTED_VALUE_RE, (match, prefix, key, value) => {
    if (value !== REDACTED_PLACEHOLDER) return match;
    const secret = secrets[key];
    if (typeof secret !== "string" || secret.length === 0) return match;
    hydrated += 1;
    return `${prefix}"${secret}"`;
  });

  out = out.replace(SENSITIVE_SINGLE_QUOTED_VALUE_RE, (match, prefix, key, value) => {
    if (value !== REDACTED_PLACEHOLDER) return match;
    const secret = secrets[key];
    if (typeof secret !== "string" || secret.length === 0) return match;
    hydrated += 1;
    return `${prefix}'${secret}'`;
  });

  return { content: out, hydrated };
}

export function configProjectId(scope: string, cwd: string): string | null {
  if (scope === "global") return null;
  return getProjectId(cwd);
}

export async function pushConfigSecretsToVault(entries: ConfigVaultEntry[]): Promise<{ synced: number } & VaultOperationResult> {
  if (entries.length === 0) return { synced: 0 };

  const auth = await readAuth();
  if (!auth) {
    return { synced: 0, unauthenticated: true, error: CLOUD_AUTH_REQUIRED_MESSAGE };
  }

  const apiFetch = getApiClient(auth);
  const response = await apiFetch("/api/files/config-secrets", {
    method: "POST",
    body: JSON.stringify({ entries }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    if (response.status === 403) {
      return {
        synced: 0,
        proRequired: true,
        error: bodyText || "Vault-backed config secret sync is a Pro feature.",
      };
    }
    return {
      synced: 0,
      error: bodyText || `Failed to sync config secrets (${response.status})`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as { synced?: number };
  return { synced: payload.synced ?? 0 };
}

export async function fetchConfigSecretsFromVault(params: {
  scope: "global" | "project";
  projectId?: string | null;
  integration: string;
  configPath: string;
}): Promise<{ secrets: Record<string, string> } & VaultOperationResult> {
  const auth = await readAuth();
  if (!auth) {
    return { secrets: {}, unauthenticated: true, error: CLOUD_AUTH_REQUIRED_MESSAGE };
  }

  const apiFetch = getApiClient(auth);
  const query = new URLSearchParams({
    scope: params.scope,
    integration: params.integration,
    config_path: params.configPath,
  });
  if (params.scope === "project" && params.projectId) {
    query.set("project_id", params.projectId);
  }

  const response = await apiFetch(`/api/files/config-secrets?${query.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const bodyText = await response.text();
    if (response.status === 403) {
      return {
        secrets: {},
        proRequired: true,
        error: bodyText || "Vault-backed config secret hydration is a Pro feature.",
      };
    }
    if (response.status === 404) {
      return { secrets: {} };
    }
    return {
      secrets: {},
      error: bodyText || `Failed to fetch config secrets (${response.status})`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as { secrets?: Record<string, string> };
  return { secrets: payload.secrets ?? {} };
}

export async function scanTarget(baseDir: string, target: SyncTarget, relativeTo: string = ""): Promise<{ path: string; fullPath: string; source: string }[]> {
  const results: { path: string; fullPath: string; source: string }[] = [];
  const targetDir = join(baseDir, target.dir);

  if (!existsSync(targetDir)) return results;

  // Get tool name from first part of dir (e.g., ".agents" -> "Agents")
  const sourceRoot = target.dir.split("/")[0].replace(/^\./, "");
  const source = sourceRoot
    ? sourceRoot.replace(/^(.)/, (_, c) => c.toUpperCase())
    : "Project";

  // If specific files are listed, just check for those
  if (target.files) {
    for (const file of target.files) {
      const fullPath = join(targetDir, file);
      if (existsSync(fullPath)) {
        const stats = await stat(fullPath);
        if (stats.isFile()) {
          results.push({
            path: join(target.dir, file),
            fullPath,
            source,
          });
        }
      }
    }
    return results;
  }

  // Otherwise scan with pattern
  if (!target.pattern) return results;

  const entries = await readdir(targetDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(targetDir, entry.name);
    const relativePath = join(target.dir, entry.name);

    if (entry.isDirectory() && target.recurse) {
      // Recurse into subdirectories
      const subTarget: SyncTarget = { dir: relativePath, pattern: target.pattern, recurse: true };
      const subResults = await scanTarget(baseDir, subTarget, relativeTo);
      results.push(...subResults);
    } else if (entry.isFile() && target.pattern.test(entry.name)) {
      results.push({ path: relativePath, fullPath, source });
    }
  }

  return results;
}

export async function scanAllTargets(
  baseDir: string,
  options: { includeConfig?: boolean } = {},
): Promise<{ path: string; fullPath: string; source: string }[]> {
  const { includeConfig = false } = options;
  const results: { path: string; fullPath: string; source: string }[] = [];
  const targets = getSyncTargets(includeConfig);

  for (const target of targets) {
    const targetResults = await scanTarget(baseDir, target);
    results.push(...targetResults);
  }

  return results;
}
