import { Command } from "commander";
import chalk from "chalk";
import {
  startMemorySession,
  checkpointMemorySession,
  endMemorySession,
  getMemorySessionStatus,
  getLatestActiveMemorySession,
  listMemorySessionEvents,
  createMemorySessionSnapshot,
  isMemorySessionRole,
  MEMORY_SESSION_ROLES,
  isMemorySessionEventKind,
  MEMORY_SESSION_EVENT_KINDS,
  isMemorySessionStatus,
  isMemorySessionSnapshotTrigger,
  MEMORY_SESSION_SNAPSHOT_TRIGGERS,
  type MemorySessionEvent,
} from "../lib/memory.js";
import * as ui from "../lib/ui.js";

function parseIntegerOption(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  return parsed;
}

function parseJsonMetadata(input: string | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Metadata must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid metadata JSON: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function buildTranscriptFromEvents(sessionId: string, events: MemorySessionEvent[]): string {
  const lines = events.map((event) => {
    const heading = `### ${event.role} (${event.kind})`;
    return `${heading}\n${event.content}`;
  });
  return `# Session Snapshot\n\nSession ID: ${sessionId}\n\n${lines.join("\n\n")}`;
}

export const sessionCommand = new Command("session")
  .description("Manage explicit memory sessions")
  .alias("sessions");

sessionCommand.addCommand(
  new Command("start")
    .description("Start a new memory session")
    .option("--title <title>", "Session title")
    .option("--client <client>", "Client name", "cli")
    .option("--user-id <id>", "Optional user ID")
    .option("--metadata <json>", "JSON object metadata to attach to the session")
    .option("-g, --global", "Create a global session")
    .option("--project-id <id>", "Explicit project id (e.g., github.com/org/repo)")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      title?: string;
      client?: string;
      userId?: string;
      metadata?: string;
      global?: boolean;
      projectId?: string;
      json?: boolean;
    }) => {
      try {
        if (opts.global && opts.projectId) {
          ui.error("Cannot combine --global with --project-id");
          process.exit(1);
        }

        const metadata = parseJsonMetadata(opts.metadata);
        const session = await startMemorySession({
          title: opts.title,
          client: opts.client,
          userId: opts.userId,
          metadata,
          global: opts.global,
          projectId: opts.projectId,
        });

        if (opts.json) {
          console.log(JSON.stringify(session, null, 2));
          return;
        }

        ui.success(`Started session ${chalk.dim(session.id)}`);
        ui.dim(`Scope: ${session.scope}${session.project_id ? ` (${session.project_id})` : ""} • Status: ${session.status}`);
      } catch (error) {
        ui.error(`Failed to start session: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    })
);

sessionCommand.addCommand(
  new Command("checkpoint")
    .description("Add a checkpoint event to a session")
    .argument("<session-id>", "Session ID")
    .argument("<content...>", "Checkpoint content")
    .option("--role <role>", `Role: ${MEMORY_SESSION_ROLES.join(", ")}`, "assistant")
    .option("--kind <kind>", `Event kind: ${MEMORY_SESSION_EVENT_KINDS.join(", ")}`, "checkpoint")
    .option("--token-count <n>", "Optional token count for this event")
    .option("--turn-index <n>", "Optional turn index for this event")
    .option("--not-meaningful", "Mark this event as non-meaningful")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, contentParts: string[], opts: {
      role?: string;
      kind?: string;
      tokenCount?: string;
      turnIndex?: string;
      notMeaningful?: boolean;
      json?: boolean;
    }) => {
      try {
        const content = contentParts.join(" ").trim();
        if (!content) {
          ui.error("Checkpoint content cannot be empty");
          process.exit(1);
        }

        const role = opts.role ?? "assistant";
        if (!isMemorySessionRole(role)) {
          ui.error(`Invalid role "${role}". Valid roles: ${MEMORY_SESSION_ROLES.join(", ")}`);
          process.exit(1);
        }

        const kind = opts.kind ?? "checkpoint";
        if (!isMemorySessionEventKind(kind)) {
          ui.error(`Invalid kind "${kind}". Valid kinds: ${MEMORY_SESSION_EVENT_KINDS.join(", ")}`);
          process.exit(1);
        }

        const tokenCount = parseIntegerOption(opts.tokenCount, "token-count");
        const turnIndex = parseIntegerOption(opts.turnIndex, "turn-index");
        const event = await checkpointMemorySession(sessionId, content, {
          role,
          kind,
          tokenCount,
          turnIndex,
          isMeaningful: !opts.notMeaningful,
        });

        if (opts.json) {
          console.log(JSON.stringify(event, null, 2));
          return;
        }

        ui.success(`Checkpointed session ${chalk.dim(event.session_id)} with event ${chalk.dim(event.id)}`);
      } catch (error) {
        ui.error(`Failed to checkpoint session: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    })
);

sessionCommand.addCommand(
  new Command("status")
    .description("Show status for a session (or the latest active session)")
    .argument("[session-id]", "Session ID (optional)")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string | undefined, opts: { json?: boolean }) => {
      try {
        const resolvedSessionId = sessionId ?? (await getLatestActiveMemorySession())?.id;
        if (!resolvedSessionId) {
          console.log(chalk.dim("No active sessions found."));
          return;
        }

        const summary = await getMemorySessionStatus(resolvedSessionId);
        if (!summary) {
          ui.error(`Session ${resolvedSessionId} not found`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }

        const { session } = summary;
        console.log(chalk.bold(`Session ${session.id}`));
        console.log(chalk.dim(`  scope: ${session.scope}${session.project_id ? ` (${session.project_id})` : ""}`));
        console.log(chalk.dim(`  status: ${session.status}`));
        console.log(chalk.dim(`  started: ${formatTimestamp(session.started_at)}`));
        console.log(chalk.dim(`  last activity: ${formatTimestamp(session.last_activity_at)}`));
        console.log(chalk.dim(`  ended: ${formatTimestamp(session.ended_at)}`));
        console.log(chalk.dim(`  events: ${summary.eventCount} (checkpoints: ${summary.checkpointCount})`));
        console.log(chalk.dim(`  snapshots: ${summary.snapshotCount}`));
        if (summary.latestCheckpointId) {
          console.log(chalk.dim(`  latest checkpoint: ${summary.latestCheckpointId} at ${formatTimestamp(summary.latestCheckpointAt)}`));
        }
      } catch (error) {
        ui.error(`Failed to read session status: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    })
);

sessionCommand.addCommand(
  new Command("end")
    .description("End a session")
    .argument("<session-id>", "Session ID")
    .option("--status <status>", "Final status: compacted or closed", "closed")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, opts: { status?: string; json?: boolean }) => {
      try {
        const status = opts.status ?? "closed";
        if (!isMemorySessionStatus(status) || status === "active") {
          ui.error('Invalid status. Valid end statuses: "closed", "compacted"');
          process.exit(1);
        }

        const session = await endMemorySession(sessionId, { status });
        if (!session) {
          ui.error(`Session ${sessionId} not found`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(session, null, 2));
          return;
        }

        ui.success(`Ended session ${chalk.dim(session.id)} as ${session.status}`);
      } catch (error) {
        ui.error(`Failed to end session: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    })
);

sessionCommand.addCommand(
  new Command("snapshot")
    .description("Create a raw snapshot from recent session events")
    .argument("<session-id>", "Session ID")
    .option("--trigger <trigger>", `Source trigger: ${MEMORY_SESSION_SNAPSHOT_TRIGGERS.join(", ")}`, "manual")
    .option("--slug <slug>", "Optional custom snapshot slug")
    .option("-m, --messages <n>", "Number of events to include when transcript isn't provided", "15")
    .option("--include-noise", "Include non-meaningful events in auto-generated snapshot")
    .option("--transcript <markdown>", "Explicit transcript markdown")
    .option("--json", "Output as JSON")
    .action(async (sessionId: string, opts: {
      trigger?: string;
      slug?: string;
      messages?: string;
      includeNoise?: boolean;
      transcript?: string;
      json?: boolean;
    }) => {
      try {
        const trigger = opts.trigger ?? "manual";
        if (!isMemorySessionSnapshotTrigger(trigger)) {
          ui.error(`Invalid trigger "${trigger}". Valid triggers: ${MEMORY_SESSION_SNAPSHOT_TRIGGERS.join(", ")}`);
          process.exit(1);
        }

        const requestedMessages = parseIntegerOption(opts.messages, "messages") ?? 15;
        const transcriptFromArg = opts.transcript?.trim();

        let transcriptMd = transcriptFromArg ?? "";
        let messageCount = 0;
        if (!transcriptFromArg) {
          const events = await listMemorySessionEvents(sessionId, {
            limit: requestedMessages,
            meaningfulOnly: !opts.includeNoise,
          });
          if (events.length === 0) {
            ui.error(`No session events available to snapshot for ${sessionId}`);
            process.exit(1);
          }
          transcriptMd = buildTranscriptFromEvents(sessionId, events);
          messageCount = events.length;
        } else {
          messageCount = requestedMessages;
        }

        const snapshot = await createMemorySessionSnapshot(sessionId, {
          slug: opts.slug,
          sourceTrigger: trigger,
          transcriptMd,
          messageCount,
        });

        if (opts.json) {
          console.log(JSON.stringify(snapshot, null, 2));
          return;
        }

        ui.success(`Created snapshot ${chalk.dim(snapshot.id)} (${snapshot.slug}) for session ${chalk.dim(snapshot.session_id)}`);
      } catch (error) {
        ui.error(`Failed to create snapshot: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exit(1);
      }
    })
);
