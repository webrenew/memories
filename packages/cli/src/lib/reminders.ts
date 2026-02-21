import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { getProjectId } from "./git.js";

export type ReminderScope = "global" | "project";

export interface Reminder {
  id: string;
  message: string;
  cron_expression: string;
  scope: ReminderScope;
  project_id: string | null;
  enabled: boolean;
  last_triggered_at: string | null;
  next_trigger_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateReminderOpts {
  cronExpression: string;
  global?: boolean;
  projectId?: string | null;
  now?: Date;
}

export interface ListReminderOpts {
  includeDisabled?: boolean;
  projectId?: string | null;
}

export interface RunDueReminderOpts {
  now?: Date;
  dryRun?: boolean;
  projectId?: string | null;
}

export interface RunDueReminderResult {
  checkedCount: number;
  triggered: Reminder[];
}

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
}

interface ReminderRow {
  id: string;
  message: string;
  cron_expression: string;
  scope: ReminderScope;
  project_id: string | null;
  enabled: number | string | boolean;
  last_triggered_at: string | null;
  next_trigger_at: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_NEXT_SEARCH_MINUTES = 60 * 24 * 366; // one year + leap day

function parseNumericValue(raw: string, min: number, max: number, field: string, allowDowSeven = false): number {
  const normalizedRaw = raw.trim();
  if (!/^\d+$/.test(normalizedRaw)) {
    throw new Error(`Invalid ${field} value "${raw}"`);
  }

  const value = Number.parseInt(normalizedRaw, 10);
  const upperBound = allowDowSeven ? max + 1 : max;
  if (value < min || value > upperBound) {
    const expected = allowDowSeven ? `${min}-${max} (7 allowed as Sunday)` : `${min}-${max}`;
    throw new Error(`Out-of-range ${field} value "${raw}" (expected ${expected})`);
  }

  return value;
}

function addRangeWithStep(
  destination: Set<number>,
  start: number,
  end: number,
  step: number,
  min: number,
  max: number,
  field: string,
  allowDowSeven = false
): void {
  if (step <= 0) {
    throw new Error(`Invalid ${field} step "${step}"`);
  }
  const upperBound = allowDowSeven ? max + 1 : max;
  if (start < min || end > upperBound || start > end) {
    throw new Error(`Invalid ${field} range "${start}-${end}"`);
  }

  for (let value = start; value <= end; value += step) {
    destination.add(allowDowSeven && value === 7 ? 0 : value);
  }
}

function parseField(field: string, min: number, max: number, label: string, allowDowSeven = false): Set<number> {
  const result = new Set<number>();
  const segments = field.split(",");

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) {
      throw new Error(`Invalid empty ${label} segment in "${field}"`);
    }

    const [rangePartRaw, stepPartRaw] = segment.split("/");
    const rangePart = rangePartRaw.trim();
    const step = stepPartRaw === undefined ? 1 : Number.parseInt(stepPartRaw, 10);

    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid ${label} step in segment "${segment}"`);
    }

    if (rangePart === "*") {
      addRangeWithStep(result, min, max, step, min, max, label, allowDowSeven);
      continue;
    }

    if (rangePart.includes("-")) {
      const [startRaw, endRaw] = rangePart.split("-");
      const start = parseNumericValue(startRaw, min, max, label, allowDowSeven);
      const end = parseNumericValue(endRaw, min, max, label, allowDowSeven);
      addRangeWithStep(result, start, end, step, min, max, label, allowDowSeven);
      continue;
    }

    const single = parseNumericValue(rangePart, min, max, label, allowDowSeven);
    addRangeWithStep(result, single, single, step, min, max, label, allowDowSeven);
  }

  if (result.size === 0) {
    throw new Error(`No values parsed for ${label} field "${field}"`);
  }

  return result;
}

function isWildcardField(values: Set<number>, min: number, max: number): boolean {
  const expectedSize = max - min + 1;
  if (values.size !== expectedSize) {
    return false;
  }

  for (let value = min; value <= max; value += 1) {
    if (!values.has(value)) {
      return false;
    }
  }
  return true;
}

function parseCronExpression(cronExpression: string): ParsedCron {
  const trimmed = cronExpression.trim().replace(/\s+/g, " ");
  const parts = trimmed.split(" ");

  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields (received ${parts.length})`);
  }

  const minutes = parseField(parts[0], 0, 59, "minute");
  const hours = parseField(parts[1], 0, 23, "hour");
  const dayOfMonth = parseField(parts[2], 1, 31, "day-of-month");
  const month = parseField(parts[3], 1, 12, "month");
  const dayOfWeek = parseField(parts[4], 0, 6, "day-of-week", true);

  return {
    minutes,
    hours,
    dayOfMonth,
    month,
    dayOfWeek,
    dayOfMonthAny: isWildcardField(dayOfMonth, 1, 31),
    dayOfWeekAny: isWildcardField(dayOfWeek, 0, 6),
  };
}

function cronMatches(parsed: ParsedCron, value: Date): boolean {
  if (!parsed.minutes.has(value.getMinutes())) return false;
  if (!parsed.hours.has(value.getHours())) return false;
  if (!parsed.month.has(value.getMonth() + 1)) return false;

  const dayOfMonthMatch = parsed.dayOfMonth.has(value.getDate());
  const dayOfWeekMatch = parsed.dayOfWeek.has(value.getDay());

  if (parsed.dayOfMonthAny && parsed.dayOfWeekAny) return true;
  if (parsed.dayOfMonthAny) return dayOfWeekMatch;
  if (parsed.dayOfWeekAny) return dayOfMonthMatch;
  return dayOfMonthMatch || dayOfWeekMatch;
}

export function validateCronExpression(cronExpression: string): { valid: true } | { valid: false; error: string } {
  try {
    parseCronExpression(cronExpression);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid cron expression",
    };
  }
}

export function computeNextReminderTime(cronExpression: string, from: Date = new Date()): Date | null {
  const parsed = parseCronExpression(cronExpression);
  const probe = new Date(from);
  probe.setSeconds(0, 0);
  probe.setMinutes(probe.getMinutes() + 1);

  for (let scanned = 0; scanned < MAX_NEXT_SEARCH_MINUTES; scanned += 1) {
    if (cronMatches(parsed, probe)) {
      return new Date(probe);
    }
    probe.setMinutes(probe.getMinutes() + 1);
  }

  return null;
}

function normalizeReminderRow(row: ReminderRow): Reminder {
  const enabledValue = row.enabled;
  return {
    ...row,
    enabled:
      enabledValue === true ||
      enabledValue === 1 ||
      enabledValue === "1" ||
      String(enabledValue).toLowerCase() === "true",
  };
}

function buildScopeSql(projectId: string | null): { clause: string; args: string[] } {
  if (!projectId) {
    return {
      clause: "scope = 'global'",
      args: [],
    };
  }

  return {
    clause: "(scope = 'global' OR (scope = 'project' AND project_id = ?))",
    args: [projectId],
  };
}

export async function createReminder(message: string, opts: CreateReminderOpts): Promise<Reminder> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new Error("Reminder message cannot be empty");
  }

  const validation = validateCronExpression(opts.cronExpression);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const now = opts.now ?? new Date();
  const nextTrigger = computeNextReminderTime(opts.cronExpression, now);
  if (!nextTrigger) {
    throw new Error("Could not compute next reminder time from cron expression");
  }

  let scope: ReminderScope = "global";
  let projectId: string | null = null;
  if (!opts.global) {
    projectId = opts.projectId ?? getProjectId();
    if (projectId) {
      scope = "project";
    }
  }

  const db = await getDb();
  const id = nanoid(12);
  const nowIso = now.toISOString();
  await db.execute({
    sql: `INSERT INTO reminders (
            id,
            message,
            cron_expression,
            scope,
            project_id,
            enabled,
            last_triggered_at,
            next_trigger_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
    args: [id, trimmedMessage, opts.cronExpression.trim(), scope, projectId, nextTrigger.toISOString(), nowIso, nowIso],
  });

  const created = await db.execute({
    sql: "SELECT * FROM reminders WHERE id = ? LIMIT 1",
    args: [id],
  });
  return normalizeReminderRow(created.rows[0] as unknown as ReminderRow);
}

export async function listReminders(opts?: ListReminderOpts): Promise<Reminder[]> {
  const db = await getDb();
  const includeDisabled = opts?.includeDisabled ?? false;
  const projectId = opts?.projectId === undefined ? getProjectId() : opts.projectId;
  const scopeFilter = buildScopeSql(projectId);

  const args: (string | number)[] = [...scopeFilter.args];
  const enabledSql = includeDisabled ? "" : "AND enabled = 1";
  const result = await db.execute({
    sql: `SELECT * FROM reminders
          WHERE ${scopeFilter.clause}
            ${enabledSql}
          ORDER BY enabled DESC, next_trigger_at IS NULL, next_trigger_at ASC, created_at DESC`,
    args,
  });

  return result.rows.map((row) => normalizeReminderRow(row as unknown as ReminderRow));
}

export async function setReminderEnabled(id: string, enabled: boolean, now: Date = new Date()): Promise<Reminder | null> {
  const db = await getDb();

  const existing = await db.execute({
    sql: "SELECT * FROM reminders WHERE id = ? LIMIT 1",
    args: [id],
  });
  if (existing.rows.length === 0) return null;

  const reminder = normalizeReminderRow(existing.rows[0] as unknown as ReminderRow);
  const nextTrigger = enabled ? computeNextReminderTime(reminder.cron_expression, now) : null;

  await db.execute({
    sql: `UPDATE reminders
          SET enabled = ?,
              next_trigger_at = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [enabled ? 1 : 0, nextTrigger?.toISOString() ?? null, now.toISOString(), id],
  });

  const updated = await db.execute({
    sql: "SELECT * FROM reminders WHERE id = ? LIMIT 1",
    args: [id],
  });
  return normalizeReminderRow(updated.rows[0] as unknown as ReminderRow);
}

export async function deleteReminder(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: "DELETE FROM reminders WHERE id = ?",
    args: [id],
  });

  return Number(result.rowsAffected ?? 0) > 0;
}

export async function runDueReminders(opts?: RunDueReminderOpts): Promise<RunDueReminderResult> {
  const db = await getDb();
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const projectId = opts?.projectId === undefined ? getProjectId() : opts.projectId;
  const scopeFilter = buildScopeSql(projectId);

  const activeCountResult = await db.execute({
    sql: `SELECT COUNT(*) as count
          FROM reminders
          WHERE ${scopeFilter.clause}
            AND enabled = 1`,
    args: scopeFilter.args,
  });
  const checkedCount = Number((activeCountResult.rows[0] as { count?: unknown })?.count ?? 0);

  const dueResult = await db.execute({
    sql: `SELECT * FROM reminders
          WHERE ${scopeFilter.clause}
            AND enabled = 1
            AND next_trigger_at IS NOT NULL
            AND next_trigger_at <= ?
          ORDER BY next_trigger_at ASC`,
    args: [...scopeFilter.args, nowIso],
  });

  const triggered = dueResult.rows.map((row) => normalizeReminderRow(row as unknown as ReminderRow));

  if (!opts?.dryRun) {
    for (const reminder of triggered) {
      const nextTrigger = computeNextReminderTime(reminder.cron_expression, now);
      await db.execute({
        sql: `UPDATE reminders
              SET last_triggered_at = ?,
                  next_trigger_at = ?,
                  enabled = ?,
                  updated_at = ?
              WHERE id = ?`,
        args: [nowIso, nextTrigger?.toISOString() ?? null, nextTrigger ? 1 : 0, nowIso, reminder.id],
      });
    }
  }

  return {
    checkedCount,
    triggered,
  };
}
