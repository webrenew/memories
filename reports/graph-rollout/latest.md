# Graph Rollout Baseline Report

No snapshots generated yet.

This file is updated by the scheduled workflow:
`Graph Rollout Baseline Report` (`.github/workflows/graph-rollout-baseline-report.yml`).

Required workflow configuration:

- `MEMORIES_GRAPH_ROLLOUT_API_KEY` (GitHub secret, required)
- `MEMORIES_GRAPH_ROLLOUT_API_BASE_URL` (GitHub variable, optional, defaults to `https://memories.sh`)
- `MEMORIES_GRAPH_ROLLOUT_TARGETS_JSON` (GitHub variable, optional JSON array of scope targets)

After the first successful run, this report will include:

- baseline gap-to-goal snapshots
- blocker trends
- promotion recommendation history
- readiness regression alerts
