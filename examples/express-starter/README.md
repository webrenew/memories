# Express Starter

Minimal Express server with three endpoints:

1. `POST /memories/add`
2. `GET /memories/search`
3. `GET /context`

All routes derive `tenantId` + `userId` from server-side auth mapping (not request body/query).

## 1) Install

```bash
npm install
```

## 2) Configure env

```bash
cp .env.example .env
```

Set at least `MEMORIES_API_KEY`.
Set `APP_AUTH_TOKENS` (format: `token|tenantId|userId`) for auth mapping.

`APP_AUTH_TOKENS` is a demo adapter for local testing. Replace `src/auth-context.js` with Clerk/Auth0/Supabase/custom session verification in production.

## 3) Run

```bash
npm run dev
```

Server runs on `http://localhost:8787` by default.

## API examples

```bash
curl -X POST http://localhost:8787/memories/add \
  -H "authorization: Bearer demo-token" \
  -H "content-type: application/json" \
  -d '{"content":"Support team escalation path is documented in runbook v3.","type":"fact"}'

curl "http://localhost:8787/memories/search?q=escalation+path" \
  -H "authorization: Bearer demo-token"

curl "http://localhost:8787/context?q=support+runbook&mode=all&strategy=baseline" \
  -H "authorization: Bearer demo-token"
```
