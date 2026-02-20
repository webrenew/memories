# Embedding Security Checklist

This checklist tracks issue #189 sign-off scope for hosted SDK embeddings.

## Isolation Invariants

- [x] Tenant isolation boundary enforced by tenant-specific Turso routing (`tenantId` selects DB).
- [x] Project scope filtering applied in lexical and semantic retrieval paths.
- [x] User scope filtering applied in lexical and semantic retrieval paths.
- [x] Context retrieval applies identical scope constraints across `working` + `long_term`.

Verification:

- `packages/web/src/lib/memory-service/queries.semantic.test.ts`
- `packages/web/src/app/api/sdk/v1/context/get/__tests__/matrix.test.ts`

## Logging and Telemetry Privacy

- [x] No raw embedding vectors logged in SDK request handlers.
- [x] Embedding metering metadata redacts vector-like fields/arrays before persistence.
- [x] Operational metrics tables store counters/latency only (no raw vectors).

Verification:

- `packages/web/src/lib/sdk-embedding-billing.ts`
- `packages/web/src/lib/sdk-embedding-billing.test.ts`
- `packages/web/src/lib/sdk-embeddings/jobs.ts`
- `packages/web/src/lib/memory-service/graph/rollout.ts`

## Data Handling and Retention

- [x] Graph rollout metrics are pruned to rolling 7-day retention.
- [x] Backfill/worker telemetry contains operational metadata only.
- [x] Deleted/missing memories trigger embedding cleanup path.

Verification:

- `packages/web/src/lib/memory-service/graph/rollout.ts`
- `packages/web/src/lib/sdk-embeddings/backfill.ts`
- `packages/web/src/lib/sdk-embeddings/jobs.ts`

## Sign-off

Status: `pass` for issue #189 scope after lexical/semantic isolation parity tests and telemetry redaction controls.
