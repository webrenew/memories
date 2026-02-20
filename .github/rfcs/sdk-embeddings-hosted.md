# RFC: Hosted SDK Embeddings and Semantic Retrieval

- Status: Draft
- Authors: memories team
- Created: 2026-02-19
- Target release: phased rollout after canary validation

## Summary

The hosted SDK path currently stores and retrieves memories without generating embeddings. Retrieval is keyword-based (FTS + BM25) with optional graph expansion. We need hosted embedding generation and semantic retrieval so SDK users get parity with local CLI semantic capabilities.

This RFC proposes:

1. Embedding generation on hosted memory writes.
2. Backfill for existing memories without embeddings.
3. Customer-selectable embedding models from Vercel AI Gateway offerings.
4. Semantic and hybrid retrieval modes in SDK APIs.
5. Pricing and billing instrumentation based on AI Gateway costs.
6. Tenant/user safe isolation, observability, and staged rollout.

## Problem

Current state:

- Hosted writes (`/api/sdk/v1/memories/add`) persist memory rows but do not create embeddings.
- Hosted search/context retrieval uses FTS/BM25 and LIKE fallback.
- Local CLI already supports embedding generation and semantic search.

Impact:

- SDK users cannot opt into vector similarity retrieval.
- Relevance quality for semantic/intent queries is lower than local CLI.
- Product story is inconsistent across local and hosted offerings.

## Goals

1. Add hosted embedding creation for new/edited memories.
2. Allow SDK customers to choose supported embedding models from AI Gateway.
3. Expose semantic retrieval in SDK search/context APIs.
4. Preserve existing behavior as safe fallback.
5. Keep strict tenant/user/project isolation guarantees.
6. Provide rollout controls with measurable quality/cost impact.
7. Define a pricing model that can be explained clearly to customers.

## Non-goals

1. Cross-tenant retrieval.
2. Supporting arbitrary non-Gateway provider catalogs in v1.
3. Removing FTS/BM25 baseline retrieval.

## Proposed Design

### 1) Data model and storage

Add hosted embedding storage for each memory record:

- `memory_embeddings` table keyed by `memory_id`
- fields: `memory_id`, `embedding` (vector/binary), `model`, `dimension`, `created_at`, `updated_at`
- indexes for scoped retrieval joins and maintenance tasks

Design constraints:

- embeddings never override tenancy boundaries
- embeddings are deleted/updated when source memory is deleted/edited
- dimension/model metadata is explicit for migration safety

### 2) Write path

On `memories.add` and `memories.edit(content)`:

1. Persist memory row first.
2. Queue embedding generation job (async, non-blocking for request path).
3. Upsert embedding row on success.
4. Emit structured metrics/logs for success/failure/latency.

Behavior on failure:

- memory write still succeeds
- embedding generation retries with backoff
- retrieval falls back to lexical ranking when embeddings unavailable

### 3) Retrieval API changes

Add retrieval mode controls to hosted SDK endpoints:

- `search`: `strategy: "lexical" | "semantic" | "hybrid"` (default `"lexical"` initially)
- `context/get`: same strategy control, with weighted fusion for hybrid

Initial ranking behavior:

- lexical: existing BM25 behavior
- semantic: cosine similarity over scoped candidate set
- hybrid: weighted rank fusion (BM25 + vector score), then existing layer ordering rules

Compatibility:

- existing clients without strategy fields keep current behavior
- no breaking API contract changes

### 4) Backfill

Introduce backfill worker for existing memories:

- scoped by tenant/user/project windows
- idempotent batches with checkpointing
- throttled to protect p95 API latency
- resumable after interruption

### 5) Model selection (Vercel AI Gateway)

Source of truth for available embedding models:

- AI Gateway model catalog via `gateway.getAvailableModels()` or `GET https://ai-gateway.vercel.sh/v1/models`
- filter to `modelType === "embedding"` / `type === "embedding"`

Configuration model:

1. Workspace default embedding model (required).
2. Optional project override.
3. Optional request override (must be in allowlist for that workspace).

API contract additions (proposed):

- `memories.add` and `memories.edit` accept `embeddingModel?: string` for content embeddings.
- management endpoint for model discovery + pricing snapshot:
  - `GET /api/sdk/v1/embeddings/models`
  - returns available embedding models, provider, dimensions (when known), and pricing metadata from Gateway.

Validation:

- reject model IDs that are not in the current embedding catalog.
- persist chosen model on each embedding row.
- retrieval scores only compare vectors with compatible model/dimension.

### 6) Pricing and billing model

Pricing source:

- AI Gateway model pricing data from model catalog (for planning/estimation).
- AI Gateway per-request debits from `providerMetadata.gateway.cost` (for authoritative billing records).

Recommended launch policy (v1):

1. Managed Gateway key (default):
   - pass-through + markup.
   - `customer_cost_usd = gateway_cost_usd * (1 + markup_percent) + fixed_fee_usd`
   - initial defaults: `markup_percent = 0.15`, `fixed_fee_usd = 0`.
2. BYOK mode (enterprise override):
   - gateway model usage billed directly to customer provider account.
   - Memories bills no additional embedding usage fee in v1 (platform fee can be added later if needed).
3. Billing granularity:
   - request-level ledger for auditability.
   - invoice/report at monthly aggregate level by tenant and model.

Implementation guidance:

- store per-request cost ledger (new table, e.g. `sdk_embedding_meter_events`):
  - tenant, user, project, model, provider, input_tokens, gateway_cost_usd, market_cost_usd, customer_cost_usd, estimated_cost boolean, timestamp, request_id.
- when `gateway.cost` is unavailable, estimate from usage and cached pricing table, flagged as estimated.
- aggregate monthly usage/cost by tenant/project/model for invoicing and dashboard reporting.
- emit Stripe meter events from the same aggregate pipeline pattern used by `sdk_project_meter_events`.

### 7) Model and configuration lifecycle

v1 defaults:

- workspace-level default embedding model must be configured.
- dimension validated at write and query time.
- model version stamped in embedding row.

Future:

- automated migration tooling when defaults change (re-embed/backfill campaigns).

## Security and isolation

Requirements:

1. Vector queries must apply scope filters before ranking.
2. Tenant/user/project filters must be identical to lexical path.
3. No embedding payload or raw vectors in user-facing logs.
4. Encryption and key handling follow existing database policy.

## Observability

Track:

- write-path embedding queue latency/failure rate
- backfill progress and retry counts
- retrieval p50/p95 by strategy
- semantic/hybrid fallback rate to lexical
- cost metrics per memory written and per query

Add runbooks for:

- embedding job backlog growth
- model mismatch/dimension errors
- elevated retrieval latency

## Rollout plan

1. Shadow mode:
   - generate embeddings and compute semantic scores off-path
   - compare with lexical outcomes, no user-facing changes
2. Canary:
   - enable semantic/hybrid for small tenant subset
   - monitor relevance, latency, and costs
3. Gradual expansion:
   - increase coverage with SLO gates
4. GA:
   - documented public strategy options in SDK docs

Rollback:

- force `strategy=lexical` globally via feature flag
- pause backfill/embedding workers
- keep memory writes available

## Migration and docs

Deliverables:

1. SDK docs for new strategy options and defaults.
2. Operational docs for backfill and incident response.
3. Changelog + migration notes (including fallback behavior).

## Open questions

1. Which hosted vector representation is preferred in Turso/libSQL for v1?
2. Should hybrid strategy default become `"hybrid"` after GA?
3. Do we expose per-request thresholds/weights in v1 or keep server-tuned defaults?
4. Should the launch markup remain flat (15%) or vary by plan/volume tiers?
5. Do we expose request-level embedding cost APIs in v1, or monthly aggregates only?

## References

- Hosted context retrieval: `packages/web/src/lib/memory-service/queries.ts`
- Hosted mutations: `packages/web/src/lib/memory-service/mutations.ts`
- CLI embedding generation: `packages/cli/src/lib/memory.ts`
- CLI embedding utilities: `packages/cli/src/lib/embeddings.ts`
- Vercel AI Gateway models and embedding model discovery: https://vercel.com/docs/ai-gateway/models-and-providers
- Vercel AI Gateway pricing: https://vercel.com/docs/ai-gateway/pricing
- Vercel AI Gateway usage/provider metadata cost fields: https://vercel.com/docs/ai-gateway/provider-options
- AI SDK embedding usage object: https://ai-sdk.dev/docs/ai-sdk-core/embeddings
