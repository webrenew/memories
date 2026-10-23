import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findGrantProblems } from './lib/migration-grants.mjs'

export { findGrantProblems } from './lib/migration-grants.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const versionPattern = /^(\d{14})_.+\.sql$/
const hash = (text) => createHash('sha256').update(text).digest('hex')

function migrationVersion(name, config) {
  const standard = name.match(versionPattern)?.[1]
  if (standard) return standard
  const date = name.match(/^(\d{8})_.+\.sql$/)?.[1]
  if (date && (config.dateVersions || config.legacyFilenames?.includes(name))) return date.padEnd(14, '0')
  if (config.legacyFilenames?.includes(name) && Object.hasOwn(config.historical, name)) return '00000000000000'
  return undefined
}

async function sourceFiles(repoRoot, directory) {
  const entries = await readdir(resolve(repoRoot, directory), { withFileTypes: true })
  const nested = await Promise.all(entries.filter((entry) => entry.name !== '__pycache__').map((entry) => {
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? sourceFiles(repoRoot, file) : [file]
  }))
  return nested.flat()
}

async function schemaProblems(repoRoot, config) {
  const errors = []
  for (const file of config.schemaFiles) {
    const sql = await readFile(resolve(repoRoot, file), 'utf8')
    errors.push(...findGrantProblems(sql).map((problem) => `${file}: ${problem}`))
  }
  const registered = [...config.schemaFiles, config.baselineFile]
  for (const file of await sourceFiles(repoRoot, config.runtimeDirectory)) {
    if (file.endsWith('.sql') && !registered.includes(file)) errors.push(`${file}: register schema SQL in migration-grants.config.json`)
    if (!file.endsWith('.py')) continue
    const source = await readFile(resolve(repoRoot, file), 'utf8')
    if (/\bcreate\s+(?:(?:or\s+replace|materialized|unlogged)\s+)?(?:table|view|sequence)\b/i.test(source)) {
      errors.push(`${file}: move runtime relation DDL into a checked schema SQL file with explicit grants`)
    }
  }
  return { errors, checkedCount: config.schemaFiles.length }
}

function missingFiles(names, config) {
  const required = [config.baseline, ...Object.keys(config.historical), ...(config.preBaselineMigrations ?? [])]
  return required.filter((name) => !names.includes(name)).map((name) => `missing baseline or recorded migration: ${name}`)
}

function migrationNameProblems(name, config, baselineVersion) {
  const errors = []
  if (Object.hasOwn(config.historical, name)) errors.push(`historical migration changed: ${name}; review history separately`)
  const version = migrationVersion(name, config)
  if (!version) return [...errors, `unsupported new migration filename: ${name}`]
  const reviewed = [config.baseline, ...(config.preBaselineMigrations ?? [])]
  if (version <= baselineVersion && !reviewed.includes(name)) errors.push(`backdated migration: ${name}`)
  return errors
}

async function inspectMigration(directory, name, config, baselineVersion) {
  const sql = await readFile(resolve(directory, name), 'utf8')
  if (config.historical[name] === hash(sql)) return { checked: 0, errors: [] }
  const errors = migrationNameProblems(name, config, baselineVersion)
  errors.push(...findGrantProblems(sql).map((problem) => `${name}: ${problem}`))
  return { checked: 1, errors }
}

async function migrationProblems(repoRoot, config) {
  const directory = resolve(repoRoot, config.directory)
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => entry.isDirectory())) throw new Error('Unexpected migration subdirectory; configure and test its SQL coverage')
  const names = entries.map((entry) => entry.name).filter((name) => name.toLowerCase().endsWith('.sql')).sort()
  const baselineVersion = config.baseline.match(versionPattern)?.[1]
  if (!baselineVersion) throw new Error('The configured baseline needs a 14-digit SQL filename')
  const results = await Promise.all(names.map((name) => inspectMigration(directory, name, config, baselineVersion)))
  const invalidPins = Object.keys(config.historical).filter((name) => {
    const version = migrationVersion(name, config)
    return !version || version >= baselineVersion
  }).map((name) => `pinned migrations must predate the baseline: ${name}`)
  const errors = [...missingFiles(names, config), ...invalidPins, ...results.flatMap((result) => result.errors)]
  // Old date-only files can share a date. Only exact, immutable historical
  // pins receive that exception; new duplicate versions still fail.
  const versions = names.filter((name) => !Object.hasOwn(config.historical, name))
    .map((name) => migrationVersion(name, config)).filter(Boolean)
  if (new Set(versions).size !== versions.length) errors.push('duplicate migration versions')
  return { errors, checkedCount: results.reduce((sum, result) => sum + result.checked, 0) }
}

export async function auditMigrationGrants(repoRoot = root) {
  const config = JSON.parse(await readFile(resolve(repoRoot, 'scripts/migration-grants.config.json'), 'utf8'))
  if (config.mode === 'schema') return schemaProblems(repoRoot, config)
  if (config.mode === 'migrations') {
    const result = await migrationProblems(repoRoot, config)
    if (config.legacyDirectory) {
      const actual = await sourceFiles(repoRoot, config.legacyDirectory)
      const expected = Object.keys(config.legacyHashes).map((name) => `${config.legacyDirectory}/${name}`)
      for (const file of new Set([...actual, ...expected])) {
        const name = file.slice(config.legacyDirectory.length + 1)
        if (!actual.includes(file) || !Object.hasOwn(config.legacyHashes, name)
          || hash(await readFile(resolve(repoRoot, file), 'utf8')) !== config.legacyHashes[name]) {
          result.errors.push(`historical reference changed or unregistered: ${file}`)
        }
      }
    }
    if (config.catalogFixtures) {
      for (const file of config.catalogFixtures) {
        if (hash(await readFile(resolve(repoRoot, file), 'utf8')) !== config.fixtureHashes?.[file]) {
          result.errors.push(`catalog fixture changed: ${file}`)
        }
      }
      for (const directory of new Set(config.catalogFixtures.map((file) => dirname(file)))) {
        for (const file of await sourceFiles(repoRoot, directory)) {
          if (!config.catalogFixtures.includes(file)) result.errors.push(`unregistered catalog fixture: ${file}`)
        }
      }
    }
    return result
  }
  throw new Error('Unknown migration grants check mode')
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node scripts/check-migration-grants.mjs\nCheck the configured SQL sources for explicit public-object access decisions.\n')
    return
  }
  if (process.argv.length > 2) throw new Error('Unexpected argument; use --help')
  const { errors, checkedCount } = await auditMigrationGrants()
  if (errors.length) {
    for (const error of errors) process.stderr.write(`migration grants: ${error}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`Data API access decisions verified in ${checkedCount} SQL files.\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`migration grants: ${error.message}\n`)
    process.exitCode = 1
  })
}
