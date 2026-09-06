#!/usr/bin/env node
/**
 * Run the sync from this machine, against the live API and the live database.
 *
 *   set -a; . ~/pulseboard-netlify.env; set +a
 *   node verify/sync-local.mjs --list
 *   node verify/sync-local.mjs --account <uuid> [--runs 4]
 *
 * WHY THIS EXISTS
 * The scheduled sync runs as a Netlify function, so a paused deploy pins the
 * live site to whatever commit last published — and a sync fired from the app
 * then writes data through the OLD code. On 2026-09-06 that mattered: the fix
 * for the follows_and_unfollows dimension was committed but could not deploy,
 * and syncing from the app would have rewritten the same wrong numbers it was
 * meant to correct.
 *
 * This runs the SAME syncAccount used in production, from the working tree, so
 * the data can be rebuilt correctly without waiting on a deploy. It is a
 * maintenance tool, not a second implementation — if it ever diverges from the
 * function, delete it rather than let two sync paths exist.
 *
 * It needs the service-role key and TOKEN_ENC_KEY, so it only ever runs on a
 * trusted machine, never in CI.
 */
import { createClient } from "@supabase/supabase-js";
import { syncAccount } from "./build/_sync.js";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1]?.startsWith("--") === false ? arr[i + 1] : true]] : []
  )
);

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !key) { console.error("Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
if (!process.env.TOKEN_ENC_KEY) { console.error("Set TOKEN_ENC_KEY — stored tokens are encrypted."); process.exit(2); }

const db = createClient(url, key, { db: { schema: "pulseboard" }, auth: { persistSession: false } });

const { data: accounts, error } = await db
  .from("social_accounts")
  .select("id,platform,external_id,username,last_synced_at,tz_offset_minutes,auth_mode,status")
  .eq("status", "connected");
if (error) { console.error(error.message); process.exit(1); }

if (args.list || !args.account) {
  console.log("\nConnected accounts:\n");
  for (const a of accounts ?? []) console.log(`  ${a.id}  ${a.platform}  @${a.username}`);
  console.log(`\nThen: node verify/sync-local.mjs --account <id> --runs 4\n`);
  process.exit(0);
}

const acc = (accounts ?? []).find((a) => a.id === args.account);
if (!acc) { console.error("No connected account with that id."); process.exit(1); }

/*
 * DAY_BUDGET bounds each run, so a full window needs several. Running them in a
 * loop here is the same thing the operator does by clicking Sync repeatedly,
 * without the fifteen-minute interval in between.
 */
const runs = Math.max(1, Number(args.runs ?? 4));
console.log(`\nSyncing @${acc.username} — ${runs} run(s), each bounded by DAY_BUDGET\n`);

for (let i = 1; i <= runs; i++) {
  const t0 = Date.now();
  try {
    const res = await syncAccount(db, acc);
    console.log(`  run ${i}: ${res.rowsWritten} row(s), ${res.calls} call(s), ${Date.now() - t0}ms`);
    if (res.rowsWritten === 0) { console.log("  nothing further to fetch — window complete"); break; }
  } catch (e) {
    console.error(`  run ${i} FAILED: ${e instanceof Error ? e.message : e}`);
    break;
  }
}

const { data: rows } = await db
  .from("metrics_daily").select("date").eq("account_id", acc.id).order("date");
console.log(`\nStored: ${rows?.length ?? 0} day(s)  ${rows?.[0]?.date ?? "-"} .. ${rows?.[rows.length - 1]?.date ?? "-"}`);
console.log(`Next:   node verify/reconcile.mjs --account ${acc.id} --days 30\n`);
