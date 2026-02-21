#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPORT_SCHEMA_VERSION = 1;

function trimNullable(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBooleanFlag(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseIntFlag(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1) return value.toFixed(2).replace(/\.00$/, "");
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function toWorkspaceKey(target, index) {
  const key = trimNullable(target.key);
  if (key) return key;
  if (target.tenantId) return `tenant:${target.tenantId}`;
  if (target.projectId) return `project:${target.projectId}`;
  if (target.userId) return `user:${target.userId}`;
  return `workspace-${index + 1}`;
}

function parseTargetsFromEnv() {
  const raw = process.env.MEMORIES_GRAPH_ROLLOUT_TARGETS_JSON;
  if (!raw) {
    return [
      {
        key: "api-key-default",
        name: "API key default workspace",
        tenantId: null,
        projectId: null,
        userId: null,
      },
    ];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `MEMORIES_GRAPH_ROLLOUT_TARGETS_JSON must be valid JSON array. ${(error instanceof Error && error.message) || "Unknown parse error"}`
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("MEMORIES_GRAPH_ROLLOUT_TARGETS_JSON must be a non-empty JSON array.");
  }

  return parsed.map((target, index) => {
    if (!target || typeof target !== "object") {
      throw new Error(`Target at index ${index} must be an object.`);
    }

    return {
      key: toWorkspaceKey(target, index),
      name: trimNullable(target.name) ?? `Workspace ${index + 1}`,
      tenantId: trimNullable(target.tenantId),
      projectId: trimNullable(target.projectId),
      userId: trimNullable(target.userId),
    };
  });
}

function ensureBaselineMetric(metric) {
  return {
    metric: trimNullable(metric?.metric) ?? "unknown",
    comparator: metric?.comparator === "<=" ? "<=" : ">=",
    target: Number(metric?.target) || 0,
    current: Number(metric?.current) || 0,
    gapToGoal: Number(metric?.gapToGoal) || 0,
    ready: Boolean(metric?.ready),
  };
}

function ensureStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value)).filter((value) => value.length > 0);
}

async function fetchRolloutSnapshot(params) {
  const url = new URL(`${params.apiBaseUrl}/api/sdk/v1/graph/rollout`);
  if (params.target.tenantId) url.searchParams.set("tenantId", params.target.tenantId);
  if (params.target.projectId) url.searchParams.set("projectId", params.target.projectId);
  if (params.target.userId) url.searchParams.set("userId", params.target.userId);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Non-JSON response from ${url.toString()} (${response.status}).`);
  }

  if (!response.ok || payload?.ok !== true) {
    const code = payload?.error?.code ?? "UNKNOWN";
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Rollout request failed for ${params.target.key}: ${code} ${message}`);
  }

  const data = payload?.data ?? {};
  const plan = data?.rolloutPlan ?? {};
  const qualityGate = data?.qualityGate ?? {};
  const retrievalPolicy = data?.retrievalPolicy ?? {};

  return {
    capturedAt: params.generatedAt,
    workspace: {
      key: params.target.key,
      name: params.target.name,
      tenantId: params.target.tenantId,
      projectId: params.target.projectId,
      userId: params.target.userId,
      scope: data?.scope ?? null,
    },
    rollout: {
      mode: trimNullable(data?.rollout?.mode) ?? "off",
      updatedAt: trimNullable(data?.rollout?.updatedAt),
      updatedBy: trimNullable(data?.rollout?.updatedBy),
      recommendedMode: trimNullable(plan?.recommendedMode) ?? "off",
      defaultBehaviorDecision: trimNullable(plan?.defaultBehaviorDecision) ?? "hold_lexical_default",
      readyForDefaultOn: Boolean(plan?.readyForDefaultOn),
      blockerCodes: ensureStringArray(plan?.blockerCodes),
      rationale: trimNullable(plan?.rationale) ?? "",
      qualityStatus: trimNullable(qualityGate?.status) ?? "unknown",
      qualityCanaryBlocked: Boolean(qualityGate?.canaryBlocked),
      retrievalPolicyDefaultStrategy: trimNullable(retrievalPolicy?.defaultStrategy) ?? "lexical",
    },
    baseline: Array.isArray(plan?.baseline) ? plan.baseline.map(ensureBaselineMetric) : [],
  };
}

function loadHistory(historyPath) {
  if (!existsSync(historyPath)) {
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      updatedAt: null,
      workspaces: {},
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(historyPath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.workspaces !== "object" ||
      parsed.workspaces === null
    ) {
      throw new Error("Invalid history format.");
    }
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      updatedAt: trimNullable(parsed.updatedAt),
      workspaces: parsed.workspaces,
    };
  } catch (error) {
    throw new Error(`Failed to parse ${historyPath}: ${(error instanceof Error && error.message) || "Unknown error"}`);
  }
}

function summarizeWorkspace(entry, trendWindow) {
  const snapshots = Array.isArray(entry.snapshots) ? entry.snapshots : [];
  if (snapshots.length === 0) return null;

  const current = snapshots[snapshots.length - 1];
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const trendSlice = snapshots.slice(-trendWindow);

  const blockerCounts = {};
  for (const snapshot of trendSlice) {
    for (const blockerCode of ensureStringArray(snapshot?.rollout?.blockerCodes)) {
      blockerCounts[blockerCode] = (blockerCounts[blockerCode] ?? 0) + 1;
    }
  }

  const blockerTrend = Object.entries(blockerCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  const currentBlockers = ensureStringArray(current?.rollout?.blockerCodes);
  const previousBlockers = ensureStringArray(previous?.rollout?.blockerCodes);
  const introducedBlockers = currentBlockers.filter((code) => !previousBlockers.includes(code));
  const resolvedBlockers = previousBlockers.filter((code) => !currentBlockers.includes(code));
  const readinessRegressed = Boolean(previous?.rollout?.readyForDefaultOn && !current?.rollout?.readyForDefaultOn);

  return {
    workspace: current.workspace,
    snapshotCount: snapshots.length,
    current,
    blockerTrend,
    recommendationHistory: snapshots.slice(-12).map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      recommendedMode: snapshot.rollout.recommendedMode,
      defaultBehaviorDecision: snapshot.rollout.defaultBehaviorDecision,
      readyForDefaultOn: snapshot.rollout.readyForDefaultOn,
      blockerCodes: snapshot.rollout.blockerCodes,
    })),
    regression: {
      readinessRegressed,
      introducedBlockers,
      resolvedBlockers,
      active: readinessRegressed || introducedBlockers.length > 0,
    },
  };
}

function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# Graph Rollout Baseline Report");
  lines.push("");
  lines.push(`Generated at: \`${report.generatedAt}\``);
  lines.push(`API base URL: \`${report.apiBaseUrl}\``);
  lines.push(`Trend window: last \`${report.trendWindow}\` snapshots per workspace`);
  lines.push("");
  lines.push("## Regression Alerts");
  lines.push("");

  if (report.regressions.length === 0) {
    lines.push("No readiness regressions detected in the latest snapshot.");
  } else {
    lines.push("| Workspace | Readiness regressed | Introduced blockers | Resolved blockers |");
    lines.push("| --- | --- | --- | --- |");
    for (const regression of report.regressions) {
      lines.push(
        `| \`${regression.workspaceKey}\` | ${regression.readinessRegressed ? "yes" : "no"} | ${
          regression.introducedBlockers.length > 0
            ? regression.introducedBlockers.map((code) => `\`${code}\``).join(", ")
            : "none"
        } | ${
          regression.resolvedBlockers.length > 0
            ? regression.resolvedBlockers.map((code) => `\`${code}\``).join(", ")
            : "none"
        } |`
      );
    }
  }

  for (const summary of report.workspaces) {
    const current = summary.current;
    const baseline = Array.isArray(current.baseline) ? current.baseline : [];

    lines.push("");
    lines.push(`## Workspace: ${current.workspace.name}`);
    lines.push("");
    lines.push(`- Workspace key: \`${current.workspace.key}\``);
    lines.push(`- Tenant: \`${current.workspace.tenantId ?? "(default)"}\``);
    lines.push(`- Project: \`${current.workspace.projectId ?? "(all)"}\``);
    lines.push(`- User: \`${current.workspace.userId ?? "(all)"}\``);
    lines.push(`- Rollout mode: \`${current.rollout.mode}\``);
    lines.push(`- Recommended mode: \`${current.rollout.recommendedMode}\``);
    lines.push(`- Default behavior decision: \`${current.rollout.defaultBehaviorDecision}\``);
    lines.push(`- Ready for default-on: \`${current.rollout.readyForDefaultOn ? "yes" : "no"}\``);
    lines.push(`- Current blockers: ${current.rollout.blockerCodes.length > 0 ? current.rollout.blockerCodes.map((code) => `\`${code}\``).join(", ") : "none"}`);
    lines.push(`- Retrieval policy default strategy: \`${current.rollout.retrievalPolicyDefaultStrategy}\``);
    lines.push(`- Latest quality status: \`${current.rollout.qualityStatus}\``);
    lines.push(`- Snapshots retained: \`${summary.snapshotCount}\``);
    lines.push("");
    lines.push("### Gap-to-goal baseline");
    lines.push("");
    lines.push("| Metric | Current | Comparator | Target | Gap To Goal | Ready |");
    lines.push("| --- | --- | --- | --- | --- | --- |");

    for (const metric of baseline) {
      lines.push(
        `| \`${metric.metric}\` | \`${formatNumber(metric.current)}\` | \`${metric.comparator}\` | \`${formatNumber(metric.target)}\` | \`${formatNumber(metric.gapToGoal)}\` | \`${metric.ready ? "yes" : "no"}\` |`
      );
    }

    if (baseline.length === 0) {
      lines.push("| _none_ | - | - | - | - | - |");
    }

    lines.push("");
    lines.push(`### Blocker trends (last ${report.trendWindow} snapshots)`);
    lines.push("");
    if (summary.blockerTrend.length === 0) {
      lines.push("No blocker codes observed in the trend window.");
    } else {
      lines.push("| Blocker code | Occurrences |");
      lines.push("| --- | --- |");
      for (const trend of summary.blockerTrend) {
        lines.push(`| \`${trend.code}\` | \`${trend.count}\` |`);
      }
    }

    lines.push("");
    lines.push("### Promotion recommendation history (latest 12)");
    lines.push("");
    lines.push("| Captured at | Recommended mode | Default behavior decision | Ready for default-on | Blockers |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const item of summary.recommendationHistory) {
      lines.push(
        `| \`${item.capturedAt}\` | \`${item.recommendedMode}\` | \`${item.defaultBehaviorDecision}\` | \`${item.readyForDefaultOn ? "yes" : "no"}\` | ${
          item.blockerCodes.length > 0 ? item.blockerCodes.map((code) => `\`${code}\``).join(", ") : "none"
        } |`
      );
    }
  }

  lines.push("");
  lines.push("## Alerting Path");
  lines.push("");
  lines.push(
    "This report generator exits with status code `2` when `MEMORIES_GRAPH_ROLLOUT_FAIL_ON_REGRESSION=true` and readiness regresses or new blockers appear."
  );
  lines.push(
    "Use the scheduled workflow failure notification path (GitHub Actions notifications / on-call routing) as the readiness regression alert."
  );

  return `${lines.join("\n")}\n`;
}

async function main() {
  const apiKey = trimNullable(process.env.MEMORIES_GRAPH_ROLLOUT_API_KEY);
  if (!apiKey) {
    throw new Error(
      "MEMORIES_GRAPH_ROLLOUT_API_KEY is required. Configure it as a GitHub Actions secret for scheduled report runs."
    );
  }

  const apiBaseUrl = (trimNullable(process.env.MEMORIES_GRAPH_ROLLOUT_API_BASE_URL) ?? "https://memories.sh").replace(
    /\/+$/,
    ""
  );
  const targets = parseTargetsFromEnv();
  const failOnRegression = parseBooleanFlag(process.env.MEMORIES_GRAPH_ROLLOUT_FAIL_ON_REGRESSION, false);
  const maxSnapshotsPerWorkspace = parseIntFlag(process.env.MEMORIES_GRAPH_ROLLOUT_MAX_SNAPSHOTS, 180);
  const trendWindow = parseIntFlag(process.env.MEMORIES_GRAPH_ROLLOUT_TREND_WINDOW, 20);
  const outputDir = trimNullable(process.env.MEMORIES_GRAPH_ROLLOUT_REPORT_DIR) ?? join(process.cwd(), "reports", "graph-rollout");

  mkdirSync(outputDir, { recursive: true });
  const historyPath = join(outputDir, "history.json");
  const latestJsonPath = join(outputDir, "latest.json");
  const latestMdPath = join(outputDir, "latest.md");

  const generatedAt = new Date().toISOString();
  const history = loadHistory(historyPath);
  const nextHistory = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    updatedAt: generatedAt,
    workspaces: { ...history.workspaces },
  };

  const currentSnapshots = [];
  for (const target of targets) {
    const snapshot = await fetchRolloutSnapshot({
      apiBaseUrl,
      apiKey,
      target,
      generatedAt,
    });
    currentSnapshots.push(snapshot);

    const entry = nextHistory.workspaces[target.key] ?? {
      workspace: snapshot.workspace,
      snapshots: [],
    };

    const snapshots = Array.isArray(entry.snapshots) ? [...entry.snapshots, snapshot] : [snapshot];
    entry.workspace = snapshot.workspace;
    entry.snapshots = snapshots.slice(-maxSnapshotsPerWorkspace);
    nextHistory.workspaces[target.key] = entry;
  }

  const workspaceSummaries = Object.values(nextHistory.workspaces)
    .map((entry) => summarizeWorkspace(entry, trendWindow))
    .filter((summary) => summary !== null)
    .sort((left, right) => left.workspace.key.localeCompare(right.workspace.key));

  const regressions = workspaceSummaries
    .filter((summary) => summary.regression.active)
    .map((summary) => ({
      workspaceKey: summary.workspace.key,
      workspaceName: summary.workspace.name,
      readinessRegressed: summary.regression.readinessRegressed,
      introducedBlockers: summary.regression.introducedBlockers,
      resolvedBlockers: summary.regression.resolvedBlockers,
    }));

  const latestReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    apiBaseUrl,
    trendWindow,
    currentTargets: currentSnapshots.map((snapshot) => snapshot.workspace),
    regressions,
    workspaces: workspaceSummaries,
  };

  writeFileSync(historyPath, `${JSON.stringify(nextHistory, null, 2)}\n`);
  writeFileSync(latestJsonPath, `${JSON.stringify(latestReport, null, 2)}\n`);
  writeFileSync(latestMdPath, renderMarkdownReport(latestReport));

  console.log("Graph rollout baseline report updated:");
  console.log(`- ${historyPath}`);
  console.log(`- ${latestJsonPath}`);
  console.log(`- ${latestMdPath}`);
  console.log(`Workspaces processed: ${workspaceSummaries.length}`);
  console.log(`Regressions detected: ${regressions.length}`);

  if (failOnRegression && regressions.length > 0) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("Failed to generate graph rollout baseline report.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
