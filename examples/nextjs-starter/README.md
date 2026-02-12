# Next.js Starter (`next@16.1.6`)

Minimal Next.js App Router starter that demonstrates:

1. `POST /api/memories/add`
2. `GET /api/memories/search`
3. `GET /api/memories/context`

## 1) Install

```bash
npm install
```

## 2) Configure env

```bash
cp .env.example .env.local
```

Set at least:

- `MEMORIES_API_KEY`

Optional defaults:

- `MEMORIES_TENANT_ID`
- `MEMORIES_USER_ID`
- `MEMORIES_PROJECT_ID`

## 3) Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## API examples

```bash
curl -X POST http://localhost:3000/api/memories/add \
  -H "content-type: application/json" \
  -d '{"content":"Team style guide uses sentence case headings.","type":"rule"}'

curl "http://localhost:3000/api/memories/search?q=style+guide"

curl "http://localhost:3000/api/memories/context?q=heading+rules&mode=all&strategy=baseline"
```
