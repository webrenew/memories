# Express Starter

Minimal Express server with three endpoints:

1. `POST /memories/add`
2. `GET /memories/search`
3. `GET /context`

## 1) Install

```bash
npm install
```

## 2) Configure env

```bash
cp .env.example .env
```

Set at least `MEMORIES_API_KEY`.

## 3) Run

```bash
npm run dev
```

Server runs on `http://localhost:8787` by default.

## API examples

```bash
curl -X POST http://localhost:8787/memories/add \
  -H "content-type: application/json" \
  -d '{"content":"Support team escalation path is documented in runbook v3.","type":"fact"}'

curl "http://localhost:8787/memories/search?q=escalation+path"

curl "http://localhost:8787/context?q=support+runbook&mode=all&strategy=baseline"
```
