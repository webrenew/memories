import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const shouldSkip = process.env.MEMORIES_SKIP_POSTINSTALL === "1";
const isGlobalInstall =
  process.env.npm_config_global === "true" || process.env.npm_config_location === "global";
const forceRun = process.env.MEMORIES_FORCE_POSTINSTALL === "1";

if (shouldSkip || (!isGlobalInstall && !forceRun)) {
  process.exit(0);
}

const packageRoot = dirname(fileURLToPath(import.meta.url));
const setupModulePath = join(packageRoot, "dist", "lib", "setup.js");

if (!existsSync(setupModulePath)) {
  process.exit(0);
}

try {
  const setupModule = await import(pathToFileURL(setupModulePath).href);
  const installer = setupModule.installGlobalSkillsGuides;
  if (typeof installer === "function") {
    await installer();
  }
} catch {
  // Postinstall should never block package installation.
}
