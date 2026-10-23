import assert from 'node:assert/strict'

const roles = ['anon', 'authenticated', 'service_role']
const tablePrivileges = ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']

// This readable role plan is reviewed separately from regenerable summary hashes.
export function assertReviewedRoleAccess(snapshot, plan, optionalObjects = []) {
  const objects = snapshot.objects.filter((row) => !optionalObjects.includes(row.name))
  const names = Object.keys(plan).filter((name) => !optionalObjects.includes(name))
  assert.deepEqual(names.sort(), objects.map((row) => row.name).sort(), 'Missing reviewed object role plan')
  for (const object of objects) {
    const expected = plan[object.name]
    assert.deepEqual(Object.keys(expected).sort(), [...roles].sort(), `Explicit API-role decisions required: ${object.name}`)
    for (const role of roles) assertRole(snapshot, object, role, expected[role])
  }
}

function assertRole(snapshot, object, role, expected) {
  assert.ok(Array.isArray(expected), `Explicit role privileges required: ${object.name}:${role}`)
  const rows = snapshot.effective_relations.filter((row) => row.name === object.name && row.role === role)
  const privileges = object.kind === 'S' ? ['SELECT', 'UPDATE', 'USAGE'] : tablePrivileges
  assert.deepEqual(rows.map((row) => row.privilege).sort(), [...privileges].sort(),
    `Missing role privilege metadata: ${object.name}:${role}`)
  const actual = rows.filter((row) => row.allowed).map((row) => row.privilege).sort()
  assert.deepEqual(actual, [...expected].sort(), `Reviewed role access differs: ${object.name}:${role}`)
}
