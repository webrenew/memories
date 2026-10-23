import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareSnapshots } from './data-api-grants/metadata.mjs'
import { verifySecurityControls } from './data-api-grants/security-controls.mjs'
import { assertSecurityPosture } from './data-api-grants/security-posture.mjs'
import { assertReviewedRoleAccess } from './data-api-grants/role-access.mjs'
import { assertRoutineAccess } from './data-api-grants/routine-access.mjs'
import { buildApplyTransaction } from './data-api-grants/transaction.mjs'
import { assertSnapshotContract, parseProofArguments, proofDirectory,
  proofUsage, snapshotQueryBody, stopProofDatabase, writeProofSnapshot } from './data-api-grants/proof-support.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(root, 'scripts/migration-grants.config.json'), 'utf8'))
const security = JSON.parse(readFileSync(join(root, 'scripts/data-api-grants/security-contract.json'), 'utf8'))
const rolePlan = JSON.parse(readFileSync(join(root, 'scripts/data-api-grants/role-access.json'), 'utf8'))
const project = `grants-${randomUUID().slice(0, 8)}`
const scratch = mkdtempSync(join(tmpdir(), `${project}-`))
const migrations = join(scratch, 'supabase/migrations')
const container = `supabase_db_${project}`
const lifecycle = { project, container, scratch, startAttempted: false, started: false }
const snapshotSql = readFileSync(join(root, 'scripts/data-api-grants/snapshot.sql'), 'utf8')
const run = (command, args, input) => execFileSync(command, args, {
  cwd: root, input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'],
})
const query = (sql) => run('docker', ['exec', '-i', container, 'psql', '-U', 'postgres',
  '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], sql)
const snapshot = () => JSON.parse(query(snapshotSql))
let outputDirectory = scratch

function capture(name) {
  const current = snapshot()
  writeProofSnapshot(outputDirectory, name, current)
  assertSecurityPosture(current, security)
  assertRoutineAccess(current, security.routineAccess)
  return current
}

function securityFixture(name, sql) {
  const body = snapshotQueryBody(snapshotSql)
  const current = JSON.parse(query(`begin; ${sql}\n${body}\nrollback;`))
  writeProofSnapshot(outputDirectory, name, current)
  return current
}

function prepare() {
  mkdirSync(migrations, { recursive: true })
  writeFileSync(join(scratch, 'supabase/config.toml'), `project_id = "${project}"
[api]
enabled = false
port = 56321
[db]
port = 56322
shadow_port = 56320
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[auth]
enabled = true
[storage]
enabled = true
[realtime]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = false
`)
  assert.equal(config.mode, 'migrations', 'This proof replays the full migration history')
  for (const name of readdirSync(join(root, config.directory))) {
    if (!config.catalogFixtures && name.endsWith('.sql') && name !== config.baseline) {
      cpSync(join(root, config.directory, name), join(migrations, name))
    }
  }
  writeFileSync(join(migrations, '00000000000000_LOCAL_ONLY_simulate_oct30.sql'),
    'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;\n'
    + 'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;\n')
}

function verifySentinels() {
  const sql = readFileSync(join(root, 'scripts/data-api-grants/sentinels.sql'), 'utf8')
  query(`begin; ${sql} rollback;`)
  for (const grant of [
    'grant insert on tables to anon',
    'grant select on sequences to authenticated',
  ]) {
    assert.throws(() => query(`begin;
      alter default privileges for role postgres in schema public ${grant};
      ${sql} rollback;`), /Unexpected default access/,
    `Sentinel must detect permissive defaults: ${grant}`)
  }
}

function verifyServerRoleRecovery(baseline, artifact) {
  const table = baseline.objects.find((object) => object.kind === 'r'
    && !(config.optionalObjects ?? []).includes(object.name)
    && baseline.effective_relations.some((row) => row.name === object.name
      && row.role === 'service_role' && row.privilege === 'SELECT' && row.allowed))
  assert.ok(table, 'Expected an application table with reviewed server read access')
  const target = `"public"."${table.name.replaceAll('"', '""')}"`
  const grant = artifact.split('\n').map((line) => line.trim())
    .find((line) => line.startsWith('grant ') && line.includes(` on table ${target} to "service_role"`))
  assert.ok(grant, 'Expected the exact baseline server grant for the negative control')
  const revoke = `revoke select on table ${target} from service_role;`
  const revoked = securityFixture('server-read-revoked', revoke)
  assert.throws(() => assertReviewedRoleAccess(revoked, rolePlan), /Reviewed role access differs/)
  const restored = securityFixture('server-read-restored', `${revoke}\n${grant}`)
  assertReviewedRoleAccess(restored, rolePlan)
  assert.deepEqual(compareSnapshots(baseline, restored), [], 'Exact baseline grant must restore the reviewed server access')
}

function proof() {
  const expected = JSON.parse(readFileSync(join(root, 'scripts/data-api-grants/expected-summary.json'), 'utf8'))
  if (config.catalogFixtures) {
    query(config.catalogFixtures.map((file) => readFileSync(join(root, file), 'utf8')).join('\n'))
  }
  const without = capture('without-baseline')
  assertSnapshotContract(without, { objects: expected.objects }, join(outputDirectory, 'without-baseline.json'), ['objects'])
  assert.throws(() => assertReviewedRoleAccess(without, rolePlan), /Reviewed role access differs/,
    'A fresh database without the baseline must lose the recorded API access')
  const baselineFile = config.baselineFile ?? join(config.directory, config.baseline)
  query(readFileSync(join(root, baselineFile), 'utf8'))
  const withBaseline = capture('with-baseline')
  assertReviewedRoleAccess(withBaseline, rolePlan)
  assertSnapshotContract(withBaseline, expected, join(outputDirectory, 'with-baseline.json'))
  if (withBaseline.objects.some((row) => row.kind === 'S')) {
    assert.deepEqual([...new Set(withBaseline.effective_relations.filter((row) => row.kind === 'S')
      .map((row) => row.privilege))].sort(), ['SELECT', 'UPDATE', 'USAGE'],
    'Snapshot must check every sequence privilege')
  }
  verifyServerRoleRecovery(withBaseline, readFileSync(join(root, baselineFile), 'utf8'))
  verifyRoleQueries(withBaseline)
  const routine = withBaseline.routines.find((row) =>
    row.effective_execute.some((access) => access.role === 'service_role' && access.execute))
  assert.ok(routine, 'Expected a callable backend routine')
  const routineName = `"${routine.schema.replaceAll('"', '""')}"."${routine.name.replaceAll('"', '""')}"(${routine.arguments})`
  const revoked = securityFixture('rpc-execute-revoked',
    `revoke execute on function ${routineName} from PUBLIC, anon, authenticated, service_role;`)
  assert.throws(() => assertRoutineAccess(revoked, security.routineAccess), /Reviewed RPC execution differs/)
  for (const name of config.preBaselineMigrations ?? []) query(readFileSync(join(root, config.directory, name), 'utf8'))
  query(readFileSync(join(root, baselineFile), 'utf8'))
  assert.deepEqual(compareSnapshots(withBaseline, capture('reapplied')), [], 'Reapplication must preserve every permission tuple')
  verifySentinels()
  verifySecurityControls(withBaseline, security, securityFixture)
  assert.deepEqual(compareSnapshots(withBaseline, capture('after-fixtures')), [], 'Fixture and sentinel checks must roll back')
  verifyAtomicApplication(capture('before-atomic-apply'))
}

function verifyAtomicApplication(expected) {
  const files = [...(config.preBaselineMigrations ?? []), config.baseline]
  // Only the unique disposable database is connected here. Recreate the pending
  // ledger state without changing any application table or permission.
  const versions = files.map((file) => `'${file.split('_')[0]}'`).join(',')
  query(`delete from supabase_migrations.schema_migrations where version in (${versions});`)
  const historySql = 'select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m;'
  const ledger = JSON.parse(query(historySql))
  const migrations = files.map((filename) => ({ filename,
    sql: readFileSync(join(root, config.directory, filename), 'utf8') }))
  query(buildApplyTransaction(snapshotSql, expected, ledger, migrations))
  assert.deepEqual(compareSnapshots(expected, capture('after-atomic-apply')), [], 'Atomic apply must preserve all permissions')
  const recorded = JSON.parse(query(historySql))
  assert.equal(recorded.length, ledger.length + files.length)
  const table = expected.objects.find((row) => row.kind === 'r')
  const changed = [{ filename: '20990101000000_atomic_negative.sql',
    sql: `revoke select on public."${table.name.replaceAll('"', '""')}" from anon;` }]
  assert.throws(() => query(buildApplyTransaction(snapshotSql, expected, recorded, changed)),
    /Permission contract drift after migration/)
  assert.deepEqual(JSON.parse(query(historySql)), recorded, 'Failed apply must roll back its ledger entry')
  assert.deepEqual(compareSnapshots(expected, capture('after-atomic-rollback')), [], 'Failed apply must roll back its ACL change')
}

function verifyRoleQueries(snapshot) {
  for (const object of snapshot.objects.filter((row) => row.kind !== 'S')) {
    const name = `"${object.schema.replaceAll('"', '""')}"."${object.name.replaceAll('"', '""')}"`
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (snapshot.effective_relations.some((row) =>
        row.name === object.name && row.role === role && row.privilege === 'SELECT' && row.allowed)) {
        query(`begin; set local role ${role}; select 1 from ${name} limit 0; rollback;`)
      }
    }
  }
  const fixture = `begin;
    create table public.grants_role_fixture(id bigserial, owner_id uuid);
    alter table public.grants_role_fixture enable row level security;
    grant select, insert on public.grants_role_fixture to authenticated;
    create policy own_rows on public.grants_role_fixture to authenticated
      using (owner_id = auth.uid()) with check (owner_id = auth.uid());
    set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
  `
  const insert = `insert into public.grants_role_fixture(owner_id)
    values ('11111111-1111-1111-1111-111111111111') returning id;`
  assert.throws(() => query(fixture + `set local role authenticated; ${insert} rollback;`),
    /permission denied for sequence/)
  query(fixture + `grant usage on sequence public.grants_role_fixture_id_seq to authenticated;
    set local role authenticated; ${insert} rollback;`)
  assert.throws(() => query(fixture + `set local role anon; ${insert} rollback;`),
    /permission denied for table/)
}

let success = false
try {
  const options = parseProofArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(proofUsage)
  } else {
    outputDirectory = proofDirectory(options.snapshotDirectory, scratch)
    prepare()
    lifecycle.startAttempted = true
    try {
      run('supabase', ['start', '--workdir', scratch, '--exclude',
        'edge-runtime,imgproxy,logflare,mailpit,postgres-meta,postgrest,realtime,studio,supavisor,vector,kong'])
      lifecycle.started = true
    }
    catch (error) {
      writeFileSync(join(scratch, 'startup.log'), `${error.stdout ?? ''}\n${error.stderr ?? ''}`)
      throw new Error(`Disposable database setup or migration replay failed. Inspect ${join(scratch, 'startup.log')}`)
    }
    query("do $$ begin if to_regclass('cron.job') is not null then perform cron.unschedule(jobid) from cron.job; end if; end $$;")
    proof()
    const source = config.catalogFixtures ? 'catalog fixture (not a historical replay)' : 'fresh historical replay'
    process.stdout.write(`Data API proof passed: ${source}, full permission contract, idempotency, private sentinels, role checks, and RLS/policy/view security negative controls.\n`)
    if (options.snapshotDirectory) process.stdout.write(`Proof snapshots: ${outputDirectory}\n`)
    success = true
  }
} catch (error) {
  process.stderr.write(`${error.stack}\n`)
  process.stderr.write(`Proof snapshots: ${outputDirectory}\n`)
  process.exitCode = 1
} finally {
  // Stop a successful start, or this invocation's partially created database.
  try { stopProofDatabase(lifecycle, run) }
  catch (error) { process.stderr.write(`Cleanup failed for ${project}: ${error.message}\n`); process.exitCode = 1 }
  if (success || !lifecycle.startAttempted) rmSync(scratch, { recursive: true })
}
