import { Command } from "commander";
import chalk from "chalk";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const HOOK_MARKER_START = "# >>> memories.sh hook >>>";
const HOOK_MARKER_END = "# <<< memories.sh hook <<<";
const HOOK_SNIPPET = `
${HOOK_MARKER_START}
# Auto-generate IDE rule files from memories
if command -v memories &> /dev/null; then
  memories generate all --force 2>/dev/null || true
  git add -A -- .agents .cursor/rules/memories.mdc CLAUDE.md .github/copilot-instructions.md .windsurf/rules/memories.md .clinerules/memories.md .roo/rules/memories.md GEMINI.md 2>/dev/null || true
fi
${HOOK_MARKER_END}`;

function getGitDir(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

interface HookLocation {
  path: string;
  type: "husky" | "git";
}

function getHookLocation(hookName: string): HookLocation | null {
  const gitDir = getGitDir();
  if (!gitDir) return null;

  // Check for Husky v9+ (.husky/<hook>) — no _ subdirectory
  const huskyPath = join(".husky", hookName);
  if (existsSync(".husky") && !existsSync(join(".husky", "_"))) {
    return { path: huskyPath, type: "husky" };
  }

  // Check for Husky v4-8 (.husky/_/<hook>)
  const huskyLegacyPath = join(".husky", "_", hookName);
  if (existsSync(join(".husky", "_"))) {
    return { path: huskyLegacyPath, type: "husky" };
  }

  // Check for existing Husky hook file (may exist without _ dir in some setups)
  if (existsSync(huskyPath)) {
    return { path: huskyPath, type: "husky" };
  }

  // Default to .git/hooks
  return { path: join(gitDir, "hooks", hookName), type: "git" };
}

function detectLintStaged(): boolean {
  try {
    if (!existsSync("package.json")) return false;
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    return !!(pkg["lint-staged"] || pkg.devDependencies?.["lint-staged"] || pkg.dependencies?.["lint-staged"]);
  } catch {
    return false;
  }
}

export const hookCommand = new Command("hook")
  .description("Manage git hooks for auto-generating rule files");

hookCommand.addCommand(
  new Command("install")
    .description("Install pre-commit hook to auto-generate rule files")
    .option("--hook <name>", "Hook name (default: pre-commit)", "pre-commit")
    .action(async (opts: { hook: string }) => {
      try {
        const location = getHookLocation(opts.hook);
        if (!location) {
          console.error(chalk.red("✗") + " Not in a git repository");
          process.exit(1);
        }

        const hookPath = location.path;

        if (existsSync(hookPath)) {
          const content = await readFile(hookPath, "utf-8");
          if (content.includes(HOOK_MARKER_START)) {
            console.log(chalk.dim("Hook already installed. Use 'memories hook uninstall' first to reinstall."));
            return;
          }
          // Append to existing hook
          await writeFile(hookPath, content.trimEnd() + "\n" + HOOK_SNIPPET + "\n", "utf-8");
        } else {
          // Create new hook file
          await writeFile(hookPath, "#!/bin/sh\n" + HOOK_SNIPPET + "\n", "utf-8");
        }

        await chmod(hookPath, 0o755);

        const locationLabel = location.type === "husky" ? "Husky" : ".git/hooks";
        console.log(chalk.green("✓") + ` Installed memories hook in ${chalk.dim(opts.hook)} (${locationLabel})`);
        console.log(chalk.dim("  Rule files will auto-generate on each commit."));

        // Lint-staged guidance
        if (detectLintStaged()) {
          console.log(
            chalk.dim("\n  lint-staged detected. You can also add to your lint-staged config:") +
            chalk.dim('\n  "*.md": "memories generate all --force"'),
          );
        }
      } catch (error) {
        console.error(chalk.red("✗") + " Failed to install hook:", error instanceof Error ? error.message : "Unknown error");
        process.exit(1);
      }
    }),
);

hookCommand.addCommand(
  new Command("uninstall")
    .description("Remove the memories pre-commit hook")
    .option("--hook <name>", "Hook name (default: pre-commit)", "pre-commit")
    .action(async (opts: { hook: string }) => {
      try {
        const location = getHookLocation(opts.hook);
        if (!location) {
          console.error(chalk.red("✗") + " Not in a git repository");
          process.exit(1);
        }

        const hookPath = location.path;

        if (!existsSync(hookPath)) {
          console.log(chalk.dim("No hook file found."));
          return;
        }

        const content = await readFile(hookPath, "utf-8");
        if (!content.includes(HOOK_MARKER_START)) {
          console.log(chalk.dim("No memories hook found in " + opts.hook));
          return;
        }

        // Remove our section
        const regex = new RegExp(
          `\\n?${escapeRegex(HOOK_MARKER_START)}[\\s\\S]*?${escapeRegex(HOOK_MARKER_END)}\\n?`,
        );
        const cleaned = content.replace(regex, "\n");

        // If only shebang remains, remove the file entirely
        if (cleaned.trim() === "#!/bin/sh" || cleaned.trim() === "") {
          const { unlink } = await import("node:fs/promises");
          await unlink(hookPath);
          console.log(chalk.green("✓") + ` Removed ${chalk.dim(opts.hook)} hook (was memories-only)`);
        } else {
          await writeFile(hookPath, cleaned, "utf-8");
          console.log(chalk.green("✓") + ` Removed memories section from ${chalk.dim(opts.hook)}`);
        }
      } catch (error) {
        console.error(chalk.red("✗") + " Failed to uninstall hook:", error instanceof Error ? error.message : "Unknown error");
        process.exit(1);
      }
    }),
);

hookCommand.addCommand(
  new Command("status")
    .description("Check if the memories hook is installed")
    .option("--hook <name>", "Hook name (default: pre-commit)", "pre-commit")
    .action(async (opts: { hook: string }) => {
      try {
        const hookPath = getHookLocation(opts.hook)?.path;
        if (!hookPath) {
          console.error(chalk.red("✗") + " Not in a git repository");
          process.exit(1);
        }

        if (!existsSync(hookPath)) {
          console.log(chalk.dim("Not installed") + ` — no ${opts.hook} hook found`);
          return;
        }

        const content = await readFile(hookPath, "utf-8");
        if (content.includes(HOOK_MARKER_START)) {
          console.log(chalk.green("✓") + ` Installed in ${chalk.dim(hookPath)}`);
        } else {
          console.log(chalk.dim("Not installed") + ` — ${opts.hook} exists but has no memories section`);
        }
      } catch (error) {
        console.error(chalk.red("✗") + " Failed to check hook:", error instanceof Error ? error.message : "Unknown error");
        process.exit(1);
      }
    }),
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
