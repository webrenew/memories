import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const categories = ['objects', 'relation_acl', 'column_acl',
  'effective_relations', 'effective_columns', 'roles', 'schema_acl', 'policies', 'views', 'routines']
const identifier = (name) => `"${name.replaceAll('"', '""')}"`
const target = (name) => name === 'PUBLIC' ? name : identifier(name)
const apiRoles = new Set(['anon', 'authenticated', 'service_role', 'PUBLIC'])
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
  }
  return value
}
const canonical = (value) => JSON.stringify(sortKeys(value))

function unwrapSnapshot(result) {
  if (Array.isArray(result.rows)) return result.rows[0]?.snapshot
  if (Array.isArray(result)) return result[0]?.snapshot
  return result.snapshot ?? result
}

export async function readSnapshot(path) {
  const snapshot = unwrapSnapshot(JSON.parse(await readFile(path, 'utf8')))
  if (!snapshot || !Array.isArray(snapshot.objects)) throw new Error('Expected a catalog snapshot; no object inventory found')
  if (snapshot.roles?.length !== 3) throw new Error('Expected all three API roles in the snapshot')
  return snapshot
}

export function summarize(snapshot) {
  return Object.fromEntries(categories.map((category) => {
    const rows = (snapshot[category] ?? []).map(canonical).sort()
    return [category, { rows: rows.length,
      sha256: createHash('sha256').update(rows.join('\n')).digest('hex') }]
  }))
}

export function compareSnapshots(before, after) {
  // Defaults intentionally differ in the October 30 rebuild simulation, but
  // production before/after comparisons must still detect changes to them.
  return [...categories, 'defaults'].flatMap((category) => {
    const left = new Set((before[category] ?? []).map(canonical))
    const right = new Set((after[category] ?? []).map(canonical))
    return [
      ...[...left].filter((row) => !right.has(row)).map((row) => ({ category, removed: JSON.parse(row) })),
      ...[...right].filter((row) => !left.has(row)).map((row) => ({ category, added: JSON.parse(row) })),
    ]
  })
}

function groupGrants(rows) {
  const grouped = new Map()
  for (const row of rows) {
    if (row.grantor !== row.owner) throw new Error(`Review non-owner grantor on ${row.name}`)
    const key = canonical({ schema: row.schema, name: row.name, kind: row.kind,
      grantee: row.grantee, grantable: row.grantable, column: row.column })
    const group = grouped.get(key) ?? { ...row, privileges: new Set() }
    group.privileges.add(row.privilege)
    grouped.set(key, group)
  }
  return [...grouped.values()]
}

function grantStatement(row) {
  const object = { S: 'sequence', n: 'schema' }[row.kind] ?? 'table'
  const privileges = [...row.privileges].sort().map((privilege) =>
    row.column ? `${privilege} (${identifier(row.column)})` : privilege).join(', ')
  const option = row.grantable ? ' with grant option' : ''
  const name = row.kind === 'n' ? identifier(row.name) : `${identifier(row.schema)}.${identifier(row.name)}`
  return `grant ${privileges} on ${object} ${name} to ${target(row.grantee)}${option};`
}

function schemaUsageRows(snapshot, reviewedRoles) {
  // Export direct API-role USAGE only. PUBLIC schema ACLs are still compared
  // in the full contract; the artifact does not broaden PUBLIC schema access.
  return (snapshot.schema_acl ?? [])
    .filter((row) => row.grantee !== 'PUBLIC' && reviewedRoles.has(row.grantee) && row.privilege === 'USAGE')
    .map((row) => ({ ...row, kind: 'n', schema: 'public', name: 'public' }))
}

function assertKnownGrantees(rows, reviewedRoles) {
  for (const row of rows) {
    if (!reviewedRoles.has(row.grantee) && row.grantee !== row.owner) {
      throw new Error(`Review additional grantee ${row.grantee} on ${row.name} before generating grants`)
    }
  }
}

function conditionalGrant(row, sql, optionalObjects) {
  if (row.schema !== 'public' || !optionalObjects.includes(row.name)) return sql
  const name = `${identifier(row.schema)}.${identifier(row.name)}`.replaceAll("'", "''")
  const body = `begin\n  if to_regclass('${name}') is not null then\n    ${sql}\n  end if;\nend;\n`
  let delimiter = '$data_api_grants$'
  while (body.includes(delimiter)) delimiter = delimiter.slice(0, -1) + '_$'
  return `do ${delimiter}\n${body}${delimiter};`
}

export function applicationSnapshot(snapshot, optionalObjects = []) {
  return Object.fromEntries(Object.entries(snapshot).map(([category, rows]) =>
    [category, rows.filter((row) => !optionalObjects.includes(row.name))]))
}

export function generateGrants(snapshot, additionalGrantees = [], optionalObjects = []) {
  const reviewedRoles = new Set([...apiRoles, ...additionalGrantees])
  for (const role of snapshot.roles) {
    if (role.inherited.length) throw new Error(`Review inherited privileges for ${role.role} before generating grants`)
  }
  const relationRows = [...(snapshot.relation_acl ?? []), ...(snapshot.column_acl ?? [])]
  assertKnownGrantees(relationRows, reviewedRoles)
  const rows = [...relationRows, ...schemaUsageRows(snapshot, reviewedRoles)]
    .filter((row) => reviewedRoles.has(row.grantee))
  const statements = groupGrants(rows).map((row) => conditionalGrant(row, grantStatement(row), optionalObjects))
  if (!statements.length) throw new Error('No API grants found; review the snapshot before creating a baseline')
  return [...new Set(statements)].sort().join('\n') + '\n'
}
