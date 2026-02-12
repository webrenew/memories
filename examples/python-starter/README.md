# Python Starter (FastAPI)

Minimal FastAPI service with three routes:

1. `POST /memories/add`
2. `GET /memories/search`
3. `GET /context`

## 1) Create virtualenv + install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2) Configure env

```bash
cp .env.example .env
```

Set at least `MEMORIES_API_KEY`.

## 3) Run

```bash
uvicorn app:app --reload --port 8000
```

## API examples

```bash
curl -X POST http://localhost:8000/memories/add \
  -H "content-type: application/json" \
  -d '{"content":"Escalate production incidents to #oncall within 5 minutes.","type":"rule"}'

curl "http://localhost:8000/memories/search?q=production+incidents"

curl "http://localhost:8000/context?q=incident+playbook&mode=all&strategy=baseline"
```
