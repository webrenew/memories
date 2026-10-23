import assert from 'node:assert/strict'

const publicRoles = ['anon', 'authenticated']
const policyKey = (policy) => `${policy.schema}.${policy.name}: ${policy.policy}`

export function assertSecurityPosture(snapshot, contract) {
  for (const category of ['objects', 'roles', 'policies', 'views']) {
    assert.ok(Array.isArray(snapshot[category]), `Missing security metadata: ${category}`)
  }
  for (const name of publicRoles) assertPublicRole(snapshot, name)
  for (const table of snapshot.objects.filter((row) => ['r', 'p'].includes(row.kind))) {
    assert.equal(table.rls, true, `RLS must be enabled: ${table.schema}.${table.name}`)
    assert.ok(!publicRoles.includes(table.owner), `Public role owns table: ${table.name}`)
  }
  assertWritePolicies(snapshot.policies, contract.writePolicies)
  assertViews(snapshot, contract.writableViews)
  assert.ok(Array.isArray(contract.privateClientObjects), 'Explicit private-object contract required')
  for (const name of contract.privateClientObjects) {
    const access = (snapshot.effective_relations ?? []).filter((row) => row.name === name && publicRoles.includes(row.role))
    assert.ok(access.every((row) => !row.allowed), `Private object must deny client privileges: ${name}`)
    if (snapshot.objects.some((row) => row.name === name)) {
      const privileges = ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      const expected = publicRoles.flatMap((role) => privileges.map((privilege) => `${role}:${privilege}`)).sort()
      assert.deepEqual(access.map((row) => `${row.role}:${row.privilege}`).sort(), expected,
        `Missing client permission metadata for private object: ${name}`)
    }
  }
}

function assertPublicRole(snapshot, name) {
  const role = snapshot.roles.find((row) => row.role === name)
  assert.ok(role, `Missing public API role: ${name}`)
  assert.equal(role.bypass_rls, false, `${name} must not bypass RLS`)
  assert.equal(role.superuser, false, `${name} must not be a superuser`)
  assert.equal(role.can_login, false, `${name} must not log in directly`)
  assert.deepEqual(role.inherited, [], `${name} must not inherit unreviewed role access`)
}

function assertWritePolicies(policies, allowed) {
  assert.ok(Array.isArray(allowed), 'Explicit write-policy contract required')
  const expected = new Map(allowed.map((policy) => [policyKey(policy), policy]))
  const actual = policies.filter((policy) => policy.command !== 'SELECT')
  assert.equal(expected.size, allowed.length, 'Duplicate write-policy contract entry')
  for (const policy of actual) {
    const key = policyKey(policy)
    assert.ok(expected.has(key), `Unreviewed write policy: ${key}`)
    assert.deepEqual(policy, expected.get(key), `Write policy changed: ${key}`)
  }
  assert.deepEqual(actual.map(policyKey).sort(), [...expected.keys()].sort(),
    'Reviewed write-policy inventory changed')
}

function assertViews(snapshot, writable) {
  assert.ok(Array.isArray(writable), 'Explicit writable-view contract required')
  const names = snapshot.objects.filter((row) => row.kind === 'v').map((row) => row.name).sort()
  assert.deepEqual(snapshot.views.map((view) => view.name).sort(), names, 'Missing view security metadata')
  for (const view of snapshot.views) {
    assert.equal(view.security_invoker, true, `View must use security_invoker: ${view.name}`)
    assert.ok(!publicRoles.includes(view.owner), `Public role owns view: ${view.name}`)
    if (!writable.includes(view.name)) assert.equal(view.updatable, 0, `View must be read-only: ${view.name}`)
  }
  assert.deepEqual(snapshot.views.filter((view) => view.updatable !== 0).map((view) => view.name).sort(),
    [...writable].sort(), 'Reviewed writable-view inventory changed')
}
