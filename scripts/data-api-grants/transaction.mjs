import assert from 'node:assert/strict'
import { categories } from './metadata.mjs'
import { assertSnapshotContract, snapshotQueryBody } from './proof-support.mjs'

function literal(value, tag, occupied) {
  let suffix = tag
  while (occupied.includes('$' + suffix + '$')) suffix += '_'
  return '$' + suffix + '$' + value + '$' + suffix + '$'
}

// Builds one transaction from reviewed source and a fresh metadata-only snapshot.
// A mismatch before or after any migration aborts every SQL and ledger change.
export function buildApplyTransaction(snapshotSql, expected, ledger, migrations, reviewedSummary) {
  assert.deepEqual(Object.keys(expected).sort(), [...categories, 'defaults'].sort(),
    'A complete production permission snapshot is required')
  assertSnapshotContract(expected, reviewedSummary, 'Caller-supplied production snapshot')
  assert.ok(Array.isArray(ledger) && ledger.length, 'A complete nonempty migration ledger is required')
  assert.ok(Array.isArray(migrations) && migrations.length, 'No reviewed migrations supplied')
  const versions = migrations.map(({ filename }) => {
    const match = filename.match(/^(\d{14})_([a-z0-9_]+)\.sql$/)
    assert.ok(match, 'Reviewed migration filename must contain an exact version and name')
    return { version: match[1], name: match[2] }
  })
  assert.equal(new Set(versions.map((row) => row.version)).size, versions.length,
    'Duplicate reviewed migration version')
  assert.ok(versions.every(({ version }) => !ledger.some((row) => row.version === version)),
    'A reviewed migration is already recorded; inspect the ledger before retrying')
  const body = snapshotQueryBody(snapshotSql)
    .replace(' as snapshot\nfrom (values', ' into observed\nfrom (values')
  assert.ok(body.includes(' into observed\nfrom (values'), 'Snapshot query output changed')
  const content = body + JSON.stringify(expected) + JSON.stringify(ledger) + migrations.map((row) => row.sql).join('\n')
  let outer = 'production_grants_apply'
  while (content.includes('$' + outer + '$')) outer += '_'
  const sql = [
    'begin isolation level repeatable read;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'do $' + outer + '$',
    'declare',
    '  expected jsonb := ' + literal(JSON.stringify(expected), 'reviewed_permissions', content) + '::jsonb;',
    '  expected_history jsonb := ' + literal(JSON.stringify(ledger), 'reviewed_ledger', content) + '::jsonb;',
    '  observed jsonb;',
    '  actual_history jsonb;',
    'begin',
    body,
    "if observed is distinct from expected then raise exception 'Production permission contract changed; no migration applied'; end if;",
    'select jsonb_agg(to_jsonb(m) order by version) into actual_history from supabase_migrations.schema_migrations m;',
    "if actual_history is distinct from expected_history then raise exception 'Production migration ledger changed; no migration applied'; end if;",
  ]
  for (const [index, migration] of migrations.entries()) {
    assert.ok(migration.sql.trim(), 'Empty reviewed migration')
    const { version, name } = versions[index]
    sql.push(migration.sql)
    sql.push("insert into supabase_migrations.schema_migrations(version,name,statements) values ('"
      + version + "','" + name + "',array[" + literal(migration.sql, 'migration_source', content) + ']);')
  }
  sql.push(body,
    "if observed is distinct from expected then raise exception 'Permission contract drift after migration; transaction rolled back'; end if;",
    'end;', '$' + outer + '$;', 'commit;', '')
  return sql.join('\n')
}

