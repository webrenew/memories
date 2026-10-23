import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertReviewedRoleAccess } from './data-api-grants/role-access.mjs'
import { summarize } from './data-api-grants/metadata.mjs'
import { assertSnapshotContract } from './data-api-grants/proof-support.mjs'

const privileges = ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
const plan = { records: { anon: [], authenticated: ['SELECT'], service_role: ['SELECT'] } }
function snapshot() {
  return { objects: [{ name: 'records', kind: 'r' }],
    effective_relations: ['anon', 'authenticated', 'service_role'].flatMap((role) =>
      privileges.map((privilege) => ({ name: 'records', role, privilege,
        allowed: privilege === 'SELECT' && role !== 'anon' }))),
  }
}

test('partial backend grants fail independently of refreshed digests', () => {
  const actual = snapshot()
  assertReviewedRoleAccess(actual, plan)
  actual.effective_relations.find((row) => row.role === 'service_role' && row.privilege === 'SELECT').allowed = false
  assertSnapshotContract(actual, summarize(actual), '/private/actual.json')
  assert.throws(() => assertReviewedRoleAccess(actual, plan), /Reviewed role access differs: records:service_role/)
})
test('new objects need reviewed role decisions', () => {
  const actual = snapshot()
  actual.objects.push({ name: 'unreviewed', kind: 'r' })
  assert.throws(() => assertReviewedRoleAccess(actual, plan), /Missing reviewed object role plan/)
})
test('every API role and privilege must be represented, including denied access', () => {
  assert.throws(() => assertReviewedRoleAccess(snapshot(), { records: { anon: [], authenticated: ['SELECT'] } }), /Explicit API-role/)
  const actual = snapshot()
  actual.effective_relations.pop()
  assert.throws(() => assertReviewedRoleAccess(actual, plan), /Missing role privilege metadata/)
})
test('an intentional client-only object can explicitly deny service-role access', () => {
  const actual = snapshot()
  for (const row of actual.effective_relations.filter((row) => row.role === 'service_role')) row.allowed = false
  assertReviewedRoleAccess(actual, { records: { ...plan.records, service_role: [] } })
})
