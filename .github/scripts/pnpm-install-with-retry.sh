#!/usr/bin/env bash

set -euo pipefail

MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}"
BASE_SLEEP_SECONDS="${BASE_SLEEP_SECONDS:-5}"

if ! [[ "$MAX_ATTEMPTS" =~ ^[0-9]+$ ]] || [[ "$MAX_ATTEMPTS" -lt 1 ]]; then
  echo "MAX_ATTEMPTS must be a positive integer (got: $MAX_ATTEMPTS)" >&2
  exit 2
fi

if ! [[ "$BASE_SLEEP_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "BASE_SLEEP_SECONDS must be a non-negative integer (got: $BASE_SLEEP_SECONDS)" >&2
  exit 2
fi

attempt=1
while true; do
  echo "pnpm install attempt $attempt/$MAX_ATTEMPTS"
  if pnpm install --frozen-lockfile; then
    exit 0
  fi

  if [[ "$attempt" -ge "$MAX_ATTEMPTS" ]]; then
    echo "pnpm install failed after $MAX_ATTEMPTS attempts" >&2
    exit 1
  fi

  sleep_seconds=$(( BASE_SLEEP_SECONDS * attempt ))
  echo "pnpm install failed; retrying in ${sleep_seconds}s..." >&2
  sleep "$sleep_seconds"
  attempt=$(( attempt + 1 ))
done
