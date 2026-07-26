#!/usr/bin/env bash
# Frontend "connected-but-empty account" verification.
# Compiles the REAL src/lib + src/components with tsc into verify/build-fe,
# stubs only src/lib/supabase (import.meta.env / network boundary), and runs
# the app's own aggregation + chart code against an empty-account fixture.
# Usage (from the repo root):  bash verify/run-frontend-empty.sh
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf verify/build-fe
echo "### compiling src/lib + src/components -> verify/build-fe/ (repo tsconfigs untouched)"
./node_modules/.bin/tsc -p verify/tsconfig.fe.json
node verify/fixup-fe.mjs

node verify/empty-account.test.mjs 2>&1 | tee verify/out-empty-frontend.txt
node verify/mixed-series.test.mjs 2>&1 | tee verify/out-mixed-series.txt

echo "### summary"
grep -h "^RESULT" verify/out-empty-frontend.txt || true
grep -h "CRASH" verify/out-mixed-series.txt || true
