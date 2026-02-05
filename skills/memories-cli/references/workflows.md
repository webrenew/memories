# Workflow Recipes

Multi-step recipes for common memories.sh tasks.

## Table of Contents

- [Project Onboarding](#project-onboarding)
- [Rule Management](#rule-management)
- [Cross-Machine Sync](#cross-machine-sync)
- [Migration from Existing Tools](#migration-from-existing-tools)
- [Team Knowledge Base](#team-knowledge-base)
- [Maintenance & Cleanup](#maintenance--cleanup)
- [Git Hook Automation](#git-hook-automation)
- [Semantic Search Setup](#semantic-search-setup)

---

## Project Onboarding

Set up memories.sh in a new project and establish baseline rules.

```bash
# 1. Initialize (auto-detects tools, configures MCP)
cd my-project
memories init

# 2. Add foundational rules
memories add "Use TypeScript strict mode" --type rule
memories add "Use pnpm as package manager" --type rule
memories add "Follow conventional commits" --type rule

# 3. Record key decisions
memories add "Chose Next.js App Router for server components" --type decision
memories add "Using Supabase for auth and database" --type decision

# 4. Add project facts
memories add "Production API: api.example.com" --type fact
memories add "Rate limit: 100 req/min per user" --type fact

# 5. Generate configs for all detected tools
memories generate

# 6. Verify
memories doctor
memories stats
```

---

## Rule Management

Add, update, and organize rules as standards evolve.

```bash
# Add rules with tags for organization
memories add "Always validate API inputs with Zod" --type rule --tags api,validation
memories add "Use server components by default" --type rule --tags react,nextjs

# Find and update a rule
memories search "validation"
memories edit <id> --content "Validate all inputs with Zod v4 schemas"

# Promote a note to a rule
memories edit <id> --type rule

# Remove an outdated rule
memories forget <id>

# Regenerate configs after changes
memories generate
```

---

## Cross-Machine Sync

Sync memories and config files across machines.

```bash
# Machine A: Upload everything
memories login
memories sync                       # Sync memory database
memories files ingest --global      # Upload global configs (~/.claude, ~/.cursor, etc.)
memories files ingest --project     # Upload project configs

# Machine B: Restore everything
memories login
memories sync                       # Pull memory database
memories files apply --global -f    # Restore global configs
cd my-project
memories files apply --project -f   # Restore project configs
memories generate                   # Regenerate AI tool files
```

### Verify what's synced

```bash
memories files list                 # See all synced files
memories files show <path>          # Preview a file's content
```

---

## Migration from Existing Tools

Import existing rules from any AI tool into memories.sh.

```bash
# Auto-detect and import from all found files
memories ingest

# Or target specific tools
memories ingest claude    # From CLAUDE.md
memories ingest cursor    # From .cursorrules or .cursor/rules/
memories ingest copilot   # From .github/copilot-instructions.md

# Preview before importing
memories ingest --dry-run

# After import, verify and tag
memories list --type rule
memories tag <id> add imported

# Generate unified configs
memories generate
```

---

## Team Knowledge Base

Build a shared knowledge base via export/import.

```bash
# Export team rules
memories export --type rule -o team-rules.yaml
memories export --type decision -o team-decisions.yaml

# Share via git (commit the YAML files)
git add team-rules.yaml team-decisions.yaml
git commit -m "chore: update team knowledge base"

# Teammate imports
memories import team-rules.yaml --merge
memories import team-decisions.yaml --merge
memories generate
```

---

## Maintenance & Cleanup

Regular maintenance to keep memories relevant.

```bash
# Find stale memories (not updated in 90+ days)
memories stale --days 90

# Interactive review — keep, delete, or skip each
memories review

# Check for issues
memories doctor
memories validate

# View stats
memories stats
```

---

## Git Hook Automation

Auto-regenerate config files on every commit.

```bash
# Install the post-commit hook
memories hook install

# Check status
memories hook status

# Remove if needed
memories hook uninstall
```

The hook runs `memories generate` after each commit, keeping AI tool configs in sync with your latest memories.

---

## Semantic Search Setup

Enable vector similarity search for better recall.

```bash
# Generate embeddings (downloads model on first run)
memories embed

# Preview what needs embedding
memories embed --dry-run

# Use semantic search
memories search "how we handle auth" --semantic

# Re-embed after major changes
memories embed --all

# Change the embedding model
memories config model <model-name>
```
