import { Command } from "commander";
import chalk from "chalk";
import { getRules, type Memory } from "../lib/memory.js";
import { getProjectId } from "../lib/git.js";

// Simple Levenshtein distance
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] 
        ? dp[i-1][j-1] 
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

// Keyword pairs that often indicate conflicts
const CONFLICT_PAIRS = [
  ["always", "never"],
  ["use", "avoid"],
  ["prefer", "avoid"],
  ["enable", "disable"],
  ["tabs", "spaces"],
  ["single", "double"],
  ["require", "forbid"],
  ["must", "must not"],
  ["should", "should not"],
];

function extractKeywords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
}

function findTopicOverlap(a: string, b: string): string[] {
  const wordsA = new Set(extractKeywords(a));
  const wordsB = new Set(extractKeywords(b));
  const overlap: string[] = [];
  for (const w of wordsA) {
    if (wordsB.has(w) && w.length > 3) overlap.push(w);
  }
  return overlap;
}

function checkForConflict(a: string, b: string): boolean {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  
  for (const [pos, neg] of CONFLICT_PAIRS) {
    const aHasPos = lowerA.includes(pos);
    const aHasNeg = lowerA.includes(neg);
    const bHasPos = lowerB.includes(pos);
    const bHasNeg = lowerB.includes(neg);
    
    // One has positive, other has negative
    if ((aHasPos && bHasNeg) || (aHasNeg && bHasPos)) {
      // Check if they share topic words
      const overlap = findTopicOverlap(a, b);
      if (overlap.length > 0) return true;
    }
  }
  return false;
}

interface Issue {
  type: "duplicate" | "near-duplicate" | "conflict";
  memory1: Memory;
  memory2: Memory;
  detail?: string;
}

export const validateCommand = new Command("validate")
  .description("Check for conflicting or duplicate rules")
  .option("--fix", "Interactive mode to resolve issues")
  .action(async (opts: { fix?: boolean }) => {
    try {
      const projectId = getProjectId() ?? undefined;
      const rules = await getRules({ projectId });

      if (rules.length === 0) {
        console.log(chalk.dim("No rules to validate."));
        return;
      }

      console.log(chalk.bold("🔍 Validating rules...\n"));

      const issues: Issue[] = [];

      // Compare each pair of rules
      for (let i = 0; i < rules.length; i++) {
        for (let j = i + 1; j < rules.length; j++) {
          const a = rules[i];
          const b = rules[j];
          
          // Exact duplicate
          if (a.content.toLowerCase() === b.content.toLowerCase()) {
            issues.push({ type: "duplicate", memory1: a, memory2: b });
            continue;
          }
          
          // Near duplicate (>85% similar)
          const sim = similarity(a.content, b.content);
          if (sim > 0.85) {
            issues.push({ 
              type: "near-duplicate", 
              memory1: a, 
              memory2: b,
              detail: `${Math.round(sim * 100)}% similar`
            });
            continue;
          }
          
          // Potential conflict
          if (checkForConflict(a.content, b.content)) {
            const overlap = findTopicOverlap(a.content, b.content);
            issues.push({ 
              type: "conflict", 
              memory1: a, 
              memory2: b,
              detail: `Topic: ${overlap.join(", ")}`
            });
          }
        }
      }

      if (issues.length === 0) {
        console.log(chalk.green("✓") + ` ${rules.length} rules validated, no issues found.`);
        return;
      }

      // Display issues
      console.log(chalk.yellow("⚠️  Potential Issues Found:\n"));

      let num = 1;
      for (const issue of issues) {
        const typeLabel = issue.type === "duplicate" ? "Exact duplicate" :
                         issue.type === "near-duplicate" ? "Near duplicate" :
                         "Potential conflict";
        const color = issue.type === "conflict" ? chalk.red : chalk.yellow;
        
        console.log(color(`${num}. ${typeLabel}${issue.detail ? ` (${issue.detail})` : ""}:`));
        console.log(`   📌 "${issue.memory1.content}"`);
        console.log(`   📌 "${issue.memory2.content}"`);
        
        if (issue.type === "duplicate" || issue.type === "near-duplicate") {
          console.log(chalk.dim("   → Consider merging these rules\n"));
        } else {
          console.log(chalk.dim("   → These rules may contradict each other\n"));
        }
        num++;
      }

      const duplicates = issues.filter(i => i.type === "duplicate" || i.type === "near-duplicate").length;
      const conflicts = issues.filter(i => i.type === "conflict").length;
      
      console.log(chalk.bold(`${rules.length} rules validated, ${issues.length} issues found`));
      if (duplicates > 0) console.log(chalk.dim(`  ${duplicates} duplicate(s)`));
      if (conflicts > 0) console.log(chalk.dim(`  ${conflicts} conflict(s)`));

      if (opts.fix) {
        console.log(chalk.dim("\n--fix mode not yet implemented. Review issues above manually."));
      }
    } catch (error) {
      console.error(chalk.red("✗") + " Validation failed:", error instanceof Error ? error.message : "Unknown error");
      process.exit(1);
    }
  });
