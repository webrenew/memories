import { Command } from "commander";
import ora from "ora";
import { createDatabase, createDatabaseToken } from "../lib/turso.js";
import { saveSyncConfig, readSyncConfig, resetDb, syncDb } from "../lib/db.js";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { readAuth, getApiClient } from "../lib/auth.js";
import * as ui from "../lib/ui.js";

const DB_PATH = join(homedir(), ".config", "memories", "local.db");

interface CredentialResponse {
  url?: string;
  token?: string;
  dbName?: string | null;
  turso_db_url?: string;
  turso_db_token?: string;
  turso_db_name?: string | null;
}

function inferDbName(syncUrl: string | undefined): string | null {
  if (!syncUrl) return null;
  try {
    const host = new URL(syncUrl.replace("libsql://", "https://")).hostname;
    const firstLabel = host.split(".")[0];
    return firstLabel || null;
  } catch {
    return null;
  }
}

export const syncCommand = new Command("sync").description(
  "Manage remote sync"
);

syncCommand
  .command("enable")
  .description("Provision a cloud database and enable sync")
  .option("-o, --org <org>", "Turso organization", "webrenew")
  .action(async (opts: { org: string }) => {
    const existing = await readSyncConfig();
    if (existing) {
      ui.info(`Sync already enabled`);
      ui.dim(`Remote: ${existing.syncUrl}`);
      ui.dim(`Run ${ui.success} memories sync push to sync now.`);
      return;
    }

    // If logged in via web, fetch provisioned creds from the API
    const auth = await readAuth();
    if (auth) {
      const spinner = ora("Fetching cloud database credentials...").start();
      try {
        const apiFetch = getApiClient(auth);
        const res = await apiFetch("/api/db/provision", { method: "POST" });
        if (res.ok) {
          const data = (await res.json()) as { url: string };

          const profileRes = await apiFetch("/api/db/credentials");
          if (profileRes.ok) {
            const creds = (await profileRes.json()) as CredentialResponse;
            const syncUrl = creds.url ?? creds.turso_db_url;
            const syncToken = creds.token ?? creds.turso_db_token;
            const dbName = creds.dbName ?? creds.turso_db_name ?? inferDbName(syncUrl);

            if (!syncUrl || !syncToken || !dbName) {
              throw new Error("Incomplete credential response from /api/db/credentials");
            }

            if (existsSync(DB_PATH)) {
              resetDb();
              unlinkSync(DB_PATH);
            }

            await saveSyncConfig({
              syncUrl,
              syncToken,
              org: opts.org,
              dbName,
            });

            spinner.text = "Waiting for database to be ready...";
            await delay(3000);

            resetDb();
            await syncDb();

            spinner.stop();
            ui.success("Cloud sync enabled");
            ui.dim(`Remote: ${data.url}`);
            ui.dim(`Database: ${dbName}`);
            return;
          }
        }
        spinner.stop();
      } catch {
        spinner.stop();
        ui.warn("Could not fetch credentials from web, provisioning directly...");
      }
    } else {
      ui.warn("Not logged in");
      ui.proFeature("Cloud sync");
      return;
    }

    // Fallback: provision directly via Turso Platform API
    const spinner = ora(`Creating database in ${opts.org}...`).start();
    const db = await createDatabase(opts.org);
    spinner.text = "Generating auth token...";
    const token = await createDatabaseToken(opts.org, db.name);

    const syncUrl = `libsql://${db.hostname}`;

    if (existsSync(DB_PATH)) {
      resetDb();
      unlinkSync(DB_PATH);
    }

    await saveSyncConfig({
      syncUrl,
      syncToken: token,
      org: opts.org,
      dbName: db.name,
    });

    spinner.text = "Waiting for database to be ready...";
    await delay(3000);

    resetDb();
    await syncDb();

    spinner.stop();
    ui.success("Cloud sync enabled");
    ui.dim(`Remote: ${syncUrl}`);
    ui.dim(`Database: ${db.name}`);
  });

syncCommand
  .command("push")
  .description("Push local changes to remote")
  .action(async () => {
    const config = await readSyncConfig();
    if (!config) {
      ui.error("Sync not enabled");
      ui.dim(`Run ${("memories sync enable")} first, or ${("memories login")} to set up cloud sync.`);
      process.exitCode = 1;
      return;
    }

    const spinner = ora("Syncing to remote...").start();
    await syncDb();
    spinner.stop();
    ui.success("Synced to remote");
  });

syncCommand
  .command("status")
  .description("Show sync configuration")
  .action(async () => {
    const config = await readSyncConfig();
    if (!config) {
      ui.info("Sync not enabled (local-only mode)");
      ui.dim(`Run ${("memories login")} to enable cloud sync.`);
      return;
    }
    ui.success("Cloud sync enabled");
    ui.dim(`Remote: ${config.syncUrl}`);
    ui.dim(`Org: ${config.org}`);
    ui.dim(`Database: ${config.dbName}`);
  });
