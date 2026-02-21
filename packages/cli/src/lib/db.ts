import { createClient, type Client } from "@libsql/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./env.js";

interface FtsTriggerDefinition {
  name: string;
  createSql: string;
  validationNeedles: string[];
}

const FTS_TRIGGER_DEFINITIONS: FtsTriggerDefinition[] = [
  {
    name: "memories_ai",
    createSql: `
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories
      WHEN NEW.deleted_at IS NULL
      BEGIN
        INSERT INTO memories_fts(rowid, content, tags) VALUES (NEW.rowid, NEW.content, NEW.tags);
      END
    `,
    validationNeedles: ["when new.deleted_at is null"],
  },
  {
    name: "memories_ad",
    createSql: `
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories
      WHEN OLD.deleted_at IS NULL
      BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES('delete', OLD.rowid, OLD.content, OLD.tags);
      END
    `,
    validationNeedles: ["when old.deleted_at is null"],
  },
  {
    name: "memories_au",
    createSql: `
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags)
          SELECT 'delete', OLD.rowid, OLD.content, OLD.tags
          WHERE OLD.deleted_at IS NULL;
        INSERT INTO memories_fts(rowid, content, tags)
          SELECT NEW.rowid, NEW.content, NEW.tags WHERE NEW.deleted_at IS NULL;
      END
    `,
    validationNeedles: ["where old.deleted_at is null", "where new.deleted_at is null"],
  },
];

function resolveConfigDir(): string {
  return getDataDir();
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

interface SyncConfig {
  syncUrl: string;
  syncToken: string;
  org: string;
  dbName: string;
}

// Cloud mode - when set, uses cloud DB directly instead of local
let cloudCredentials: { url: string; token: string } | null = null;

export function setCloudMode(url: string, token: string): void {
  cloudCredentials = { url, token };
  // Reset client so next getDb() uses cloud
  if (client) {
    client.close();
    client = undefined;
  }
}

let client: Client | undefined;

export async function getDb(): Promise<Client> {
  if (client) return client;

  // Cloud mode - connect directly to remote Turso DB
  if (cloudCredentials) {
    client = createClient({
      url: cloudCredentials.url,
      authToken: cloudCredentials.token,
    });
    // Don't run migrations on cloud DB - it's managed by the web app
    return client;
  }

  // Local mode - use local SQLite file
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

async function runMigrations(db: Client): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      type TEXT NOT NULL DEFAULT 'note',
      paths TEXT,
      category TEXT,
      metadata TEXT,
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
  // Types: 'rule' (always active), 'decision' (why we chose something), 'fact' (knowledge), 'note' (general), 'skill' (agent skill)
  try {
    await db.execute(`ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'note'`);
  } catch {
    // Column already exists
  }

  // Add paths column if missing (comma-separated glob patterns for path-scoped rules)
  try {
    await db.execute(`ALTER TABLE memories ADD COLUMN paths TEXT`);
  } catch {
    // Column already exists
  }

  // Add category column if missing (free-form grouping key)
  try {
    await db.execute(`ALTER TABLE memories ADD COLUMN category TEXT`);
  } catch {
    // Column already exists
  }

  // Add metadata column if missing (JSON blob for extended attributes)
  try {
    await db.execute(`ALTER TABLE memories ADD COLUMN metadata TEXT`);
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

  await ensureFtsSchema(db);

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

  await db.execute(
    `CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      next_trigger_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reminders_scope_project ON reminders(scope, project_id)`);
  } catch {
    // Index might already exist
  }

  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_reminders_enabled_next ON reminders(enabled, next_trigger_at)`);
  } catch {
    // Index might already exist
  }

  await ensureGraphSchema(db);

  // Files table for syncing config files (.agents/, .cursor/, .claude/, etc.)
  await db.execute(
    `CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      hash TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      UNIQUE(path, scope)
    )`
  );

  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_files_scope ON files(scope)`);
  } catch {
    // Index might already exist
  }

  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)`);
  } catch {
    // Index might already exist
  }
}

async function createFtsTable(db: Client): Promise<void> {
  // FTS5 virtual table for full-text search.
  // We use content_rowid to link to the memories table.
  await db.execute(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='rowid'
    )`
  );
}

async function ensureFtsTriggers(db: Client): Promise<void> {
  const triggerNames = FTS_TRIGGER_DEFINITIONS.map((trigger) => `'${trigger.name}'`).join(", ");
  const existing = await db.execute(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (${triggerNames})
  `);
  const existingByName = new Map<string, string>();
  for (const row of existing.rows) {
    existingByName.set(String(row.name), String(row.sql ?? ""));
  }

  // Keep trigger creation idempotent while repairing outdated definitions in place.
  for (const trigger of FTS_TRIGGER_DEFINITIONS) {
    const sql = existingByName.get(trigger.name);
    if (!sql) {
      await db.execute(trigger.createSql);
      continue;
    }

    const normalizedSql = sql.toLowerCase().replace(/\s+/g, " ");
    const needsRefresh = trigger.validationNeedles.some(
      (needle) => !normalizedSql.includes(needle.toLowerCase()),
    );
    if (!needsRefresh) continue;

    await db.execute(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    await db.execute(trigger.createSql);
  }
}

async function dropFtsTriggers(db: Client): Promise<void> {
  for (const trigger of FTS_TRIGGER_DEFINITIONS) {
    await db.execute(`DROP TRIGGER IF EXISTS ${trigger.name}`);
  }
}

/**
 * Ensure FTS schema exists without destructive changes.
 * Safe to call during normal startup migrations.
 */
export async function ensureFtsSchema(db: Client): Promise<void> {
  await createFtsTable(db);
  await ensureFtsTriggers(db);
}

/**
 * Hard-reset FTS table and triggers, then rebuild index from active rows.
 * Use this only for repair flows (e.g. `memories doctor --fix`).
 */
export async function repairFtsSchema(db: Client): Promise<void> {
  await dropFtsTriggers(db);
  await db.execute("DROP TABLE IF EXISTS memories_fts");
  await createFtsTable(db);
  await ensureFtsTriggers(db);
  await db.execute("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
}

async function ensureGraphSchema(db: Client): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      node_key TEXT NOT NULL,
      label TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_nodes_type_key
     ON graph_nodes(node_type, node_key)`
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type)`);

  await db.execute(
    `CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 1.0,
      evidence_memory_id TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_from_node_id ON graph_edges(from_node_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_to_node_id ON graph_edges(to_node_id)`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_graph_edges_type_from_node_id ON graph_edges(edge_type, from_node_id)`
  );
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_expires_at ON graph_edges(expires_at)`);

  await db.execute(
    `CREATE TABLE IF NOT EXISTS memory_node_links (
      memory_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (memory_id, node_id, role)
    )`
  );

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memory_node_links_node_id ON memory_node_links(node_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_memory_node_links_memory_id ON memory_node_links(memory_id)`);
}
