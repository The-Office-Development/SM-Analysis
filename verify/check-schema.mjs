#!/usr/bin/env node
/**
 * Does the database actually have the schema this code expects?
 *
 * WHY THIS IS A SCRIPT AND NOT A PASTED QUERY
 *
 * On 2026-09-12 a session was asked whether migrations 0014 and 0015 had been
 * applied and could not answer. The only channel available was a PostgREST read
 * with the anon key, and it returned `42501 permission denied` — the same answer
 * a correctly locked-down database gives for a column that DOES exist, because
 * permission is checked before the column is resolved. The check could not fail
 * and therefore could not pass.
 *
 * THE RULE THIS SCRIPT IS BUILT AROUND
 *
 * "Cannot verify" must never be reportable as "verified". Every exit path below
 * is either a definite YES, a definite NO, or a loud UNVERIFIED with a non-zero
 * status. There is no quiet success. `verify/*.mjs` printers that always exit 0
 * are the cautionary tale in CLAUDE.md and this file must not join them.
 *
 *   node verify/check-schema.mjs
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY for the schema half. The anon half runs
 * without it and checks the opposite thing: that anon is still locked out.
 */
import { readFileSync, readdirSync } from "node:fs";

/* ---- config from .env, without printing any of it ------------------------ */
function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env; fall back to the process environment */ }
  return { ...out, ...process.env };
}
const env = loadEnv();
const URL_BASE = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * One column per migration that the CODE depends on.
 *
 * Probing the column rather than trusting the ledger is the point: a row in
 * schema_migrations can be inserted without the DDL ever running, and a column
 * can exist without a row. Only the probe says what the sync will actually find.
 * Migrations that add no column are listed with `column: null` and verified by
 * the behaviour they change instead.
 */
const EXPECTED = [
  { version: "0002_token_refresh", table: "provider_identities", column: "refresh_lock_at" },
  { version: "0003_deletion_and_consent", table: "deletion_requests", column: "status" },
  { version: "0004_ai_usage", table: "ai_usage", column: "user_id" },
  { version: "0005_instagram_login", table: "social_accounts", column: "auth_mode" },
  { version: "0006_revoke_anon_grants", table: null, column: null, note: "checked by the anon lockout above" },
  { version: "0007_account_timezone", table: "social_accounts", column: "tz_offset_minutes" },
  { version: "0008_advanced_metrics", table: "metrics_daily", column: "reach_non_followers" },
  { version: "0010_stories", table: "content", column: "expires_at" },
  { version: "0011_token_scope_audit", table: "social_accounts", column: "write_scopes" },
  { version: "0012_content_refreshed_at", table: "content", column: "refreshed_at" },
  { version: "0013_content_checked_at", table: "content", column: "checked_at" },
  { version: "0014_needs_reauth", table: "social_accounts", column: "needs_reauth" },
  { version: "0015_audience_dimensions", table: "audience_snapshots", column: "dimensions" },
  { version: "0016_schema_migrations", table: "schema_migrations", column: "version" },
];

/** Every table anon must NOT be able to read. */
const LOCKED = ["metrics_daily", "content", "audience_snapshots", "social_accounts", "schema_migrations"];

const rest = (path, key) => fetch(`${URL_BASE}/rest/v1/${path}`, {
  headers: {
    apikey: key, Authorization: `Bearer ${key}`,
    "Accept-Profile": "pulseboard", Accept: "application/json",
  },
});

/**
 * What kind of thing is in SUPABASE_SERVICE_ROLE_KEY?
 *
 * Three outcomes, because they need three different things done about them and
 * a single "invalid key" lumps them together. This project uses Supabase's
 * NEWER key format — `sb_publishable_...` for the browser and `sb_secret_...`
 * for the server — not the legacy `eyJ...` JWTs, which is worth encoding here
 * because it sends you to a different page of the dashboard.
 */
function classifyKey(v) {
  const t = String(v).trim();
  if (!t || /^(paste|paste_here|paste_it_here|changeme|your[-_ ]?key|xxx+|<.*>)$/i.test(t)) {
    return "placeholder";
  }
  // The browser key, pasted where the server key belongs. Easy to do: they sit
  // next to each other in the dashboard and only the prefix differs.
  if (/^sb_publishable_/.test(t)) return "publishable";
  if (/^sb_secret_/.test(t)) return "plausible";
  const jwt = /^(eyJ[\w-]*)\.([\w-]+)\.([\w-]+)$/.exec(t);
  if (jwt) {
    // A legacy JWT carries its own role, so the wrong one can be named exactly
    // rather than left to a 401 the reader has to interpret.
    try {
      const role = JSON.parse(Buffer.from(jwt[2], "base64url").toString()).role;
      if (role && role !== "service_role") return "publishable";
    } catch { /* unreadable payload; let the server judge it */ }
    return "plausible";
  }
  return "placeholder";
}

/** One cheap authenticated call, to tell a bad credential from a bad schema. */
async function serviceKeyWorks() {
  const res = await rest("social_accounts?select=id&limit=1", SERVICE);
  return !(res.status === 401 || res.status === 403);
}

let failures = 0, unverified = 0;
const ok = (m) => console.log(`  ok        ${m}`);
const bad = (m) => { failures++; console.log(`  FAILED    ${m}`); };
const unk = (m) => { unverified++; console.log(`  UNVERIFIED ${m}`); };

if (!URL_BASE || !ANON) {
  console.error("No VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Nothing can be checked.");
  process.exit(2);
}

console.log(`\nschema check — ${new URL(URL_BASE).host}\n`);

/* ---- 1. anon must still be locked out ------------------------------------
 * This half needs no secret, and it is the half that proves the CHECKER works:
 * if anon could read these, the deny-by-default posture from 0006 is gone.
 */
console.log("anon lockout (migration 0006, and the RLS posture generally)");
for (const t of LOCKED) {
  const res = await rest(`${t}?select=*&limit=1`, ANON);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403 || body?.code === "42501") ok(`anon denied on ${t}`);
  else if (res.ok) bad(`anon CAN READ ${t} — deny-by-default is broken`);
  else if (body?.code === "PGRST205" || body?.code === "42P01")
    // Not denied — absent. Worth saying plainly, because "anon cannot read it"
    // is trivially true of a table that does not exist and proves nothing.
    bad(`${t} DOES NOT EXIST — a migration has not been applied`);
  else unk(`anon on ${t}: unexpected ${res.status} ${body?.code ?? ""}`);
}

/* ---- 2. the schema itself, which needs the service role ------------------ */
console.log("\napplied migrations and the columns they add");
if (!SERVICE) {
  /*
   * The important branch. Without the key this script knows NOTHING about the
   * schema, and it says so and exits non-zero rather than printing a tidy
   * summary of the half it could do. The 2026-09-12 failure was precisely a
   * "no" that looked like it might be a "yes".
   */
  unk("SUPABASE_SERVICE_ROLE_KEY is not set — the schema cannot be inspected at all");
  console.log(`
  The anon key cannot answer this. PostgREST checks table permission BEFORE it
  resolves a column, so a missing column and a healthy refusal are the same
  42501. Add SUPABASE_SERVICE_ROLE_KEY to .env (gitignored; already listed in
  .env.example) and run again.
`);
} else if (classifyKey(SERVICE) === "publishable") {
  /*
   * A real key, of the wrong kind. Named specifically because the symptom is an
   * indistinguishable 401 and the fix is "copy the other one on the same page".
   */
  unk("SUPABASE_SERVICE_ROLE_KEY holds the PUBLISHABLE (browser) key, not the secret one");
  console.log(`
  That is the same key as VITE_SUPABASE_ANON_KEY, which is public by design and
  is denied by RLS exactly as it should be — so it can never answer this question.
  The one needed here sits beside it and begins "sb_secret_".
`);
} else if (classifyKey(SERVICE) === "placeholder") {
  /*
   * The placeholder case, which is not hypothetical: the docs said to run
   *   printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' 'PASTE_HERE' >> .env
   * and it was run verbatim, so .env held the literal word. Worth naming
   * exactly, because the symptom — 401 Invalid API key — reads like a revoked
   * or wrong key and sends you looking in the wrong place.
   */
  unk(`SUPABASE_SERVICE_ROLE_KEY is set to a placeholder, not a key`);
  console.log(`
  The value in .env begins "${SERVICE.trim().slice(0, 12)}${SERVICE.trim().length > 12 ? "..." : ""}", which is not a key.
  This project uses Supabase's newer format, so the one needed here begins
  "sb_secret_". (Older projects use a JWT beginning "eyJ".) Replace the line in
  .env and run again.
`);
} else if (!(await serviceKeyWorks())) {
  /*
   * Fail ONCE, not once per probe.
   *
   * The first version of this script reported the same 401 fourteen times —
   * every column probe restating a single fact about the credential. Fourteen
   * lines of identical failure is noise that buries the one thing that needs
   * doing, so the key is checked once before any probe runs.
   */
  unk("SUPABASE_SERVICE_ROLE_KEY is set but the server rejects it (401)");
  console.log(`
  Nothing below this point can be checked with a key the server will not accept,
  so the column probes were skipped rather than repeated fourteen times.

  It has the right shape, so most likely it belongs to a different project or it
  has been rotated. Take the current one from
  Project settings -> API Keys -> secret ("sb_secret_...").
`);
} else {
  const led = await rest("schema_migrations?select=version,source&order=version", SERVICE);
  let recorded = null;
  if (led.ok) {
    recorded = new Set((await led.json()).map((r) => r.version));
    ok(`ledger readable — ${recorded.size} migrations recorded`);
  } else {
    const b = await led.json().catch(() => ({}));
    if (b?.code === "42P01") bad("schema_migrations does not exist — apply 0016_schema_migrations.sql");
    else unk(`ledger unreadable: ${led.status} ${b?.code ?? ""} ${b?.message ?? ""}`);
  }

  for (const e of EXPECTED) {
    if (!e.table) { ok(`${e.version} — ${e.note}`); continue; }
    const res = await rest(`${e.table}?select=${e.column}&limit=1`, SERVICE);
    const body = await res.json().catch(() => ({}));
    const inLedger = recorded ? recorded.has(e.version) : null;

    if (res.ok) {
      if (inLedger === false) bad(`${e.version} — ${e.table}.${e.column} EXISTS but is not in the ledger`);
      else ok(`${e.version} — ${e.table}.${e.column}`);
    } else if (body?.code === "42703" || body?.code === "PGRST204") {
      bad(`${e.version} — ${e.table}.${e.column} IS MISSING${inLedger ? " though the ledger claims it was applied" : ""}`);
    } else if (body?.code === "42P01") {
      bad(`${e.version} — table ${e.table} does not exist`);
    } else {
      unk(`${e.version} — ${e.table}.${e.column}: ${res.status} ${body?.code ?? ""}`);
    }
  }

  /* A migration file on disk that nothing has recorded is the drift that
   * started all this: written, committed, and never run. */
  const onDisk = readdirSync(new URL("../supabase/migrations", import.meta.url))
    .filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, ""));
  if (recorded) {
    const missing = onDisk.filter((v) => !recorded.has(v));
    if (missing.length) bad(`on disk but never recorded as applied: ${missing.join(", ")}`);
    else ok(`all ${onDisk.length} migration files are recorded as applied`);
  }
}

console.log(`\n${failures} failed, ${unverified} unverified\n`);
/*
 * Non-zero for unverified as well as failed. A check that could not run is not
 * a pass, and the exit status is what a human or a CI job will actually read.
 */
process.exit(failures || unverified ? 1 : 0);
