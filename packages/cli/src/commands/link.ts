import { Command } from "commander";
import chalk from "chalk";
import { nanoid } from "nanoid";
import { getDb } from "../lib/db.js";
import { getMemoryById, type Memory } from "../lib/memory.js";
import * as ui from "../lib/ui.js";

const LINK_TYPES = ["related", "supports", "supersedes", "contradicts"] as const;
type LinkType = typeof LINK_TYPES[number];

const TYPE_ICONS: Record<string, string> = {
  rule: "📌",
  decision: "💡",
  fact: "📋",
  note: "📝",
};

async function ensureLinksTable(): Promise<void> {
  const db = await getDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id)`);
}

export async function getLinkedMemories(memoryId: string): Promise<{ memory: Memory; linkType: string; direction: "from" | "to" }[]> {
  const db = await getDb();
  await ensureLinksTable();
  
  // Get outgoing and incoming links in parallel
  const [outgoing, incoming] = await Promise.all([
    db.execute({
      sql: `
        SELECT m.*, ml.link_type
        FROM memory_links ml
        JOIN memories m ON ml.target_id = m.id
        WHERE ml.source_id = ? AND m.deleted_at IS NULL
      `,
      args: [memoryId],
    }),
    db.execute({
      sql: `
        SELECT m.*, ml.link_type
        FROM memory_links ml
        JOIN memories m ON ml.source_id = m.id
        WHERE ml.target_id = ? AND m.deleted_at IS NULL
      `,
      args: [memoryId],
    }),
  ]);

  const results: { memory: Memory; linkType: string; direction: "from" | "to" }[] = [];

  for (const row of outgoing.rows) {
    results.push({
      memory: row as unknown as Memory,
      linkType: (row as Record<string, unknown>).link_type as string,
      direction: "to",
    });
  }

  for (const row of incoming.rows) {
    results.push({
      memory: row as unknown as Memory,
      linkType: (row as Record<string, unknown>).link_type as string,
      direction: "from",
    });
  }

  return results;
}

export const linkCommand = new Command("link")
  .description("Link two related memories together")
  .argument("<id1>", "First memory ID")
  .argument("<id2>", "Second memory ID")
  .option("-t, --type <type>", "Link type: related, supports, supersedes, contradicts", "related")
  .action(async (id1: string, id2: string, opts: { type: string }) => {
    try {
      await ensureLinksTable();
      const db = await getDb();

      if (!LINK_TYPES.includes(opts.type as LinkType)) {
        ui.error(`Invalid link type. Valid: ${LINK_TYPES.join(", ")}`);
        process.exit(1);
      }

      // Verify both memories exist
      const [m1, m2] = await Promise.all([getMemoryById(id1), getMemoryById(id2)]);

      if (!m1) {
        ui.error(`Memory ${id1} not found`);
        process.exit(1);
      }
      if (!m2) {
        ui.error(`Memory ${id2} not found`);
        process.exit(1);
      }

      // Check if link already exists
      const existing = await db.execute({
        sql: `SELECT id FROM memory_links WHERE 
              (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`,
        args: [id1, id2, id2, id1],
      });

      if (existing.rows.length > 0) {
        ui.info("These memories are already linked");
        return;
      }

      // Create link
      const linkId = nanoid(12);
      await db.execute({
        sql: `INSERT INTO memory_links (id, source_id, target_id, link_type) VALUES (?, ?, ?, ?)`,
        args: [linkId, id1, id2, opts.type],
      });

      const icon1 = TYPE_ICONS[m1.type] || "📝";
      const icon2 = TYPE_ICONS[m2.type] || "📝";

      ui.success("Linked memories:");
      console.log(`  ${icon1} ${chalk.dim(id1)} "${m1.content.slice(0, 40)}..."`);
      console.log(`    ↓ ${chalk.cyan(opts.type)}`);
      console.log(`  ${icon2} ${chalk.dim(id2)} "${m2.content.slice(0, 40)}..."`);
    } catch (error) {
      ui.error("Failed: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

export const unlinkCommand = new Command("unlink")
  .description("Remove link between two memories")
  .argument("<id1>", "First memory ID")
  .argument("<id2>", "Second memory ID")
  .action(async (id1: string, id2: string) => {
    try {
      await ensureLinksTable();
      const db = await getDb();

      const result = await db.execute({
        sql: `DELETE FROM memory_links WHERE 
              (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`,
        args: [id1, id2, id2, id1],
      });

      if (result.rowsAffected === 0) {
        ui.info("No link found between these memories");
      } else {
        ui.success(`Unlinked ${id1} and ${id2}`);
      }
    } catch (error) {
      ui.error("Failed: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

export const showCommand = new Command("show")
  .description("Show a memory with its linked memories")
  .argument("<id>", "Memory ID")
  .option("--links", "Include linked memories")
  .action(async (id: string, opts: { links?: boolean }) => {
    try {
      const memory = await getMemoryById(id);
      if (!memory) {
        ui.error(`Memory ${id} not found`);
        process.exit(1);
      }

      const icon = TYPE_ICONS[memory.type] || "📝";
      const scope = memory.scope === "global" ? "Global" : "Project";

      console.log("");
      console.log(`${icon} ${chalk.bold(memory.type.toUpperCase())} (${scope})`);
      console.log(chalk.dim(`ID: ${memory.id}`));
      console.log(chalk.dim(`Created: ${memory.created_at}`));
      if (memory.tags) console.log(chalk.dim(`Tags: ${memory.tags}`));
      console.log("");
      console.log(memory.content);

      if (opts.links) {
        await ensureLinksTable();
        const linked = await getLinkedMemories(id);
        
        if (linked.length > 0) {
          console.log("");
          console.log(chalk.bold("Linked Memories:"));
          for (const { memory: m, linkType, direction } of linked) {
            const mIcon = TYPE_ICONS[m.type] || "📝";
            const arrow = direction === "to" ? "→" : "←";
            const preview = m.content.length > 50 ? m.content.slice(0, 47) + "..." : m.content;
            console.log(`  ${arrow} ${chalk.cyan(linkType)}: ${mIcon} ${preview}`);
          }
        }
      }
      console.log("");
    } catch (error) {
      ui.error("Failed: " + (error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
