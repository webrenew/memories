import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.MEMORIES_DATA_DIR = mkdtempSync(join(tmpdir(), "memories-reminders-test-"));

import { getDb } from "./db.js";
import {
  computeNextReminderTime,
  createReminder,
  listReminders,
  runDueReminders,
  setReminderEnabled,
  validateCronExpression,
} from "./reminders.js";

describe("reminders", () => {
  beforeAll(async () => {
    await getDb();
  });

  it("validates cron expressions", () => {
    const valid = validateCronExpression("*/15 * * * *");
    expect(valid).toEqual({ valid: true });

    const sundayAlias = validateCronExpression("0 9 * * 7");
    expect(sundayAlias).toEqual({ valid: true });

    const weekendRange = validateCronExpression("0 9 * * 5-7");
    expect(weekendRange).toEqual({ valid: true });

    const invalid = validateCronExpression("* * *");
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.error).toContain("5 fields");
    }
  });

  it("computes next reminder timestamp", () => {
    const from = new Date(2026, 0, 1, 10, 0, 0, 0);
    const next = computeNextReminderTime("*/15 * * * *", from);
    expect(next?.getFullYear()).toBe(2026);
    expect(next?.getMonth()).toBe(0);
    expect(next?.getDate()).toBe(1);
    expect(next?.getHours()).toBe(10);
    expect(next?.getMinutes()).toBe(15);

    const nextDaily = computeNextReminderTime("0 11 * * *", new Date(2026, 0, 1, 10, 59, 0, 0));
    expect(nextDaily?.getFullYear()).toBe(2026);
    expect(nextDaily?.getMonth()).toBe(0);
    expect(nextDaily?.getDate()).toBe(1);
    expect(nextDaily?.getHours()).toBe(11);
    expect(nextDaily?.getMinutes()).toBe(0);
  });

  it("creates and lists reminders with scope filtering", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const globalReminder = await createReminder("Global reminder", {
      cronExpression: "0 * * * *",
      global: true,
      now,
    });

    const projectReminder = await createReminder("Project reminder", {
      cronExpression: "30 * * * *",
      projectId: "github.com/acme/reminders",
      now,
    });

    const projectView = await listReminders({
      includeDisabled: true,
      projectId: "github.com/acme/reminders",
    });
    expect(projectView.some((reminder) => reminder.id === globalReminder.id)).toBe(true);
    expect(projectView.some((reminder) => reminder.id === projectReminder.id)).toBe(true);

    const globalOnlyView = await listReminders({
      includeDisabled: true,
      projectId: null,
    });
    expect(globalOnlyView.some((reminder) => reminder.id === globalReminder.id)).toBe(true);
    expect(globalOnlyView.some((reminder) => reminder.id === projectReminder.id)).toBe(false);
  });

  it("runs due reminders and advances next trigger", async () => {
    const created = await createReminder("Every minute", {
      cronExpression: "* * * * *",
      global: true,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const runAt = new Date("2026-01-01T00:01:00.000Z");

    const dryRun = await runDueReminders({
      now: runAt,
      dryRun: true,
      projectId: null,
    });
    expect(dryRun.triggered.some((reminder) => reminder.id === created.id)).toBe(true);

    const executed = await runDueReminders({
      now: runAt,
      projectId: null,
    });
    expect(executed.triggered.some((reminder) => reminder.id === created.id)).toBe(true);

    const afterRun = await listReminders({
      includeDisabled: true,
      projectId: null,
    });
    const updated = afterRun.find((reminder) => reminder.id === created.id);

    expect(updated).toBeDefined();
    expect(updated?.last_triggered_at).toBe("2026-01-01T00:01:00.000Z");
    expect(updated?.next_trigger_at).toBe("2026-01-01T00:02:00.000Z");
  });

  it("disables and enables reminders", async () => {
    const created = await createReminder("Toggle schedule", {
      cronExpression: "0 8 * * *",
      global: true,
      now: new Date(2026, 0, 1, 0, 0, 0, 0),
    });

    const disabled = await setReminderEnabled(created.id, false, new Date(2026, 0, 1, 3, 0, 0, 0));
    expect(disabled).not.toBeNull();
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.next_trigger_at).toBeNull();

    const enabled = await setReminderEnabled(created.id, true, new Date(2026, 0, 1, 7, 30, 0, 0));
    expect(enabled).not.toBeNull();
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.next_trigger_at).toBe(new Date(2026, 0, 1, 8, 0, 0, 0).toISOString());
  });
});
