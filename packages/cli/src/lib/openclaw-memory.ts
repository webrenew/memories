import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { posix } from "node:path";

export const DEFAULT_OPENCLAW_WORKSPACE_RELATIVE_PATH = ".openclaw/workspace";
export const OPENCLAW_CONFIG_RELATIVE_PATH = ".openclaw/openclaw.json";

const OPENCLAW_WORKSPACE_ENV_KEYS = [
  "MEMORIES_OPENCLAW_WORKSPACE_DIR",
  "OPENCLAW_WORKSPACE_DIR",
  "OPENCLAW_WORKSPACE_PATH",
] as const;

const TRUTHY_FLAG_VALUES = new Set(["1", "true", "yes", "on"]);

export type OpenClawMemoryRouteKind = "semantic" | "episodic_daily" | "snapshot";
export type OpenClawMemoryBucket = "semantic" | "episodic" | "snapshot";
export type OpenClawWorkspaceSource = "override" | "env" | "config" | "default";

export interface ResolvedOpenClawWorkspace {
  workspaceDir: string;
  configPath: string;
  source: OpenClawWorkspaceSource;
}

export interface OpenClawPathContract {
  workspaceDir: string;
  semanticMemoryFile: string;
  semanticMemoryCandidates: string[];
  memoryDir: string;
  dailyDir: string;
  snapshotsDir: string;
}

export interface ResolveOpenClawWorkspaceOptions {
  workspaceDir?: string | null;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  openClawConfigPath?: string;
  readFileFn?: (path: string) => Promise<string>;
  existsFn?: (path: string) => boolean;
}

export interface RouteOpenClawMemoryFileInput {
  contract: OpenClawPathContract;
  kind: OpenClawMemoryRouteKind;
  date?: Date | string;
  slug?: string;
}

export interface OpenClawMemoryFileRoute {
  kind: OpenClawMemoryRouteKind;
  absolutePath: string;
  workspaceRelativePath: string;
  appendOnly: boolean;
  dateKey?: string;
  slug?: string;
}

export interface ResolveOpenClawMemoryBucketInput {
  bucket?: OpenClawMemoryBucket;
  memoryLayer?: string | null;
  memoryType?: string | null;
  sourceTrigger?: string | null;
}

export interface ReadOpenClawBootstrapContextOptions extends ResolveOpenClawWorkspaceOptions {
  now?: Date | string;
  maxSemanticLines?: number;
  maxDailyLines?: number;
}

export interface OpenClawDailyLogEntry {
  dateKey: string;
  path: string;
  content: string;
}

export interface OpenClawBootstrapContext {
  workspace: ResolvedOpenClawWorkspace;
  contract: OpenClawPathContract;
  semanticFile: string | null;
  semanticContent: string | null;
  dailyLogs: OpenClawDailyLogEntry[];
}

export interface AppendOpenClawDailyLogOptions extends ResolveOpenClawWorkspaceOptions {
  date?: Date | string;
  heading?: string;
}

export interface OpenClawFileWriteResult {
  workspace: ResolvedOpenClawWorkspace;
  contract: OpenClawPathContract;
  route: OpenClawMemoryFileRoute;
}

export interface WriteOpenClawSnapshotOptions extends ResolveOpenClawWorkspaceOptions {
  date?: Date | string;
  slug: string;
}

function normalizeWorkspacePathCandidate(
  value: string,
  opts: { homeDir: string; baseDir: string },
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("OpenClaw workspace path cannot be empty");
  }

  if (trimmed === "~") {
    return normalize(opts.homeDir);
  }
  if (trimmed.startsWith("~/")) {
    return normalize(join(opts.homeDir, trimmed.slice(2)));
  }
  if (isAbsolute(trimmed)) {
    return normalize(trimmed);
  }
  return normalize(resolve(opts.baseDir, trimmed));
}

function getNestedValue(input: unknown, path: readonly string[]): unknown {
  let cursor: unknown = input;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function firstStringValue(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    return trimmed;
  }
  return null;
}

export function extractOpenClawWorkspaceSetting(config: unknown): string | null {
  if (!config || typeof config !== "object") {
    return null;
  }

  return firstStringValue([
    getNestedValue(config, ["workspace"]),
    getNestedValue(config, ["workspacePath"]),
    getNestedValue(config, ["workspaceDir"]),
    getNestedValue(config, ["workspaceRoot"]),
    getNestedValue(config, ["paths", "workspace"]),
    getNestedValue(config, ["paths", "workspacePath"]),
    getNestedValue(config, ["agent", "workspace"]),
    getNestedValue(config, ["agent", "workspacePath"]),
    getNestedValue(config, ["agents", "defaults", "workspace"]),
    getNestedValue(config, ["agents", "defaults", "workspacePath"]),
  ]);
}

export function isOpenClawFileModeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.MEMORY_OPENCLAW_FILE_MODE_ENABLED?.trim().toLowerCase();
  return raw ? TRUTHY_FLAG_VALUES.has(raw) : false;
}

export async function resolveOpenClawWorkspaceDirectory(
  opts: ResolveOpenClawWorkspaceOptions = {},
): Promise<ResolvedOpenClawWorkspace> {
  const home = opts.homeDir ?? homedir();
  const env = opts.env ?? process.env;
  const exists = opts.existsFn ?? existsSync;
  const read = opts.readFileFn ?? ((path: string) => readFile(path, "utf-8"));
  const configPath = opts.openClawConfigPath
    ? normalizeWorkspacePathCandidate(opts.openClawConfigPath, { homeDir: home, baseDir: home })
    : normalize(join(home, OPENCLAW_CONFIG_RELATIVE_PATH));

  const explicit = opts.workspaceDir?.trim();
  if (explicit) {
    return {
      workspaceDir: normalizeWorkspacePathCandidate(explicit, { homeDir: home, baseDir: home }),
      configPath,
      source: "override",
    };
  }

  for (const envKey of OPENCLAW_WORKSPACE_ENV_KEYS) {
    const candidate = env[envKey]?.trim();
    if (!candidate) continue;
    return {
      workspaceDir: normalizeWorkspacePathCandidate(candidate, { homeDir: home, baseDir: home }),
      configPath,
      source: "env",
    };
  }

  if (exists(configPath)) {
    try {
      const parsed = JSON.parse(await read(configPath)) as unknown;
      const fromConfig = extractOpenClawWorkspaceSetting(parsed);
      if (fromConfig) {
        return {
          workspaceDir: normalizeWorkspacePathCandidate(fromConfig, {
            homeDir: home,
            baseDir: dirname(configPath),
          }),
          configPath,
          source: "config",
        };
      }
    } catch {
      // Ignore malformed config and fall back to default workspace path.
    }
  }

  return {
    workspaceDir: normalize(join(home, DEFAULT_OPENCLAW_WORKSPACE_RELATIVE_PATH)),
    configPath,
    source: "default",
  };
}

export function buildOpenClawPathContract(workspaceDir: string): OpenClawPathContract {
  const home = homedir();
  const resolvedWorkspace = normalizeWorkspacePathCandidate(workspaceDir, {
    homeDir: home,
    baseDir: home,
  });
  const memoryDir = join(resolvedWorkspace, "memory");
  const semanticMemoryFile = join(resolvedWorkspace, "memory.md");

  return {
    workspaceDir: resolvedWorkspace,
    semanticMemoryFile,
    semanticMemoryCandidates: [semanticMemoryFile, join(resolvedWorkspace, "MEMORY.md")],
    memoryDir,
    dailyDir: join(memoryDir, "daily"),
    snapshotsDir: join(memoryDir, "snapshots"),
  };
}

export function normalizeOpenClawDateKey(input: Date | string = new Date()): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Invalid date for OpenClaw memory path");
  }
  return date.toISOString().slice(0, 10);
}

export function normalizeOpenClawSnapshotSlug(input?: string): string {
  const normalized = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || "snapshot";
}

export function resolveOpenClawMemoryBucket(
  input: ResolveOpenClawMemoryBucketInput = {},
): OpenClawMemoryBucket {
  if (input.bucket) return input.bucket;
  if (input.sourceTrigger?.trim()) return "snapshot";
  if (input.memoryLayer === "rule" || input.memoryType === "rule") {
    return "semantic";
  }
  return "episodic";
}

export function routeOpenClawMemoryFile(input: RouteOpenClawMemoryFileInput): OpenClawMemoryFileRoute {
  if (input.kind === "semantic") {
    return {
      kind: "semantic",
      absolutePath: input.contract.semanticMemoryFile,
      workspaceRelativePath: "memory.md",
      appendOnly: false,
    };
  }

  const dateKey = normalizeOpenClawDateKey(input.date);

  if (input.kind === "episodic_daily") {
    return {
      kind: "episodic_daily",
      absolutePath: join(input.contract.dailyDir, `${dateKey}.md`),
      workspaceRelativePath: posix.join("memory", "daily", `${dateKey}.md`),
      appendOnly: true,
      dateKey,
    };
  }

  const slug = normalizeOpenClawSnapshotSlug(input.slug);
  return {
    kind: "snapshot",
    absolutePath: join(input.contract.snapshotsDir, dateKey, `${slug}.md`),
    workspaceRelativePath: posix.join("memory", "snapshots", dateKey, `${slug}.md`),
    appendOnly: false,
    dateKey,
    slug,
  };
}

function capLines(content: string, maxLines: number): string {
  const safeMax = Number.isFinite(maxLines) && maxLines > 0 ? Math.trunc(maxLines) : 200;
  const lines = content.split(/\r?\n/);
  if (lines.length <= safeMax) {
    return content.trim();
  }
  return `${lines.slice(0, safeMax).join("\n").trim()}\n...`;
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    if (!existsSync(path)) return null;
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function resolveBootstrapDateKeys(nowInput?: Date | string): { today: string; yesterday: string } {
  const now = nowInput ? new Date(nowInput) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid now value for OpenClaw bootstrap date resolution");
  }

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return {
    today: normalizeOpenClawDateKey(now),
    yesterday: normalizeOpenClawDateKey(yesterday),
  };
}

export async function readOpenClawBootstrapContext(
  opts: ReadOpenClawBootstrapContextOptions = {},
): Promise<OpenClawBootstrapContext> {
  const workspace = await resolveOpenClawWorkspaceDirectory(opts);
  const contract = buildOpenClawPathContract(workspace.workspaceDir);
  const maxSemanticLines = opts.maxSemanticLines ?? 200;
  const maxDailyLines = opts.maxDailyLines ?? 200;
  const { today, yesterday } = resolveBootstrapDateKeys(opts.now);

  let semanticFile: string | null = null;
  let semanticContent: string | null = null;
  for (const candidate of contract.semanticMemoryCandidates) {
    const content = await readFileIfExists(candidate);
    if (!content || !content.trim()) continue;
    semanticFile = candidate;
    semanticContent = capLines(content, maxSemanticLines);
    break;
  }

  const dailyLogs: OpenClawDailyLogEntry[] = [];
  for (const dateKey of [today, yesterday]) {
    const route = routeOpenClawMemoryFile({
      contract,
      kind: "episodic_daily",
      date: dateKey,
    });
    const content = await readFileIfExists(route.absolutePath);
    if (!content || !content.trim()) continue;
    dailyLogs.push({
      dateKey,
      path: route.absolutePath,
      content: capLines(content, maxDailyLines),
    });
  }

  return {
    workspace,
    contract,
    semanticFile,
    semanticContent,
    dailyLogs,
  };
}

export function formatOpenClawBootstrapContext(input: OpenClawBootstrapContext): string | null {
  const sections: string[] = [];

  if (input.semanticContent) {
    sections.push(
      [
        "Semantic memory:",
        `Source: ${input.semanticFile ?? "unknown"}`,
        input.semanticContent,
      ].join("\n"),
    );
  }

  for (const daily of input.dailyLogs) {
    sections.push(
      [
        `Daily log (${daily.dateKey}):`,
        `Source: ${daily.path}`,
        daily.content,
      ].join("\n"),
    );
  }

  if (sections.length === 0) {
    return null;
  }

  return [
    "OpenClaw bootstrap context.",
    `Workspace: ${input.contract.workspaceDir}`,
    ...sections,
  ].join("\n\n");
}

export async function appendOpenClawDailyLog(
  content: string,
  opts: AppendOpenClawDailyLogOptions = {},
): Promise<OpenClawFileWriteResult> {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    throw new Error("OpenClaw daily log content cannot be empty");
  }

  const workspace = await resolveOpenClawWorkspaceDirectory(opts);
  const contract = buildOpenClawPathContract(workspace.workspaceDir);
  const route = routeOpenClawMemoryFile({
    contract,
    kind: "episodic_daily",
    date: opts.date,
  });

  await mkdir(dirname(route.absolutePath), { recursive: true });
  const heading = opts.heading?.trim() || `## ${new Date().toISOString()}`;
  const entry = `${heading}\n\n${normalizedContent}\n\n`;
  await appendFile(route.absolutePath, entry, "utf-8");

  return {
    workspace,
    contract,
    route,
  };
}

export async function writeOpenClawSnapshot(
  transcriptMd: string,
  opts: WriteOpenClawSnapshotOptions,
): Promise<OpenClawFileWriteResult> {
  const normalizedTranscript = transcriptMd.trim();
  if (!normalizedTranscript) {
    throw new Error("OpenClaw snapshot transcript cannot be empty");
  }

  const workspace = await resolveOpenClawWorkspaceDirectory(opts);
  const contract = buildOpenClawPathContract(workspace.workspaceDir);
  const route = routeOpenClawMemoryFile({
    contract,
    kind: "snapshot",
    date: opts.date,
    slug: opts.slug,
  });

  await mkdir(dirname(route.absolutePath), { recursive: true });
  await writeFile(route.absolutePath, `${normalizedTranscript}\n`, "utf-8");

  return {
    workspace,
    contract,
    route,
  };
}
