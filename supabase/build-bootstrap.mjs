#!/usr/bin/env node
/**
 * Concatenates schema.sql and every migration, in order, into bootstrap.sql.
 *
 * This exists for ONE job: standing up a brand-new, empty Supabase project in a
 * single paste. It is a convenience for a fresh project, not a replacement for
 * the migration discipline.
 *
 * >>> NEVER RUN bootstrap.sql AGAINST A PROJECT THAT ALREADY HAS DATA. <<<
 * Use the numbered migrations for that, one at a time, and record which ones you
 * applied. The whole reason migrations are numbered is that `schema.sql` is
 * `create table if not exists` throughout, so re-running it after an edit
 * silently does nothing.
 *
 * bootstrap.sql is GENERATED. Never hand-edit it — change the source file and
 * re-run this script, or the two drift apart and the drift is invisible.
 *
 *   node supabase/build-bootstrap.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const migrations = readdirSync(join(here, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort(); // 0001..0005 — zero-padded, so lexical order is numeric order

const sources = ["schema.sql", ...migrations.map((m) => join("migrations", m))];

// A concatenated file is only safe if nothing in it opens its own transaction,
// runs a psql meta-command, or needs to run outside a transaction block. Check
// rather than assume: a future migration could add any of these, and the
// failure would appear as a confusing half-applied schema.
const HAZARDS = [
  [/^\s*(begin|commit|rollback)\b/im, "transaction control"],
  [/^\s*\\/m, "psql meta-command"],
  [/\bconcurrently\b/i, "CONCURRENTLY (cannot run inside a transaction block)"],
];

const parts = [];
for (const rel of sources) {
  const sql = readFileSync(join(here, rel), "utf8");
  for (const [re, what] of HAZARDS) {
    if (re.test(sql)) {
      console.error(`refusing to build: ${rel} contains ${what}.`);
      console.error("Apply the files individually instead, in order.");
      process.exit(1);
    }
  }
  parts.push(
    `-- ${"=".repeat(74)}\n-- SOURCE: supabase/${rel}\n-- ${"=".repeat(74)}\n\n${sql.trimEnd()}\n`
  );
}

const header = `-- ${"=".repeat(74)}
-- PulseBoard — full bootstrap for a NEW, EMPTY Supabase project.
--
-- GENERATED FILE. Do not edit. Rebuild with:
--     node supabase/build-bootstrap.mjs
--
-- Contains, in order:
${sources.map((s, i) => `--   ${i + 1}. supabase/${s}`).join("\n")}
--
-- >>> ONLY for a project with no data. <<<
-- Against an existing project, apply the numbered migrations one at a time and
-- record which you applied. schema.sql is \`create table if not exists\`
-- throughout, so re-running it after an edit does nothing — silently.
--
-- AFTER RUNNING THIS, one dashboard step is still required:
--   Project Settings -> API -> Exposed schemas -> add \`pulseboard\`
--   (keep \`public\` and \`graphql_public\`). Without it every request
--   returns PGRST106.
-- ${"=".repeat(74)}

`;

const footer = `
-- ${"=".repeat(74)}
-- Verification. Should list every pulseboard table, each with rowsecurity = t.
-- ${"=".repeat(74)}
select tablename, rowsecurity
from pg_tables
where schemaname = 'pulseboard'
order by tablename;
`;

const out = join(here, "bootstrap.sql");
writeFileSync(out, header + parts.join("\n") + footer, "utf8");
console.log(`wrote supabase/bootstrap.sql from ${sources.length} files`);
