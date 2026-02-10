# @memories.sh/web

Next.js app for memories.sh marketing site, docs, dashboard, and API routes.

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm test
pnpm typecheck
```

## Environment

Configure Supabase, Stripe, Turso, and Upstash env vars before running locally.

## Notes

- Docs content lives in `content/docs/`.
- App routes and API handlers live in `src/app/`.
- Shared utilities (auth, rate limiting, Turso helpers) live in `src/lib/`.
