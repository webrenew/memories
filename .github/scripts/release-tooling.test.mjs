import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse } from "yaml"

const root = fileURLToPath(new URL("../../", import.meta.url))
const json = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"))
const workflow = (name) => parse(readFileSync(path.join(root, `.github/workflows/${name}.yml`), "utf8"))
const manifest = json("package.json")
const config = json(".changeset/config.json")

test("release action v2 and CLI v3 retain the release contract", () => {
  const release = workflow("release")
  assert.deepEqual(Object.keys(release.on).sort(), ["push", "workflow_dispatch"])
  assert.deepEqual(release.on.push.branches, ["main"])
  assert.equal(release.concurrency["cancel-in-progress"], false)
  assert.equal(release.jobs.release.permissions["id-token"], "write")
  const action = release.jobs.release.steps.find((step) => step.uses?.startsWith("changesets/action@"))
  assert.equal(action.uses, "changesets/action@v2")
  assert.deepEqual(action.with, {
    "version-script": "pnpm version-packages",
    "publish-script": "pnpm release",
    "pr-title": "chore: version packages",
    "commit-message": "chore: version packages",
    "github-token": "${{ secrets.GITHUB_TOKEN }}",
    "push-with-git-cli": true,
  })
  assert.equal(action.env.NPM_CONFIG_PROVENANCE, true)
  assert.equal(action.env.GITHUB_TOKEN, undefined)
  assert.equal(manifest.devDependencies["@changesets/cli"], "^3.0.3")
  assert.equal(manifest.scripts["version-packages"], "changeset version")
  assert.equal(manifest.scripts.release, "changeset publish")
  assert.deepEqual(config.privatePackages, { version: true, tag: false })
  assert.equal(config.access, "public")
  assert.equal(config.commit, false)
  assert.equal(config.baseBranch, "main")
  assert.equal(config.updateInternalDependencies, "patch")
  assert.deepEqual(config.ignore, [])
})

test("installs use a supported Node and the pinned pnpm with unchanged overrides", () => {
  assert.equal(manifest.packageManager, "pnpm@10.34.5")
  const lock = parse(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"))
  assert.deepEqual(lock.overrides, manifest.pnpm.overrides)
  assert.equal(lock.importers["."].devDependencies["@changesets/cli"].version, "3.0.3")
  assert.equal(json("package-lock.json").packages["node_modules/@changesets/cli"].version, "3.0.3")
  for (const name of ["release", "ci", "local-onboarding-smoke"]) {
    for (const job of Object.values(workflow(name).jobs)) {
      let node
      for (const step of job.steps) {
        if (step.uses?.startsWith("pnpm/action-setup@")) {
          assert.equal(step.with?.version, undefined, "Use packageManager, not a second pnpm version")
        }
        if (step.uses?.startsWith("actions/setup-node@")) node = step.with["node-version"]
        if (step.run?.includes("pnpm-install-with-retry.sh")) assert.equal(node, 24)
      }
    }
  }
  const compatibility = workflow("ci").jobs["node20-packages"].steps
  const node20 = compatibility.findIndex((step) => step.with?.["node-version"] === 20)
  assert.ok(node20 > 0)
  assert.ok(compatibility.slice(node20).some((step) => step.run?.includes("node packages/cli/dist/index.js --help")))
})

test("Changesets status/version updates a disposable monorepo without publishing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "memories-release-test-"))
  const write = (file, value) => {
    const dest = path.join(dir, file)
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`)
  }
  const read = (file) => JSON.parse(readFileSync(path.join(dir, file), "utf8"))
  // Only status and version are allowed here: never execute publish or the action.
  const changeset = (command, ...args) => {
    assert.ok(["status", "version"].includes(command))
    return spawnSync(process.execPath, [path.join(root, "node_modules/@changesets/cli/bin.js"), command, ...args], {
      cwd: dir,
      encoding: "utf8",
    })
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" })
  try {
    write("package.json", { private: true, packageManager: manifest.packageManager })
    write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n")
    write(".gitignore", "node_modules\n")
    write(".changeset/config.json", config)
    write("packages/core/package.json", { name: "@fixture/core", version: "1.0.0" })
    write("packages/cli/package.json", {
      name: "@fixture/cli", version: "1.0.0", dependencies: { "@fixture/core": "workspace:^" },
    })
    write("packages/web/package.json", { name: "@fixture/web", private: true, version: "1.0.0" })
    symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "dir")
    git("init", "-b", "main")
    git("add", ".")
    git("-c", "user.name=Release test", "-c", "user.email=release-test@example.invalid", "commit", "-m", "fixture")

    const empty = changeset("status", "--output=empty.json")
    assert.equal(empty.status, 0, empty.stderr + empty.stdout)
    assert.deepEqual(read("empty.json").releases, [])
    // v3 intentionally exits 1 with no changesets; the action must gate versioning.
    assert.equal(changeset("version").status, 1)

    write(".changeset/fixture.md", '---\n"@fixture/core": minor\n"@fixture/web": patch\n---\n\nTest the coordinated tooling migration.\n')
    const status = changeset("status", "--output=plan.json")
    assert.equal(status.status, 0, status.stderr + status.stdout)
    const releases = read("plan.json").releases
    assert.ok(releases.some((release) => release.name === "@fixture/core" && release.newVersion === "1.1.0"))
    assert.ok(releases.some((release) => release.name === "@fixture/web" && release.newVersion === "1.0.1"))
    const version = changeset("version")
    assert.equal(version.status, 0, version.stderr + version.stdout)
    assert.equal(read("packages/core/package.json").version, "1.1.0")
    assert.equal(read("packages/web/package.json").version, "1.0.1")
    assert.equal(read("packages/cli/package.json").dependencies["@fixture/core"], "workspace:^")
    assert.match(readFileSync(path.join(dir, "packages/core/CHANGELOG.md"), "utf8"), /Test the coordinated tooling migration/)
    assert.equal(git("tag", "--list").trim(), "")
    assert.equal(git("rev-list", "--count", "HEAD").trim(), "1", "Versioning must not commit")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
