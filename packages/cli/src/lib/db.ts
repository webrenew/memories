import { createClient, type Client } from "@libsql/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = process.env.MEMORIES_DATA_DIR ?? join(homedir(), ".config", "memories");
const DB_PATH = join(CONFIG_DIR, "local.db");
const SYNC_CONFIG_PATH = join(CONFIG_DIR, "sync.json");

export interface SyncConfig {
  syncUrl: string;
  syncToken: string;
  org: string;
  dbName: string;
}

let client: Client | undefined;

export async function getDb(): Promise<Client> {
  if (client) return client;

  await mkdir(CONFIG_DIR, { recursive: true });

  const sync = await readSyncConfig();

  if (sync) {
    client = createClient({
      url: `file:${DB_PATH}`,
      syncUrl: sync.syncUrl,
      authToken: sync.syncToken,
    });
    await runMigrations(client);
    await client.sync();
  } else {
    client = createClient({ url: `file:${DB_PATH}` });
    await runMigrations(client);
  }

  return client;
}

/** Reset the cached client so next getDb() re-reads sync config */
export function resetDb(): void {
  client?.close();
  client = undefined;
}

export async function syncDb(): Promise<void> {
  const db = await getDb();
  await db.sync();
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(SYNC_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function readSyncConfig(): Promise<SyncConfig | null> {
  if (!existsSync(SYNC_CONFIG_PATH)) return null;
  const raw = await readFile(SYNC_CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as SyncConfig;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)`,
    args: [key, value],
  });
}

export async function getConfig(key: string): Promise<string | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT value FROM configs WHERE key = ?`,
    args: [key],
  });
  if (result.rows.length === 0) return null;
  return result.rows[0].value as string;
}

async function runMigrations(db: Client): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`
  );

  // Add scope column if missing (migration for existing DBs)
  try {
    await db.execute(`ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'`);
  } catch {
    // Column already exists
  }

  // Add project_id column if missing (migration for existing DBs)
  try {
    await db.execute(`ALTER TABLE memories ADD COLUMN project_id TEXT`);
  } catch {
    // Column already exists
  }

  await db.execute(
    `CREATE TABLE IF NOT EXISTS configs (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await db.execute(
    `CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY,
      last_synced_at TEXT,
      remote_url TEXT
    )`
  );
}
