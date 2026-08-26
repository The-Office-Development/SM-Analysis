#!/usr/bin/env node
/**
 * Reconciliation — compare what PulseBoard stored against what Instagram shows.
 *
 * Nothing in this codebase has ever been validated against a live API response.
 * Every test runs against a mock built on Meta's *documented* behaviour. This
 * script makes the one check that actually settles it mechanical instead of a
 * squinting exercise: it prints the stored numbers day by day so you can sit
 * with the Instagram app open and tick them off.
 *
 *   export VITE_SUPABASE_URL=...            # or SUPABASE_URL
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   node verify/reconcile.mjs --list
 *   node verify/reconcile.mjs --account <uuid> [--days 14]
 *
 * Where to find the truth in the Instagram app:
 *   Professional dashboard -> Total followers      (followers)
 *   Insights -> Views                              (views)
 *   Insights -> Reach -> Accounts reached          (reach)
 *   Insights -> Interactions                       (engagements)
 * Set the app's date range to a SINGLE DAY to read one day's figure.
 */
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1]?.startsWith("--") === false ? arr[i + 1] : true]] : []
  )
);

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) {
  console.error("Set VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(2);
}
const db = createClient(url, key, { db: { schema: "pulseboard" }, auth: { persistSession: false } });

const pad = (v, n) => String(v ?? "").padStart(n);
const padR = (v, n) => String(v ?? "").padEnd(n);
const fmt = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString());

if (args.list || !args.account) {
  const { data, error } = await db
    .from("social_accounts")
    .select("id,platform,username,status,last_synced_at,auth_mode")
    .order("platform");
  if (error) { console.error(error.message); process.exit(1); }
  if (!data?.length) { console.log("No connected accounts yet."); process.exit(0); }
  console.log("\nConnected accounts:\n");
  console.log(`  ${padR("id", 38)}${padR("platform", 12)}${padR("username", 22)}${padR("status", 12)}last synced`);
  for (const a of data) {
    console.log(`  ${padR(a.id, 38)}${padR(a.platform, 12)}${padR("@" + a.username, 22)}${padR(a.status, 12)}${a.last_synced_at ?? "never"}`);
  }
  console.log(`\nThen: node verify/reconcile.mjs --account ${data[0].id}\n`);
  process.exit(0);
}

const days = Number(args.days ?? 14);
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const { data: acct } = await db.from("social_accounts")
  .select("id,platform,username,last_synced_at,auth_mode").eq("id", args.account).maybeSingle();
if (!acct) { console.error("No such account."); process.exit(1); }

const { data: rows, error } = await db
  .from("metrics_daily")
  .select("date,followers,reach,impressions,views,engagements,provisional")
  .eq("account_id", args.account)
  .gte("date", since)
  .order("date", { ascending: true });
if (error) { console.error(error.message); process.exit(1); }

console.log(`\n  Account   @${acct.username} (${acct.platform}${acct.auth_mode ? `, ${acct.auth_mode}` : ""})`);
console.log(`  Synced    ${acct.last_synced_at ?? "never"}`);
console.log(`  Window    ${since} .. today  (${rows?.length ?? 0} stored day(s))\n`);

if (!rows?.length) {
  console.log("  No metric rows in this window. Run a sync first.\n");
  process.exit(0);
}

console.log(`  ${padR("date", 13)}${pad("followers", 11)}${pad("reach", 10)}${pad("views", 10)}${pad("engagements", 13)}   flag`);
console.log("  " + "-".repeat(70));
for (const r of rows) {
  const flags = [];
  if (r.provisional) flags.push("provisional");
  if ([r.followers, r.reach, r.views, r.engagements].every((v) => v === null)) flags.push("ALL UNKNOWN");
  console.log(
    `  ${padR(r.date, 13)}${pad(fmt(r.followers), 11)}${pad(fmt(r.reach), 10)}${pad(fmt(r.views), 10)}${pad(fmt(r.engagements), 13)}   ${flags.join(", ")}`
  );
}

/* ---- automated suspicion checks ---------------------------------------- */
const problems = [];
const settled = rows.filter((r) => !r.provisional);

// A run of identical values usually means a frozen or carried-forward figure.
for (const key of ["reach", "views", "engagements"]) {
  const vals = settled.map((r) => r[key]).filter((v) => v !== null);
  if (vals.length >= 4 && new Set(vals).size === 1) {
    problems.push(`every settled day has an identical ${key} (${fmt(vals[0])}) — suspect a frozen or carried value`);
  }
  if (vals.length >= 3 && vals.every((v) => Number(v) === 0)) {
    problems.push(`${key} is zero on every settled day — suspect a metric name that no longer exists`);
  }
}

// Missing calendar days inside the window.
const present = new Set(rows.map((r) => r.date));
const missing = [];
for (let d = new Date(rows[0].date); d <= new Date(rows[rows.length - 1].date); d.setUTCDate(d.getUTCDate() + 1)) {
  const iso = d.toISOString().slice(0, 10);
  if (!present.has(iso)) missing.push(iso);
}
if (missing.length) problems.push(`${missing.length} day(s) missing entirely: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`);

// Followers should not move backwards violently or sit perfectly flat.
const foll = rows.map((r) => r.followers).filter((v) => v !== null);
if (foll.length >= 3 && new Set(foll).size === 1) {
  problems.push(`followers identical on every day (${fmt(foll[0])}) — the daily series may not be real`);
}

console.log("\n  Automated checks");
if (problems.length) for (const p of problems) console.log(`    SUSPECT  ${p}`);
else console.log("    nothing obviously wrong in the stored shape");

console.log(`
  Now do the part only a human can do
  -----------------------------------
  Open Instagram -> Professional dashboard -> Insights on @${acct.username}
  and set the date range to ONE DAY at a time. For three or four settled days
  above (skip anything marked provisional), compare:

      followers     Total followers on that date
      reach         Reach -> Accounts reached
      views         Views
      engagements   Interactions

  What the answers mean:
    - numbers match                  the whole chain is correct; ship it
    - off by exactly one day         the day-boundary fix is wrong for this
                                     account: check dayKeyFromEndTime
    - consistently lower             days are being written before they settle;
                                     widen TRAILING_REFETCH
    - a metric is always 0 or —      that metric name no longer exists; see the
                                     IG block in netlify/functions/_instagram.ts
`);
