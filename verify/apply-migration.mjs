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
 * WHY IT DOES NOT USE THE SERVICE ROLE KEY
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is a DATA-plane credential. It authenticates to
 * PostgREST, which speaks tables, views and RPCs — there is no way to express
 * `alter table` through it, and no SQL-executing function is exposed (checked:
 * rpc/exec_sql, execute_sql, exec, query and sql all 404). DDL is the CONTROL
 * plane.
 *
 * HOW IT GETS THERE
 *
 * `supabase db query --linked`, which runs SQL through the Management API using
 * the CLI's own stored login. That needs no extra secret: the CLI is already
 * logged in and `supabase link --project-ref <ref>` records which project.
 *
 * This file was first written to demand a personal access token, on the belief
 * that the CLI could not execute SQL. It can — `supabase db query` — and the
 * belief was never checked. The token path is kept as a fallback for a machine
 * where the CLI is not logged in.
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

/** Is the Supabase CLI installed and linked to a project? */
function cliLinked() {
  try {
    execFileSync("supabase", ["--version"], { stdio: "pipe" });
    return readFileSync(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8").trim();
  } catch { return null; }
}

if (!name) {
  console.error("usage: node verify/apply-migration.mjs <migration name without .sql>");
  process.exit(2);
}
const linkedRef = cliLinked();
if (!TOKEN && !linkedRef) {
  console.error(`
No way to reach the control plane.

  The service role key CANNOT do this: it authenticates to PostgREST, which has
  no way to express DDL. Either link the Supabase CLI, which is the simpler path
  and needs no new secret:

    supabase login          # only if not already logged in
    supabase link --project-ref ${PROJECT}

  or set a personal access token from
  https://supabase.com/dashboard/account/tokens as SUPABASE_ACCESS_TOKEN in .env.
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

if (linkedRef) {
  if (linkedRef !== PROJECT) {
    console.error(`\nThe CLI is linked to ${linkedRef}, not ${PROJECT}. Refusing to guess which you meant.\n`);
    process.exit(1);
  }
  try {
    execFileSync("supabase", ["db", "query", "--linked", "-f", `supabase/migrations/${name}.sql`],
      { stdio: "pipe", cwd: new URL("..", import.meta.url).pathname });
  } catch (e) {
    console.error(`\nFAILED: ${String(e.stderr ?? e.message).slice(0, 600)}\n`);
    process.exit(1);
  }
  console.log("\nthe database accepted it.");
} else {
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
}

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
