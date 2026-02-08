# Contributing to memories.sh

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+

### Getting Started

```bash
# Clone the repo
git clone https://github.com/WebRenew/memories.git
cd memories

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
```

### Project Structure

```
memories/
  packages/
    cli/     # @memories.sh/cli — npm package
    web/     # Next.js website, docs, and API
```

### Running Locally

```bash
# CLI development
cd packages/cli
pnpm dev

# Web development
cd packages/web
pnpm dev
```

### Running Checks

Before submitting a PR, make sure everything passes:

```bash
# Web
pnpm --filter nextjs-new lint
pnpm --filter nextjs-new typecheck
pnpm --filter nextjs-new build

# CLI
pnpm --filter @memories.sh/cli lint
pnpm --filter @memories.sh/cli build
```

## Making Changes

1. **Fork the repo** and create a branch from `main`
2. **Make your changes** — keep them focused and minimal
3. **Run checks** — lint, typecheck, and build must pass
4. **Write a clear commit message** using [conventional commits](https://www.conventionalcommits.org/):
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation only
   - `chore:` maintenance
   - `refactor:` code change that neither fixes a bug nor adds a feature
5. **Open a pull request** against `main`

## What to Contribute

- Bug fixes
- Documentation improvements
- New output format generators (CLI)
- Performance improvements
- Test coverage

## Code Style

- TypeScript preferred over JavaScript
- Functional patterns over class-based
- Early returns to reduce nesting
- Keep functions small and focused

## Questions?

Open an [issue](https://github.com/WebRenew/memories/issues) or start a [discussion](https://github.com/WebRenew/memories/discussions).
