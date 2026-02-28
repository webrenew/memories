# Memory Segmentation Marketing Plan

Date: 2026-02-28  
Owner: Marketing + Product + Docs

## Goal

Update memories.sh positioning so it clearly reflects the memory lifecycle now implemented:

- Session memory (active working context)
- Long-term semantic memory (stable facts/rules/preferences)
- Long-term episodic memory (daily logs + raw snapshots)
- Procedural memory (reusable workflow memory via skills/ranking signals)
- Compaction safety (write-ahead checkpoints before context loss)

## What Is Already Implemented (source of truth for claims)

1. Session lifecycle commands: `memories session start|checkpoint|status|end|snapshot`
2. Inactivity compaction worker: `memories compact run`
3. OpenClaw file-mode lifecycle:
   - `memory.md` (semantic)
   - `memory/daily/YYYY-MM-DD.md` (episodic append-only)
   - `memory/snapshots/YYYY-MM-DD/<slug>.md` (raw snapshots)
4. Lifecycle + compaction APIs and context hints in SDK/docs.
5. Procedural memory signals and retrieval support (workflow-oriented ranking).

## Messaging Problem to Fix

Current copy still mostly describes:

- Memory **types** (`rule`, `decision`, `fact`, `note`, `skill`)
- Semantic recall and local-first storage

But it does not clearly explain:

- The **segmented architecture** (session + long-term + procedural)
- How memories survive reset/compaction boundaries
- Why this is better than naive transcript replay

## Positioning Update (core narrative)

Use this narrative consistently:

> memories.sh is a segmented memory system for agents: short-term session memory plus long-term semantic, episodic, and procedural memory, with compaction-safe checkpoints and deterministic file mode for OpenClaw.

## Message Pillars (with proof)

### Pillar 1: Session Memory That Survives Long Tasks

- Message: Keep active work coherent across long chats and compaction events.
- Proof points:
  - `memories session` lifecycle commands
  - `memories compact run`
  - Snapshot triggers (`new_session`, `reset`, `manual`, `auto_compaction`)

### Pillar 2: Long-Term Memory Is Segmented, Not Blended

- Message: Different memory jobs need different stores.
- Proof points:
  - Semantic memory (`memory.md`) for durable truths
  - Episodic daily logs + snapshots for chronology and fidelity
  - Consolidation/overwrite model in lifecycle RFC

### Pillar 3: Procedural Memory Improves Repeated Work

- Message: Successful workflows become retrievable operating patterns.
- Proof points:
  - Skill/procedural usage signals and retrieval hooks
  - Workflow-oriented ranking behavior

### Pillar 4: Deterministic File Mode for OpenClaw

- Message: Human-readable, git-friendly memory continuity without vector infra complexity.
- Proof points:
  - `memories openclaw memory bootstrap|flush|snapshot|sync`
  - fixed file contract (`memory.md`, daily logs, snapshots)

## Copy Architecture Changes (by surface)

### 1) Homepage (highest priority)

Update:

- Hero subheadline to mention segmented memory lifecycle.
- Feature cards:
  - Replace generic “Durable Local State” with “Segmented Memory Architecture”.
  - Add “Compaction-Safe Checkpoints”.
  - Add “Session + Long-Term + Procedural Retrieval”.
- How It Works section:
  - Add a segmentation explainer block with a 3-lane mental model.

### 2) README + docs index (high priority)

Update:

- Add “Memory Segmentation” section near “Memory Types”.
- Clarify two axes:
  1. Purpose/type (`rule`, `decision`, `fact`, `note`, `skill`)
  2. Lifecycle/store (session, semantic, episodic, procedural)
- Add direct links to `session`, `compact`, and `openclaw memory` docs.

### 3) Concepts docs (high priority)

Add new concept page:

- `docs/concepts/memory-segmentation` (name can vary, keep short)
- Include:
  - architecture diagram
  - trigger table (count/time/event)
  - “what gets written where” matrix
  - anti-patterns (don’t dump full transcript into semantic memory)

### 4) SDK + MCP docs (medium priority)

Update:

- Add one “lifecycle-aware integration” block:
  - pass `sessionId`, budget/turn hints to context calls
  - mention compaction checkpoint behavior
- Add quick examples for session snapshot/compaction-related calls.

### 5) OpenClaw integration page (medium priority)

Update:

- Reframe page around “deterministic segmented memory files”.
- Show lifecycle sequence:
  1. bootstrap
  2. flush before compaction/reset
  3. snapshot on boundary
  4. sync

## Launchable Copy Assets

1. New homepage section: “How segmented memory works”
2. One docs concept page with diagram + command examples
3. README segment update
4. One changelog/announcement entry:
   - “Session + semantic/episodic/procedural lifecycle now first-class”

## Claim Guardrails (avoid overstatement)

Allowed:

- “Compaction-safe checkpoints”
- “Segmented memory lifecycle”
- “Deterministic file mode for OpenClaw”

Avoid unless separately validated:

- Quantified success/performance uplift percentages
- “No context loss ever” absolute claims
- “Fully autonomous memory management” language

## PR Sequence

### PR-1: Messaging foundation docs

- Add segmentation concept page
- Update concepts nav/meta
- Update docs index links

### PR-2: README and docs cross-links

- Add segmentation section to README
- Add command cross-links (`session`, `compact`, `openclaw memory`)
- Align terminology with concept page

### PR-3: Homepage conversion copy update

- Hero + feature cards + how-it-works copy refresh
- Keep current visual system; copy-only changes first

### PR-4: Integration pages refresh

- SDK page lifecycle block
- MCP page lifecycle hints block
- OpenClaw page lifecycle sequence block

### PR-5: Release narrative

- Changelog entry + launch snippet for social/email/docs front page
- Internal sales/demo blurb using same segmentation language

## Acceptance Criteria

1. A new visitor can explain session vs semantic vs episodic vs procedural after first scroll.
2. README and docs no longer imply only one-dimensional “memory types.”
3. All top surfaces use the same segmentation vocabulary.
4. Every segmentation claim has a command/API/doc proof point.

## Suggested Success Metrics (30 days)

1. Higher CTR from homepage to lifecycle docs (`/docs/cli/session`, `/docs/cli/openclaw-memory`, new segmentation page).
2. Higher completion of lifecycle commands among activated users.
3. Reduced support questions around “how memory survives reset/compaction.”
4. Increased conversion on OpenClaw integration page.

## Draft Tagline Options

1. “Segmented memory for agents: session, semantic, episodic, procedural.”
2. “Stop replaying transcripts. Start using lifecycle memory.”
3. “Compaction-safe memory continuity for real agent workflows.”
