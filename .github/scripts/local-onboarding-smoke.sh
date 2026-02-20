#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export MEMORIES_DATA_DIR="$(mktemp -d)"
SMOKE_HOME="$(mktemp -d)"
SMOKE_WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$MEMORIES_DATA_DIR" "$SMOKE_HOME" "$SMOKE_WORK_DIR"
}
trap cleanup EXIT

run_step() {
  local step_id="$1"
  local remediation_hint="$2"
  shift 2

  local log_file="/tmp/memories-local-onboarding-${step_id}.log"

  echo "::group::${step_id}"
  set +e
  "$@" >"$log_file" 2>&1
  local exit_code=$?
  set -e

  if [ "$exit_code" -ne 0 ]; then
    echo "::error title=Local onboarding smoke failed::Step '${step_id}' failed. Remediation: ${remediation_hint}"
    echo "Command: $*"
    echo "Log file: $log_file"
    cat "$log_file" || true
    echo "::endgroup::"
    exit "$exit_code"
  fi

  cat "$log_file"
  echo "::endgroup::"
}

run_memories_step() {
  local step_id="$1"
  local remediation_hint="$2"
  shift 2
  local escaped_args
  escaped_args="$(printf "%q " "$@")"
  run_step \
    "$step_id" \
    "$remediation_hint" \
    bash -lc "cd \"$SMOKE_WORK_DIR\" && HOME=\"$SMOKE_HOME\" XDG_CONFIG_HOME=\"$SMOKE_HOME/.config\" MEMORIES_DATA_DIR=\"$MEMORIES_DATA_DIR\" node \"$REPO_ROOT/packages/cli/dist/index.js\" ${escaped_args}"
}

cd "$REPO_ROOT"

run_step \
  "build_cli" \
  "Run 'pnpm --filter @memories.sh/cli build' locally to inspect TypeScript/build failures before rerunning CI." \
  pnpm --filter @memories.sh/cli build

git -C "$SMOKE_WORK_DIR" init -q

run_memories_step \
  "setup_minimal_local" \
  "Ensure setup defaults still support non-interactive local mode: 'memories setup --minimal-local -y'." \
  setup --minimal-local -y

run_memories_step \
  "doctor_local_only" \
  "Run 'memories doctor --local-only' and fix the reported failed check(s)." \
  doctor --local-only

run_memories_step \
  "add_rule_smoke" \
  "Run 'memories add --rule \"smoke\"' and verify local DB initialization/path resolution." \
  add --rule "smoke"

run_memories_step \
  "search_smoke" \
  "Run 'memories search \"smoke\"' and verify write/read path in local mode." \
  search "smoke"

search_log="/tmp/memories-local-onboarding-search_smoke.log"
if grep -q "No memories found matching \"smoke\"" "$search_log"; then
  echo "::error title=Local onboarding smoke failed::Step 'search_smoke' did not return inserted memory. Remediation: verify add/search local round-trip behavior."
  cat "$search_log" || true
  exit 1
fi

echo "Local onboarding smoke check passed."
