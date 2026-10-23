import { readSnapshot, summarize, compareSnapshots, generateGrants } from './metadata.mjs'
import { readFile } from 'node:fs/promises'

const usage = 'Usage: node scripts/data-api-grants/inspect.mjs summary SNAPSHOT | grants SNAPSHOT | compare BEFORE AFTER\n'
function parseArguments(args) {
  const [command, ...files] = args
  if (!['summary', 'grants', 'compare'].includes(command)) throw new Error(usage.trim())
  const required = command === 'compare' ? 2 : 1
  if (files.length !== required) throw new Error(usage.trim())
  return { command, file: files[0], after: files[1] }
}
async function main() {
  if (['--help', '-h'].includes(process.argv[2])) { process.stdout.write(usage); return }
  const { command, file, after } = parseArguments(process.argv.slice(2))
  const snapshot = await readSnapshot(file)
  if (command === 'grants') {
    const config = JSON.parse(await readFile(new URL('../migration-grants.config.json', import.meta.url), 'utf8'))
    process.stdout.write(generateGrants(snapshot, config.additionalGrantees ?? [], config.optionalObjects ?? [])); return
  }
  const result = command === 'summary' ? summarize(snapshot)
    : compareSnapshots(snapshot, await readSnapshot(after))
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (Array.isArray(result) && result.length) process.exitCode = 1
}
await main().catch((error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
