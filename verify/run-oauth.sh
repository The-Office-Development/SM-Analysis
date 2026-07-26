#!/usr/bin/env bash
# Re-run the OAuth-callback verification from a clean state.
# Usage (from the repo root):  bash verify/run-oauth.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "### compiling netlify/functions/oauth-meta-callback.ts (+ _lib.ts) -> verify/build-oauth/"
rm -rf verify/build-oauth
./node_modules/.bin/tsc -p verify/tsconfig.oauth.json

# tsc emits ESM with extensionless relative specifiers ('./_lib'), which Node's ESM
# loader will not resolve. Rewrite the emitted JS only -- the .ts sources are untouched.
sed -i 's#from "\./_lib"#from "./_lib.js"#g' verify/build-oauth/*.js

echo "### running verify/oauth.test.mjs"
node verify/oauth.test.mjs 2>&1 | tee verify/out-oauth.txt

echo
echo "### summary"
grep -h "^RESULT" verify/out-oauth.txt
