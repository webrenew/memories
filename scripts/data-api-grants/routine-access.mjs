import assert from 'node:assert/strict'
const key = (row) => `${row.schema}.${row.name}(${row.arguments})`
export function assertRoutineAccess(snapshot, expected) {
  assert.ok(Array.isArray(snapshot.routines), 'Missing routine permission inventory')
  assert.deepEqual(snapshot.routines.map(key).sort(), Object.keys(expected).sort(), 'Routine inventory changed')
  for (const routine of snapshot.routines) {
    const contract = expected[key(routine)]
    assert.equal(routine.owner, contract.owner, `Routine owner changed: ${key(routine)}`)
    assert.equal(routine.security_definer, contract.security_definer, `Routine security mode changed: ${key(routine)}`)
    assert.deepEqual(Object.fromEntries(routine.effective_execute.map((row) => [row.role, row.execute])),
      contract.execute, `Reviewed RPC execution differs: ${key(routine)}`)
  }
}

