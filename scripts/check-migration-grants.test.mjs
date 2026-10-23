import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { auditMigrationGrants, findGrantProblems } from './check-migration-grants.mjs'
import { applicationSnapshot, generateGrants, compareSnapshots, summarize } from './data-api-grants/metadata.mjs'

for (const statement of [
  'CREATE TABLE public.missing(id int);',
  'CREATE TABLE IF NOT EXISTS public.missing(id int);',
  'CREATE UNLOGGED TABLE public.missing(id int);',
  'CREATE VIEW public.missing AS SELECT 1;',
  'CREATE OR REPLACE VIEW public.missing AS SELECT 1;',
  'CREATE RECURSIVE VIEW public.missing(n) AS SELECT 1;',
  'CREATE OR REPLACE RECURSIVE VIEW public.missing(n) AS SELECT 1;',
  'CREATE MATERIALIZED VIEW public.missing AS SELECT 1;',
  'CREATE SEQUENCE public.missing;',
  'DO $$ BEGIN CREATE TABLE public.missing(id int); END $$;',
]) {
  test(`rejects missing access decision: ${statement}`, () => assert.ok(findGrantProblems(statement).length))
}

for (const statement of [
  'CREATE TABLE public.ok(id int); GRANT SELECT ON TABLE public.ok TO anon;',
  'CREATE VIEW public.ok AS SELECT 1; REVOKE ALL ON public.ok FROM PUBLIC, anon, authenticated;',
  'CREATE RECURSIVE VIEW public.ok(n) AS SELECT 1; GRANT SELECT ON public.ok TO anon;',
  'CREATE SEQUENCE public.ok; GRANT USAGE ON SEQUENCE public.ok TO service_role;',
  'DO $$ BEGIN CREATE TABLE public.ok(id int); GRANT SELECT ON public.ok TO anon; END $$;',
  'CREATE TABLE public."Mixed.Case"(id int); GRANT SELECT ON public."Mixed.Case" TO anon;',
  'CREATE TABLE public."a""b"(id int); GRANT SELECT ON public."a""b" TO anon;',
  'CREATE TABLE private.ok(id int);',
  "INSERT INTO logs VALUES ('CREATE TABLE public.fake(id int);');",
  'INSERT INTO logs VALUES ($$CREATE TABLE public.fake(id int);$$);',
  '-- CREATE TABLE public.fake(id int);\n/* nested /* CREATE TABLE fake */ comment */ SELECT 1;',
]) {
  test(`accepts explicit decision or non-DDL: ${statement}`, () => assert.deepEqual(findGrantProblems(statement), []))
}

test('does not confuse sequences and tables with the same name', () => {
  assert.ok(findGrantProblems('CREATE SEQUENCE public.foo; GRANT SELECT ON TABLE public.foo TO anon;').length)
})
test('does not accept a grant to another schema', () => {
  assert.ok(findGrantProblems('CREATE TABLE public.foo(id int); GRANT SELECT ON private.foo TO anon;').length)
})
test('rejects dynamic DO-block DDL', () => {
  assert.ok(findGrantProblems("DO $$ BEGIN EXECUTE format('CREATE TABLE %I(id int)', 'foo'); END $$;").length)
})
test('static trigger EXECUTE FUNCTION is not dynamic SQL', () => {
  assert.deepEqual(findGrantProblems('do $$ begin create trigger stamp before update on public.records for each row execute function public.stamp(); end $$;'), [])
})
test('public schema CREATE/ALL is rejected while USAGE and private-schema grants remain valid', () => {
  for (const privilege of ['CREATE', 'ALL']) {
    assert.ok(findGrantProblems(`GRANT ${privilege} ON SCHEMA public TO anon;`).length)
    assert.ok(findGrantProblems(`GRANT ${privilege} ON SCHEMA private, public TO service_role;`).length)
    assert.deepEqual(findGrantProblems(`GRANT ${privilege} ON SCHEMA private TO postgres;`), [])
  }
  assert.deepEqual(findGrantProblems('GRANT USAGE ON SCHEMA public TO anon;'), [])
})
test('SQL SELECT INTO creates a table, while PL/pgSQL INTO assigns a variable', () => {
  assert.ok(findGrantProblems('SELECT 1 INTO public.records;').some((problem) => problem.includes('records')))
  assert.deepEqual(findGrantProblems('SELECT 1 INTO public.records; GRANT SELECT ON public.records TO anon;'), [])
  assert.deepEqual(findGrantProblems('WITH rows AS (SELECT 1) INSERT INTO public.existing SELECT * FROM rows;'), [])
  assert.ok(findGrantProblems('WITH rows AS (SELECT 1) SELECT * INTO public.records FROM rows;').length)
  assert.deepEqual(findGrantProblems('DO $$ DECLARE saved int; BEGIN SELECT 1 INTO saved; END $$;'), [])
  assert.ok(findGrantProblems('CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT 1 INTO public.records; $$;').length)
})
test('rejects runtime DDL inside a function', () => {
  assert.ok(findGrantProblems('CREATE FUNCTION f() RETURNS void AS $$ BEGIN CREATE TABLE x(id int); END $$ LANGUAGE plpgsql;').length)
})
test('rejects runtime DDL and dynamic SQL in single-quoted routine bodies', () => {
  assert.ok(findGrantProblems("CREATE FUNCTION f() RETURNS void AS 'BEGIN CREATE TABLE public.x(id int); END' LANGUAGE plpgsql;").length)
  assert.ok(findGrantProblems("CREATE FUNCTION f() RETURNS void AS 'BEGIN EXECUTE command; END' LANGUAGE plpgsql;").length)
})
test('rejects unsupported routine-body quoting instead of skipping it', () => {
  assert.ok(findGrantProblems("CREATE FUNCTION f() RETURNS void AS E'BEGIN CREATE TABLE public.x(id int); END' LANGUAGE plpgsql;").length)
})
for (const kind of ['TABLES', 'SEQUENCES']) {
  test(`rejects unsupported blanket ${kind} grant without a schema clause`, () => {
    assert.ok(findGrantProblems(`GRANT ALL ON ALL ${kind} TO anon;`).some((problem) => problem.includes('blanket')))
  })
  test(`rejects blanket ${kind} grant`, () => {
    assert.ok(findGrantProblems(`GRANT ALL ON ALL ${kind} IN SCHEMA public TO anon;`).length)
  })
  test(`rejects blanket ${kind} grant when public follows another schema`, () => {
    assert.ok(findGrantProblems(`GRANT ALL ON ALL ${kind} IN SCHEMA private, public TO anon;`).length)
  })
}
test('fails on unterminated SQL instead of skipping it', () => {
  assert.throws(() => findGrantProblems("SELECT 'unterminated"))
})

test('migration adapter rejects unsupported, duplicate and backdated new names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'migration-grants-'))
  try {
    await mkdir(join(directory, 'scripts'))
    await mkdir(join(directory, 'migrations'))
    await writeFile(join(directory, 'scripts/migration-grants.config.json'), JSON.stringify({
      mode: 'migrations', directory: 'migrations', baseline: '20261022000000_baseline.sql', historical: {},
    }))
    for (const name of ['20261022000000_baseline.sql', '20261023000000_a.sql', '20261023000000_b.sql', '20261021_short.sql', '20261021000000_old.sql']) {
      await writeFile(join(directory, 'migrations', name), '-- explicit historical metadata\n')
    }
    const { errors } = await auditMigrationGrants(directory)
    assert.ok(errors.some((error) => error.includes('unsupported')))
    assert.ok(errors.some((error) => error.includes('duplicate')))
    assert.ok(errors.some((error) => error.includes('backdated')))
    await writeFile(join(directory, 'scripts/migration-grants.config.json'), JSON.stringify({
      mode: 'migrations', directory: 'migrations', baseline: '20261022000000_baseline.sql',
      historical: { '20261023000000_a.sql': createHash('sha256').update('-- explicit historical metadata\n').digest('hex') },
    }))
    assert.ok((await auditMigrationGrants(directory)).errors.some((error) => error.includes('pinned migrations must predate')))
    await rm(join(directory, 'migrations/20261022000000_baseline.sql'))
    assert.ok((await auditMigrationGrants(directory)).errors.some((error) => error.includes('missing baseline')))
    await rm(join(directory, 'migrations'), { recursive: true })
    await assert.rejects(auditMigrationGrants(directory), /ENOENT/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

const roles = ['anon', 'authenticated', 'service_role'].map((role) => ({ role, inherited: [] }))
test('only explicitly named operational objects get conditional grants', () => {
  const row = { schema: 'public', name: 'backup', kind: 'r', owner: 'postgres',
    grantor: 'postgres', grantee: 'service_role', privilege: 'SELECT', grantable: false }
  const sql = generateGrants({ roles, relation_acl: [row, { ...row, name: 'app_table' }] }, [], ['backup'])
  assert.match(sql, /if to_regclass\('"public"\."backup"'\) is not null/)
  assert.deepEqual(findGrantProblems(sql), [])
  assert.ok(sql.includes('grant SELECT on table "public"."app_table" to "service_role";'))
  const current = { objects: [{ name: 'backup' }, { name: 'app_table' }], relation_acl: [row], roles }
  assert.deepEqual(applicationSnapshot(current, ['backup']).objects, [{ name: 'app_table' }])
  assert.deepEqual(applicationSnapshot(current, ['backup']).roles, roles)
})
test('serial, identity, nextval and added serial columns need their own sequence decision', () => {
  for (const statement of [
    'create table public.events(id bigserial); grant select on public.events to anon;',
    'create table public.events(id bigint generated always as identity); grant select on public.events to anon;',
    'alter table public.events add column id serial;',
    'do $$ begin create table public.events(id serial); grant select on public.events to anon; end $$;',
    "alter table public.events add column id bigint default nextval('public.events_id_seq'::regclass);",
  ]) {
    assert.ok(findGrantProblems(statement).some((problem) => problem.includes('events_id_seq')))
    assert.deepEqual(findGrantProblems(statement + ' revoke all on sequence public.events_id_seq from anon;'), [])
  }
  assert.ok(findGrantProblems('alter table public.events add column id bigint default nextval(sequence_name);')
    .some((problem) => problem.includes('non-literal nextval')))
})
test('temporary objects remain outside the public Data API', () => {
  assert.deepEqual(findGrantProblems('create temporary table records(id bigserial);'), [])
  assert.deepEqual(findGrantProblems('create global temporary table records(id bigserial);'), [])
})
test('temp and temporary object names do not hide public relations', () => {
  assert.ok(findGrantProblems('create table temp(id bigserial);').some((problem) => problem.includes('temp_id_seq')))
  assert.ok(findGrantProblems('create view temporary as select 1;').length)
})
test('nextval identifiers are distinct from actual sequence calls', () => {
  assert.deepEqual(findGrantProblems('create table public.nextval(id int); grant select on public.nextval to anon;'), [])
  assert.deepEqual(findGrantProblems('create table public.events(nextval int); grant select on public.events to anon;'), [])
})
test('static routine EXECUTE privileges inside DO are not dynamic SQL', () => {
  assert.deepEqual(findGrantProblems('do $$ begin grant execute on function public.f() to anon; revoke grant option for execute on function public.f() from anon; end $$;'), [])
  assert.ok(findGrantProblems("do $$ begin grant execute on function public.f() to anon; execute 'select 1'; end $$;")
    .some((problem) => problem.includes('dynamic EXECUTE')))
})
test('default grants cannot restore automatic public relation access', () => {
  for (const kind of ['tables', 'sequences']) {
    assert.ok(findGrantProblems(`alter default privileges for role postgres in schema public grant select on ${kind} to anon;`).length)
    assert.ok(findGrantProblems(`alter default privileges grant select on ${kind} to anon;`).length)
    assert.deepEqual(findGrantProblems(`alter default privileges in schema private grant select on ${kind} to anon;`), [])
  }
})
test('additional grantees require an explicit reviewed configuration', () => {
  const acl = { schema: 'public', name: 'oauth_clients', kind: 'r', owner: 'postgres',
    grantor: 'postgres', grantee: 'supabase_auth_admin', privilege: 'SELECT', grantable: false }
  assert.throws(() => generateGrants({ roles, relation_acl: [acl] }), /additional grantee/)
  assert.match(generateGrants({ roles, relation_acl: [acl] }, ['supabase_auth_admin']), /to "supabase_auth_admin"/)
})
test('generator fails explicitly on additional relation or column grantees', () => {
  for (const category of ['relation_acl', 'column_acl']) {
    assert.throws(() => generateGrants({ roles, [category]: [
      { owner: 'postgres', grantee: 'dedicated_loader', name: 'employers' },
    ] }), /Review additional grantee dedicated_loader on employers/)
  }
  const owner = { schema: 'public', name: 'report', kind: 'r', owner: 'postgres',
    grantor: 'postgres', privilege: 'SELECT', grantable: false }
  const sql = generateGrants({ roles, relation_acl: [
    { ...owner, grantee: 'postgres' }, { ...owner, grantee: 'PUBLIC' },
  ] })
  assert.match(sql, /to PUBLIC;/)
  assert.doesNotMatch(sql, /to "postgres"/)
})
test('named GRANT ALL and REVOKE ALL are explicit access decisions', () => {
  for (const decision of ['grant all on public.report to anon', 'revoke all on public.report from anon']) {
    assert.deepEqual(findGrantProblems(`create table public.report(id int); ${decision};`), [])
  }
})
test('catalog generator preserves materialized-view, sequence, column and grant-option ACLs', () => {
  const base = { schema: 'public', owner: 'postgres', grantor: 'postgres', grantee: 'anon', privilege: 'SELECT', grantable: false }
  const sql = generateGrants({ roles, relation_acl: [
    { ...base, name: 'report', kind: 'm' },
    { ...base, name: 'counter', kind: 'S', privilege: 'USAGE', grantable: true },
  ], column_acl: [{ ...base, name: 'restricted', column: 'allowed' }] })
  assert.match(sql, /on table "public"\."report" to "anon"/)
  assert.match(sql, /on sequence "public"\."counter" to "anon" with grant option/)
  assert.match(sql, /SELECT \("allowed"\) on table "public"\."restricted"/)
  assert.doesNotMatch(sql, /ALL|authenticated/)
})
test('schema adapter checks nested loader DDL and unregistered SQL files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'schema-grants-'))
  try {
    await mkdir(join(directory, 'scripts'))
    await mkdir(join(directory, 'etl/nested'), { recursive: true })
    await writeFile(join(directory, 'scripts/migration-grants.config.json'), JSON.stringify({
      mode: 'schema', schemaFiles: ['etl/schema.sql'], runtimeDirectory: 'etl',
    }))
    await writeFile(join(directory, 'etl/schema.sql'), 'CREATE TABLE public.foo(id int); GRANT SELECT ON public.foo TO anon;')
    await writeFile(join(directory, 'etl/nested/loader.py'), 'sql = "CREATE TABLE public.runtime_table(id int)"')
    await writeFile(join(directory, 'etl/nested/schema.sql'), 'CREATE TABLE public.unregistered(id int);')
    const { errors } = await auditMigrationGrants(directory)
    assert.ok(errors.some((error) => error.includes('runtime relation DDL')))
    assert.ok(errors.some((error) => error.includes('register schema SQL')))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('generator stops on inherited access and non-owner grantors', () => {
  assert.throws(() => generateGrants({ roles: [{ role: 'anon', inherited: ['custom'] }] }), /inherited/)
  assert.throws(() => generateGrants({ roles, relation_acl: [
    { grantee: 'anon', owner: 'postgres', grantor: 'custom', name: 'foo' },
  ] }), /grantor/)
})
test('generator includes existing direct API schema USAGE without adding CREATE', () => {
  const sql = generateGrants({ roles, schema_acl: roles.map(({ role }) => ({
    grantee: role, privilege: 'USAGE', grantor: 'pg_database_owner', owner: 'pg_database_owner', grantable: false,
  })) })
  for (const { role } of roles) assert.ok(sql.includes(`grant USAGE on schema "public" to "${role}";`))
  assert.doesNotMatch(sql, /CREATE|to PUBLIC/)
})
test('comparison detects column, sequence and grant-option changes', () => {
  const before = { column_acl: [{ name: 'private', grantable: false }], relation_acl: [{ kind: 'S', privilege: 'USAGE' }] }
  const after = { column_acl: [{ name: 'private', grantable: true }] }
  assert.equal(compareSnapshots(before, after).length, 3)
  assert.deepEqual(compareSnapshots(before, before), [])
})
test('comparison detects default privilege changes', () => {
  const before = { defaults: [{ creator: 'postgres', privilege: 'INSERT', grantee: 'anon' }] }
  assert.equal(compareSnapshots(before, {}).length, 1)
  assert.deepEqual(compareSnapshots(before, before), [])
})
test('nested permission fields are preserved while object key order is ignored', () => {
  const before = { objects: [{ name: 'report', policy: { roles: ['anon'], flags: { allowed: false } } }] }
  const reordered = { objects: [{ policy: { flags: { allowed: false }, roles: ['anon'] }, name: 'report' }] }
  const changed = { objects: [{ name: 'report', policy: { roles: ['anon'], flags: { allowed: true } } }] }
  assert.deepEqual(summarize(before), summarize(reordered))
  assert.deepEqual(compareSnapshots(before, reordered), [])
  assert.notDeepEqual(summarize(before), summarize(changed))
  assert.equal(compareSnapshots(before, changed).length, 2)
})
