# Explicit Data API grants

The baseline records the existing production permissions before Supabase stops
automatically exposing new public relations on October 30, 2026. It preserves
legacy privileges, including privileges that RLS does not constrain; it is not
a least-privilege redesign. Narrowing that access requires separate review:
[memories #501](https://github.com/webrenew/memories/issues/501).

## Verification

Run from the repository root:

```sh
pnpm security:migration-grants
pnpm test:migration-grants
pnpm test:data-api-grants --snapshot-dir /private/tmp/data-api-grants
```

For the last command, direct Node invocation also works:

```sh
node scripts/test-data-api-grants.mjs --snapshot-dir /private/tmp/data-api-grants
```

The database proof needs Docker and Supabase CLI 2.120.0. It creates a unique
disposable project on ports 56320–56322 with Postgres 17, revokes automatic
relation grants before application DDL, and stops only its own project. Run
proofs sequentially on one host. Snapshots must remain outside Git.

The contract covers the object inventory, direct relation/column ACLs and grant
options, effective table/column/sequence privileges for all three API roles,
schema ACLs, role inheritance, RLS, full policies, views and public/private
routine definitions and EXECUTE permissions. Production comparisons also
include default privileges. Only the disposable simulation changes defaults.

The readable role and RPC plans are checked independently of summary digests.
SQL files use `*.sql -text` so Git preserves their pinned bytes on every platform.
The fast checks also run in the existing lint job; the standalone database proof
uses Node 24, while the existing CI runtime remains covered.
Security negative controls disable RLS, introduce a client write policy, alter
a policy expression and introduce an owner-rights view inside rolled-back
transactions. A server SELECT revoke must fail and the exact baseline grant
must restore it. Post-replay sentinels test every supported relation and
sequence privilege, including INSERT-only and sequence SELECT-only defaults.

## Source guard

Each new public table, view, replacement view, materialized view or sequence
needs a named GRANT or REVOKE in the same SQL file. Serial/identity columns,
including ALTER TABLE ONLY, require sequence decisions too. DO-block DDL is
inspected. Dynamic EXECUTE, unsupported runtime DDL, blanket relation grants,
public schema CREATE and restored permissive defaults fail closed.

Historical files are exceptions only while their exact hashes match.
The guard is a lexical check. The database contract verifies actual access.

## Repository-specific history

The production ledger and repository now both contain 46 versions. Three historical files differ beyond formatting: the February RLS rewrite has corrected regexp escaping, the March lock-index migration uses IF NOT EXISTS, and sdk_projects wraps auth.role() in SELECT. Historical bytes are pinned and unchanged. The final local catalog, including all 14 routines, matches production.

Four original tables (users, organizations, org_members and org_invites) had no creation migration. The backdated recovery migration creates their exported definitions, helpers, indexes, constraints and initial compatibility policies only when absent. Existing production tables and functions take the no-op paths. The original later migrations replace the compatibility policies. Reapplication is verified against the complete permission contract.

The only pending production files are 20260202000000_recover_initial_schema.sql and 20261022233614_explicit_data_api_grants.sql. A reviewed push needs --include-all for the recovery version; it must list exactly those files.

The bootstrap recovery deliberately rejects partial restores that mix missing original tables with already-hardened private helpers. It must not recreate retired public wrappers. Such a database needs a separately reviewed repair; production has all four tables and takes the unchanged path.

## Production procedure

1. Review the PR, exact SQL, history manifest and successful database proof.
2. Refresh main, the complete live ledger and the production snapshot. Stop if
   any current permission or source definition differs from the reviewed state.
3. Confirm that the pending set contains exactly the files documented above.
4. Apply only that reviewed set, recording exact versions, names and SQL in the
   migration ledger. Never reset production or replay catalog fixtures there.
   Use `transaction.mjs` to build the apply SQL from the fresh snapshot and full
   ledger. It verifies the fresh snapshot against the checked-in reviewed summary,
   checks the full live snapshot and ledger before any SQL, and checks every permission category
   again before commit. Any drift rolls back the migrations and ledger entries.
   CI executes that transaction and proves an ACL mutation rolls back its ledger
   entry too. Empty ledgers and NULL snapshots must abort before any migration.
5. Compare complete sorted tuples before and after. Only the ledger may change.
6. Merge only after reviewer approval and green CI, then verify the production
   deployment and representative application reads.

Use inspect.mjs summary/grants/compare with private snapshot files. Raw catalogs
and database credentials belong outside Git. Do not refresh expected digests to
make unexplained differences pass.

For a runnable build command, save the fresh snapshot and a JSON array of full
ledger rows outside Git, then run from the repository root:

```sh
umask 077
node --input-type=module - /private/tmp/before.json /private/tmp/ledger.json > /private/tmp/reviewed-apply.sql <<'JS'
import { readFileSync } from 'node:fs'
import { buildApplyTransaction } from './scripts/data-api-grants/transaction.mjs'
const [snapshotFile, ledgerFile] = process.argv.slice(2)
const raw = JSON.parse(readFileSync(snapshotFile, 'utf8'))
const snapshot = raw.rows?.[0]?.snapshot ?? raw.snapshot ?? raw
const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'))
const config = JSON.parse(readFileSync('scripts/migration-grants.config.json', 'utf8'))
const migrations = [...(config.preBaselineMigrations ?? []), config.baseline].map(filename => ({
  filename, sql: readFileSync(config.directory + '/' + filename, 'utf8'),
}))
process.stdout.write(buildApplyTransaction(readFileSync('scripts/data-api-grants/snapshot.sql', 'utf8'),
  snapshot, ledger, migrations,
  JSON.parse(readFileSync('scripts/data-api-grants/expected-summary.json', 'utf8'))))
JS
```

This prepares SQL only. Submit it only after reviewing the exact file set and
confirming the correct live project, current commit, ledger and snapshot.
Later migrations always replay after the baseline in CI, including catalog-fixture
proofs; the baseline is never reapplied over a later intentional privilege change.


