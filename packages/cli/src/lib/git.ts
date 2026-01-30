import { execSync } from "node:child_process";

/**
 * Get the git remote URL for the current repository.
 * Returns null if not in a git repo or no remote configured.
 */
export function getGitRemoteUrl(cwd?: string): string | null {
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

  // Remove .git suffix
  if (normalized.endsWith(".git")) {
    normalized = normalized.slice(0, -4);
  }

  // SSH format: git@github.com:user/repo
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS format: https://github.com/user/repo
  const httpsMatch = normalized.match(/^https?:\/\/([^/]+)\/(.+)$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // Return as-is if no match
  return normalized;
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
