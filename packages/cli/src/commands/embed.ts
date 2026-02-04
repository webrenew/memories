import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getDb } from "../lib/db.js";
import { getEmbedding, storeEmbedding, ensureEmbeddingsSchema } from "../lib/embeddings.js";

export const embedCommand = new Command("embed")
  .description("Generate embeddings for memories (enables semantic search)")
  .option("--all", "Re-embed all memories, even those with existing embeddings")
  .option("--dry-run", "Show what would be embedded without doing it")
  .action(async (opts: { all?: boolean; dryRun?: boolean }) => {
    try {
      await ensureEmbeddingsSchema();
      const db = await getDb();
      
      // Find memories needing embeddings
      let sql = "SELECT id, content FROM memories WHERE deleted_at IS NULL";
      if (!opts.all) {
        sql += " AND embedding IS NULL";
      }
      
      const result = await db.execute(sql);
      const memories = result.rows as unknown as { id: string; content: string }[];
      
      if (memories.length === 0) {
        console.log(chalk.green("✓") + " All memories already have embeddings.");
        return;
      }
      
      if (opts.dryRun) {
        console.log(chalk.bold(`Would embed ${memories.length} memories:\n`));
        for (const m of memories.slice(0, 10)) {
          const preview = m.content.length > 60 ? m.content.slice(0, 57) + "..." : m.content;
          console.log(`  ${chalk.dim(m.id)}  ${preview}`);
        }
        if (memories.length > 10) {
          console.log(chalk.dim(`  ... and ${memories.length - 10} more`));
        }
        return;
      }
      
      console.log(chalk.bold(`Embedding ${memories.length} memories...\n`));
      console.log(chalk.dim("First run downloads the model (~30MB). Subsequent runs are faster.\n"));
      
      const spinner = ora("Loading embedding model...").start();
      
      let embedded = 0;
      let failed = 0;
      
      for (const m of memories) {
        try {
          spinner.text = `Embedding ${embedded + 1}/${memories.length}: ${m.content.slice(0, 40)}...`;
          
          const embedding = await getEmbedding(m.content);
          await storeEmbedding(m.id, embedding);
          
          embedded++;
        } catch (error) {
          failed++;
          // Continue with next memory
        }
      }
      
      spinner.stop();
      
      console.log(chalk.green("✓") + ` Embedded ${embedded} memories`);
      if (failed > 0) {
        console.log(chalk.yellow("⚠") + ` ${failed} memories failed to embed`);
      }
      
      console.log("");
      console.log(chalk.dim("Now you can use semantic search:"));
      console.log(chalk.cyan("  memories search --semantic \"your query\""));
    } catch (error) {
      console.error(chalk.red("✗") + " Embedding failed:", error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });
