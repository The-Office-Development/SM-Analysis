#!/usr/bin/env bash
# Re-run the whole verification from a clean state.
# Usage (from the repo root):  bash verify/run-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "### compiling netlify/functions/_sync.ts -> verify/build/ (repo tsconfigs untouched)"
./node_modules/.bin/tsc -p verify/tsconfig.emit.json

for s in A B C D; do
  node verify/ig-sync.test.mjs "$s" 2>&1 | tee "verify/out-$s.txt"
done

echo "### incremental gap-fill probe (existing metrics_daily row)"
node verify/ig-sync.test.mjs B --latest=2026-07-24 2>&1 | tee verify/out-B-incremental.txt

echo "### summaries"
grep -h "^RESULT" verify/out-*.txt
