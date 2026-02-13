# Developer Wiring + Product Utility Roadmap

Last updated: 2026-02-12  
Owner: Platform / DX / Product  
Status: Draft (execution-ready)

## 1. Objective

Make memories.sh dramatically easier for developers to wire up while making the product obviously valuable in day-to-day workflows.

## 2. Success Metrics

- Time-to-first-working-integration: `< 10 minutes`
- Setup success rate (`setup + doctor`): `> 95%`
- Workspace switch latency (personal <-> org): `p95 < 1s`
- Weekly active memory-assisted sessions per workspace: `+30%`
- Support tickets tagged `setup/debugging`: `-50%`

## 3. Priority Plan

## 3.1 P0 (Start Now): One-command setup + doctor

Why:
- Most integration failures are config/auth/db drift and are preventable with strong diagnostics.

Deliverables:
- `memories setup` guided flow (auth, workspace, provider config)
- `memories doctor` with explicit pass/fail checks and copy-paste fixes
- Machine-readable doctor output (`--json`) for CI and support tooling

Acceptance criteria:
- Fresh machine can be onboarded end-to-end in one command path
- Doctor identifies and explains the top known breakpoints (auth, MCP config, DB creds, workspace mismatch)

## 3.2 P0 (Start Now): Integration health endpoint + dashboard panel

Why:
- Developers need one source of truth to understand broken integrations fast.

Deliverables:
- Unified health payload: auth, workspace, graph, rollout mode, fallback rate, latency
- Dashboard health panel with status + remediation hints
- Correlated request IDs for support/debugging

Acceptance criteria:
- Any “it doesn’t work” report can be triaged from one screen/API call
- Health status can be consumed by CLI and web without custom parsing

## 3.3 P1 (Revisit Next): Golden-path starter apps

Why:
- Copy-pastable examples collapse onboarding time and remove guesswork.

Deliverables:
- 3 official starters:
  - Next.js app router
  - Express/Node API
  - Python agent/service
- Each starter includes add/search/context, scoped retrieval, and basic error handling
- “10-minute quickstart” docs linked from homepage/docs

Acceptance criteria:
- New dev can run a starter and retrieve first useful context in `< 10 min`
- Starters covered by smoke CI (install, run, basic API checks)

## 3.4 P1 (Revisit Next): Automatic capture from real work

Why:
- Manual memory entry does not scale; automatic capture creates durable value.

Deliverables:
- Ingestion adapters for PRs, issues, commit messages, and release notes
- Configurable filters (repo, branch, labels, authors)
- Provenance metadata on each memory (source URL, actor, timestamp)

Acceptance criteria:
- New project activity appears in memory graph without manual entry
- Users can trace each memory back to source evidence

## 3.5 P2 (Revisit After P1): Actionable intelligence layer

Why:
- Storage alone is commodity; insight and recommendations are product differentiation.

Deliverables:
- “Stale rule” detector (unused or contradictory)
- Conflict detector (competing decisions/rules)
- Weekly “what changed” summary and top-node movement
- Suggested cleanup actions (`merge`, `archive`, `relabel`)

Acceptance criteria:
- Dashboard surfaces at least 3 actionable insights per active workspace
- Users can resolve an insight in <= 2 clicks

## 3.6 P2 (Revisit After P1): Performance budgets + fast workspace switching

Why:
- Slow personal/org switching breaks trust and daily usability.

Status update (2026-02-13):
- Budgets + alarms are shipped.
- Workspace summary prefetch/cache is shipped in dashboard switcher.
- Team members API removed per-member auth lookup N+1 (batched auth list lookup).
- Deep workspace-switch profiling is shipped (`workspace_switch_profile_events`, phase timings, payload sizes).
- Integration health now surfaces large-tenant profiling status/warnings and coverage.
- Selective cache invalidation is shipped via workspace switch cache-bust keys.
- Remaining: tune profiling budgets using production samples and promote warning thresholds to alert policy.

Deliverables:
- API/query profiling for workspace load paths
- Prefetch + cache strategy for personal and active org summaries
- Budget alarms for p95 regressions

Acceptance criteria:
- Workspace toggle p95 under 1s for normal tenant sizes
- No N+1 query path in team/memory graph bootstrap endpoints

## 4. Revisit Order

1. P1 starters  
2. P1 automatic capture  
3. P2 actionable intelligence  
4. P2 performance budgets

## 5. Notes

- P0 tracks immediate execution focus.  
- P1/P2 are intentionally documented for follow-up after P0 lands.
