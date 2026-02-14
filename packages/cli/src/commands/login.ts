import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
import { readAuth, saveAuth, clearAuth } from "../lib/auth.js";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import * as ui from "../lib/ui.js";

const DEFAULT_API_URL = "https://memories.sh";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeApiUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${stripTrailingSlash(parsed.pathname)}`;
  } catch {
    return stripTrailingSlash(trimmed);
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "start"
        : "xdg-open";
  execFile(cmd, [url], () => {
    // Best-effort, ignore errors
  });
}

export const loginCommand = new Command("login")
  .description("Log in to memories.sh to enable cloud sync")
  .option("--api-url <url>", "API base URL", DEFAULT_API_URL)
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (opts: { apiUrl: string; yes?: boolean }) => {
    ui.banner();

    const existing = await readAuth();
    if (existing) {
      ui.warn(`Already logged in as ${chalk.bold(existing.email)}`);
      ui.dim(`Run ${chalk.cyan("memories logout")} to sign out first.`);
      return;
    }

    const apiUrl = stripTrailingSlash(opts.apiUrl);
    const usingNonDefaultApiUrl =
      normalizeApiUrl(apiUrl) !== normalizeApiUrl(DEFAULT_API_URL);

    if (usingNonDefaultApiUrl) {
      ui.warn(`Using non-default API URL: ${chalk.bold(apiUrl)}`);
      ui.warn("Only continue if you trust this server. It can capture your CLI auth token.");

      if (!opts.yes && !process.stdin.isTTY) {
        ui.error("Login cancelled in non-interactive mode.");
        ui.dim(`Re-run with ${chalk.cyan("--yes")} if you intend to trust this API URL.`);
        return;
      }

      const proceed = opts.yes || await confirm({
        message: `Continue login against ${apiUrl}?`,
        default: false,
      });
      if (!proceed) {
        ui.info("Login cancelled.");
        return;
      }
    }

    ui.box(
      chalk.bold("Pro features include:\n\n") +
        chalk.dim("→ ") + "Cloud sync & backup\n" +
        chalk.dim("→ ") + "Cross-device access\n" +
        chalk.dim("→ ") + "Web dashboard\n" +
        chalk.dim("→ ") + "Priority support",
      "Upgrade to Pro"
    );

    const code = randomBytes(16).toString("hex");
    const authUrl = `${apiUrl}/app/auth/cli?code=${code}`;

    console.log(chalk.bold("Open this URL in your browser:\n"));
    console.log(`  ${chalk.cyan(authUrl)}\n`);

    // Try to open browser automatically
    try {
      openBrowser(authUrl);
      ui.dim("Browser opened automatically");
    } catch {
      // Browser open is best-effort
    }

    const spinner = ora({
      text: "Waiting for authorization...",
      color: "magenta",
    }).start();

    // Poll for the token
    const maxAttempts = 60; // 5 minutes at 5s intervals
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      spinner.text = `Waiting for authorization... (${Math.floor((maxAttempts - i) * 5 / 60)}m remaining)`;

      try {
        const res = await fetch(`${apiUrl}/api/auth/cli`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", code }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            token: string;
            email: string;
          };
          await saveAuth({
            token: data.token,
            email: data.email,
            apiUrl,
          });
          spinner.stop();
          console.log("");
          ui.success(`Logged in as ${chalk.bold(data.email)}`);
          ui.dim("Your cloud database has been provisioned automatically.");
          
          ui.nextSteps([
            `${chalk.cyan("memories sync")} ${chalk.dim("to sync your memories")}`,
            `${chalk.cyan("memories.sh/app")} ${chalk.dim("to view your dashboard")}`,
          ]);
          return;
        }

        if (res.status !== 202) {
          // 202 = still waiting, anything else is an error
          const text = await res.text();
          spinner.stop();
          ui.error(`Authorization failed: ${text}`);
          return;
        }
      } catch {
        // Network error, keep polling
      }
    }

    spinner.stop();
    ui.error("Authorization timed out. Please try again.");
  });

export const logoutCommand = new Command("logout")
  .description("Log out of memories.sh")
  .action(async () => {
    const existing = await readAuth();
    if (!existing) {
      ui.info("Not logged in.");
      return;
    }

    await clearAuth();
    ui.success("Logged out successfully.");
  });
