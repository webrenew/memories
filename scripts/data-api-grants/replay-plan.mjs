// The baseline must precede every later migration, including in catalog-fixture proofs.
export function replayPlan(config, names) {
  const before = []
  const after = []
  for (const name of names.filter((name) => name.toLowerCase().endsWith('.sql'))) {
    if (name === config.baseline) continue
    if (Object.hasOwn(config.historical, name) || config.preBaselineMigrations?.includes(name)) before.push(name)
    else after.push(name)
  }
  const ordered = (files) => files.sort((a, b) => {
    const av = a.split('_')[0].padEnd(14, '0')
    const bv = b.split('_')[0].padEnd(14, '0')
    return av < bv ? -1 : av > bv ? 1 : a < b ? -1 : a > b ? 1 : 0
  })
  return { before: ordered(before), after: ordered(after) }
}

