import assert from 'node:assert/strict'
import { assertSecurityPosture } from './security-posture.mjs'
import { summarize } from './metadata.mjs'

const identifier = (name) => `"${name.replaceAll('"', '""')}"`
const relation = (row) => `${identifier(row.schema)}.${identifier(row.name)}`

// These mutations run only inside the caller's disposable database, then roll back.
export function verifySecurityControls(baseline, contract, fixture) {
  assertSecurityPosture(baseline, contract)
  const table = baseline.objects.find((row) => ['r', 'p'].includes(row.kind))
  const view = baseline.views[0]
  assert.ok(table, 'Expected at least one table to test RLS')
  assert.ok(baseline.policies.some((row) => row.command === 'SELECT'),
    'Expected at least one SELECT policy to test policy-expression capture')
  const disabled = fixture('rls-disabled', `alter table ${relation(table)} disable row level security;`)
  assert.throws(() => assertSecurityPosture(disabled, contract), /RLS must be enabled/)
  const inserted = fixture('public-insert-policy', `create policy grants_proof_public_insert
    on ${relation(table)} for insert to anon with check (true);`)
  assert.throws(() => assertSecurityPosture(inserted, contract), /Unreviewed write policy/)
  const target = view ? relation(view) : 'public.grants_proof_security_view'
  const create = view ? '' : `create view ${target} with (security_invoker=true) as select 1 as value;`
  const ownerView = fixture('owner-rights-view', `${create} alter view ${target} reset (security_invoker);`)
  assert.throws(() => assertSecurityPosture(ownerView, contract), /must use security_invoker/)
  for (const name of contract.privateClientObjects) {
    const changed = fixture('private-client-grant', `grant select on public.${identifier(name)} to anon;`)
    assert.throws(() => assertSecurityPosture(changed, contract), /Private object must deny client privileges/)
  }
  verifyPolicyChanges(baseline, contract, fixture)
}

function verifyPolicyChanges(baseline, contract, fixture) {
  const policy = baseline.policies.find((row) => row.command === 'SELECT')
  const expression = policy.using_expression === 'false' ? 'true' : 'false'
  const changed = fixture('select-policy-changed', `alter policy ${identifier(policy.policy)}
    on ${relation(policy)} using (${expression});`)
  assert.notDeepEqual(summarize(changed).policies, summarize(baseline).policies,
    'Policy expressions must affect the permission contract')
  const write = contract.writePolicies.find((row) => row.command === 'ALL')
  if (!write) return
  const weakened = fixture('write-policy-weakened', `alter policy ${identifier(write.policy)}
    on ${relation(write)} using (true) with check (true);`)
  assert.throws(() => assertSecurityPosture(weakened, contract), /Write policy changed/)
}
