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
# The interpretation layer produces the numbers a client is shown and a sponsor
# is quoted, so it is tested like the sync is. Type-only imports are stripped by
# the compiler, so analytics.ts builds without dragging in the React tree.
./node_modules/.bin/tsc src/lib/insights.ts --outDir verify/build-lib --target ES2022 --module ESNext --moduleResolution bundler
# analytics.ts and snapshot.ts became compilable on 2026-09-12, when the pure
# selectors moved out of api.ts into series.ts and the platform names out of
# platforms.tsx into platformNames.ts. Until then both imported the Supabase
# client and the React tree, so neither could be tested — and three defects hid
# in them: a posting window invented from a grid of zeros, a LinkedIn report
# carrying Instagram's posting times, and the assistant grounded on a "0" for a
# metric the platform does not report.
./node_modules/.bin/tsc src/lib/analytics.ts src/lib/snapshot.ts --outDir verify/build-lib --target ES2022 --module ESNext --moduleResolution bundler
# format.ts carries timeAgo, which is what tells a client WHEN a figure was read.
# That line is the product's answer to "your number disagrees with Instagram", so
# it is tested rather than trusted.
./node_modules/.bin/tsc src/lib/format.ts --outDir verify/build-lib --target ES2022 --module ESNext --moduleResolution bundler
# The CSV is the only part of this product that is read without the interface
# around it to explain anything, and it is what gets forwarded to a sponsor. Its
# decisions are pure and therefore testable, which is why they live apart from
# the DOM half in reports.ts.
./node_modules/.bin/tsc src/lib/csvReport.ts --outDir verify/build-lib --target ES2022 --module ESNext --moduleResolution bundler
# The workbook is written byte by byte rather than by a library, so the ZIP
# container is tested with the system unzip as an independent reader. A bad CRC
# does not degrade: the file simply refuses to open, in front of the client's
# sponsor.
./node_modules/.bin/tsc src/lib/xlsx.ts src/lib/xlsxReport.ts --outDir verify/build-lib --target ES2022 --module ESNext --moduleResolution bundler
node -e '
const fs=require("fs"),d="verify/build-lib";
for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".js"))){
  const p=d+"/"+f,s=fs.readFileSync(p,"utf8");
  const o=s.replace(/(from\s+")(\.\/[A-Za-z0-9_\-]+)(")/g,"$1$2.js$3");
  if(o!==s)fs.writeFileSync(p,o);
}'

echo "### tests"
node --test verify/tests/*.test.mjs

echo "### mutation check"
node verify/mutation-check.mjs
