#!/usr/bin/env bash
# Build the functions and the pure frontend helpers, run the suite, then verify
# the suite can actually detect defects.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "### typecheck"
npx tsc -b --noEmit
npx tsc -p tsconfig.functions.json

echo "### build test targets"
./node_modules/.bin/tsc -p verify/tsconfig.test.json
node -e '
const fs=require("fs"),d="verify/build";
for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".js"))){
  const p=d+"/"+f,s=fs.readFileSync(p,"utf8");
  const o=s.replace(/(from\s+")(\.\/[A-Za-z0-9_\-]+)(")/g,"$1$2.js$3");
  if(o!==s)fs.writeFileSync(p,o);
}'
./node_modules/.bin/tsc src/lib/csv.ts --outDir verify/build-lib --target ES2022 --module ESNext --moduleResolution bundler

echo "### tests"
node --test verify/tests/*.test.mjs

echo "### mutation check"
node verify/mutation-check.mjs
