#!/usr/bin/env node
/**
 * Apply a migration to the live database, and record it.
 *
 * WHY THIS EXISTS
 *
 * Every migration here has been applied by pasting SQL into the dashboard, which
 * is why nothing knew what had been applied and why `check-schema.mjs` had to be
 * written at all. This closes the other half: the same session that writes a
 * migration can apply it and then prove it landed.
 *
 * WHY IT NEEDS A DIFFERENT CREDENTIAL FROM EVERYTHING ELSE
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is a DATA-plane credential. It authenticates to
 * PostgREST, which speaks tables, views and RPCs — there is no way to express
 * `alter table` through it, and no SQL-executing function is exposed (checked:
 * rpc/exec_sql, execute_sql, exec, query and sql all 404). DDL needs the
 * CONTROL plane: a personal access token against api.supabase.com.
 *
 * The Supabase CLI holds such a token, but seals it — the keychain entry is an
 * encrypted blob only the CLI can read — so it cannot be borrowed from here.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_...   in .env (gitignored)
 *   node verify/apply-migration.mjs 0017_deletion_status_failed
 *
 * It refuses to run anything it was not asked for by name, prints the statements
 * first, and re-checks the schema afterwards rather than reporting success on
 * the strength of a 200.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PROJECT = process.env.SUPABASE_PROJECT_REF ?? "vzfgehxqbbzhhsuwhstv";

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* fall back to the process environment */ }
  return { ...out, ...process.env };
}

const env = loadEnv();
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const name = process.argv[2];

if (!name) {
  console.error("usage: node verify/apply-migration.mjs <migration name without .sql>");
  process.exit(2);
}
if (!TOKEN || !/^sbp_/.test(TOKEN.trim())) {
  console.error(`
SUPABASE_ACCESS_TOKEN is not set (or is not a personal access token).

  The service role key CANNOT do this. It authenticates to PostgREST, which has
  no way to express DDL; this needs a control-plane token.

  Create one at https://supabase.com/dashboard/account/tokens, then:

    printf 'Paste sbp_ token, then Enter: '; read -rs T; echo
    [ -n "$T" ] && printf 'SUPABASE_ACCESS_TOKEN=%s\\n' "$T" >> .env; unset T
`);
  process.exit(1);
}

const path = new URL(`../supabase/migrations/${name}.sql`, import.meta.url);
let sql;
try { sql = readFileSync(path, "utf8"); }
catch { console.error(`No such migration: supabase/migrations/${name}.sql`); process.exit(2); }

console.log(`\napplying ${name} to ${PROJECT}\n`);
// Printed in full before anything runs. A migration is the one thing in this
// repo that cannot be undone by editing a file, so it is shown, not summarised.
console.log(sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).join("\n"));

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const body = await res.text();
if (!res.ok) {
  console.error(`\nFAILED ${res.status}: ${body.slice(0, 500)}\n`);
  process.exit(1);
}
console.log(`\nserver accepted it (${res.status}).`);

/*
 * A 200 is not proof. The whole point of check-schema.mjs is that the database
 * is the only thing that knows, so it is asked rather than assumed.
 */
console.log("\nverifying against the database itself:\n");
try {
  execFileSync("node", [new URL("./check-schema.mjs", import.meta.url).pathname], { stdio: "inherit" });
} catch {
  console.error("\nthe schema check did not pass — read it above before trusting the apply.\n");
  process.exit(1);
}
