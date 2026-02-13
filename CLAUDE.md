# CLAUDE.md

This document is public and intended for anyone forking or contributing to `webrenew/memories`, including human contributors and AI coding agents.

## What This Repo Is

`memories` is a monorepo for the Memories platform:

- `packages/cli`: `@memories.sh/cli` (CLI + local MCP server)
- `packages/core`: shared memory/storage logic
- `packages/ai-sdk`: SDK helpers for app integration
- `packages/web`: Next.js app, API routes, docs, dashboard
- `examples/`: starter integrations (Next.js, Express, Python)

## Fork Quickstart

```bash
git clone https://github.com/<your-org>/memories.git
cd memories
pnpm install
cp .env.example .env.local
```

Run development servers:

```bash
# Web app
cd packages/web && pnpm dev

# CLI package
cd packages/cli && pnpm dev
```

## Required Checks Before PR / Push

Run from repo root:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

If your change affects runtime behavior, also run tests:

```bash
pnpm test
```

## Contribution Expectations

- Keep PRs focused and small when possible.
- Do not commit secrets or local-only credentials.
- Prefer TypeScript and small, composable functions.
- Update docs/examples when API or CLI behavior changes.
- Preserve backward compatibility unless the change is explicitly breaking and documented.

## Generated and Local Files

- Commit source changes, docs, and examples.
- Avoid committing personal scratch files or local machine artifacts.
- If a generated file is required by the repo build/docs pipeline, keep it in sync with the code that generates it.

## Where To Start

- Product overview and setup: `README.md`
- Contributing process: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Web docs source: `packages/web/content/docs`
- Starter integrations: `examples/`

## Need Help?

- Open an issue: <https://github.com/webrenew/memories/issues>
- Start a discussion: <https://github.com/webrenew/memories/discussions>
