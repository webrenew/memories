import { createClient, type Client } from "@libsql/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function resolveConfigDir(): string {
  return process.env.MEMORIES_DATA_DIR ?? join(homedir(), ".config", "memories");
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

function getDbPath(): string {
  return join(resolveConfigDir(), "local.db");
}

function getSyncConfigPath(): string {
  return join(resolveConfigDir(), "sync.json");
}

export interface SyncConfig {
  syncUrl: string;
  syncToken: string;
  org: string;
  dbName: string;
}

let client: Client | undefined;

export async function getDb(): Promise<Client> {
  if (client) return client;

  const configDir = resolveConfigDir();
  const dbPath = getDbPath();

  await mkdir(configDir, { recursive: true });

  const sync = await readSyncConfig();

  if (sync) {
    client = createClient({
      url: `file:${dbPath}`,
      syncUrl: sync.syncUrl,
      authToken: sync.syncToken,
    });
    await runMigrations(client);
    await client.sync();
  } else {
    client = createClient({ url: `file:${dbPath}` });
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
  const configDir = resolveConfigDir();
  await mkdir(configDir, { recursive: true });
  await writeFile(getSyncConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

export async function readSyncConfig(): Promise<SyncConfig | null> {
  const syncPath = getSyncConfigPath();
  if (!existsSync(syncPath)) return null;
  const raw = await readFile(syncPath, "utf-8");
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
      type TEXT NOT NULL DEFAULT 'note',
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

  // Add type column if missing (migration for existing DBs)
  // Types: 'rule' (always active), 'decision' (why we chose something), 'fact' (knowledge), 'note' (general)
  try {
    await db.execute(`ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'note'`);
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

  // FTS5 virtual table for full-text search
  // We use content_rowid to link to the memories table
  await db.execute(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='rowid'
    )`
  );

  // Triggers to keep FTS in sync with memories table
  // Drop and recreate to ensure latest logic (fixes soft-delete FTS leak)
  await db.execute(`DROP TRIGGER IF EXISTS memories_ai`);
  await db.execute(`DROP TRIGGER IF EXISTS memories_ad`);
  await db.execute(`DROP TRIGGER IF EXISTS memories_au`);

  // Only index non-deleted memories
  await db.execute(`
    CREATE TRIGGER memories_ai AFTER INSERT ON memories
    WHEN NEW.deleted_at IS NULL
    BEGIN
      INSERT INTO memories_fts(rowid, content, tags) VALUES (NEW.rowid, NEW.content, NEW.tags);
    END
  `);

  await db.execute(`
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', OLD.rowid, OLD.content, OLD.tags);
    END
  `);

  // On update: always remove old entry, only re-insert if not soft-deleted
  await db.execute(`
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', OLD.rowid, OLD.content, OLD.tags);
      INSERT INTO memories_fts(rowid, content, tags)
        SELECT NEW.rowid, NEW.content, NEW.tags WHERE NEW.deleted_at IS NULL;
    END
  `);

  // Note: We do NOT run FTS 'rebuild' here because content-sync FTS5 rebuild
  // re-indexes ALL rows from the source table (including soft-deleted ones).
  // The triggers above ensure only active records enter the FTS index.
  // Use 'memories doctor --fix' to rebuild if the index gets corrupted.

  // Index for faster type-based queries (rules are queried frequently)
  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`);
  } catch {
    // Index might already exist
  }

  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_scope_project ON memories(scope, project_id)`);
  } catch {
    // Index might already exist
  }
}
