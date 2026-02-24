import { execSync } from "node:child_process";

/**
 * Get the git remote URL for the current repository.
 * Returns null if not in a git repo or no remote configured.
 */
function getGitRemoteUrl(cwd?: string): string | null {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return remote || null;
  } catch {
    return null;
  }
}

/**
 * Get the git repository root directory.
 * Returns null if not in a git repo.
 */
export function getGitRoot(cwd?: string): string | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

/**
 * Normalize a git remote URL to a consistent project identifier.
 * Handles both SSH and HTTPS URLs.
 * 
 * Examples:
 *   git@github.com:user/repo.git -> github.com/user/repo
 *   https://github.com/user/repo.git -> github.com/user/repo
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();
  if (!normalized) {
    return normalized;
  }

  // Remove trailing slashes and optional .git suffix.
  normalized = normalized.replace(/\/+$/, "").replace(/\.git$/i, "");

  // SCP-like SSH format: git@github.com:user/repo
  const sshScpMatch = normalized.match(/^git@([^:]+):(.+)$/);
  if (sshScpMatch) {
    const path = sshScpMatch[2].replace(/^\/+/, "").replace(/\/+$/, "");
    return `${sshScpMatch[1]}/${path}`;
  }

  // URL-style remotes: https://, ssh://, git+ssh://, git://
  try {
    const parsed = new URL(normalized);
    const supportedProtocols = new Set(["http:", "https:", "ssh:", "git+ssh:", "git:"]);
    if (!supportedProtocols.has(parsed.protocol)) {
      return normalized;
    }

    const path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!parsed.hostname || !path) {
      return normalized;
    }

    return `${parsed.hostname}/${path}`;
  } catch {
    // Return as-is when parsing fails.
    return normalized;
  }
}

/**
 * Get the normalized project ID for the current git repo.
 * Returns null if not in a git repo.
 */
export function getProjectId(cwd?: string): string | null {
  const remoteUrl = getGitRemoteUrl(cwd);
  if (!remoteUrl) return null;
  return normalizeGitUrl(remoteUrl);
}
