/**
 * Runs the REAL, UNMODIFIED syncAccount() from netlify/functions/_sync.ts
 * (compiled to verify/build/_sync.js) against a mocked Graph API + fake Db.
 *
 *   node verify/ig-sync.test.mjs A     # populated account
 *   node verify/ig-sync.test.mjs B     # the user's empty account
 *   node verify/ig-sync.test.mjs C     # reconstructFollowers probe
 */
import { syncAccount } from "./build/_sync.js";
import { installMockGraph, todayIso } from "./mock-graph.mjs";
import { makeFakeDb } from "./fake-db.mjs";

const key = (process.argv[2] ?? "A").toUpperCase();
// optional: --latest=YYYY-MM-DD seeds an existing metrics_daily row to exercise gap-fill
const latestArg = (process.argv.find((a) => a.startsWith("--latest=")) ?? "").split("=")[1] || null;
const NAMES = {
  A: "populated",
  B: "empty (user's actual case)",
  C: "reconstructFollowers probe",
  D: "Meta rejects the profile call (policy-blocked account)",
};

const ACC = {
  id: "acc-1",
  platform: "instagram",
  external_id: "17841400000000000",
  username: "noor_nono113",
};

const line = (c = "=") => console.log(c.repeat(78));
const bad = [];
function scan(where, obj) {
  const walk = (v, p) => {
    if (typeof v === "number") {
      if (Number.isNaN(v)) bad.push(`NaN at ${where}${p}`);
      else if (!Number.isFinite(v)) bad.push(`Infinity at ${where}${p}`);
      else if (v < 0 && /followers|reach|impressions|views|engagements|likes|comments|shares|saves/.test(p)) bad.push(`NEGATIVE ${v} at ${where}${p}`);
    } else if (v === undefined) bad.push(`undefined at ${where}${p}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
  };
  walk(obj, "");
}

line();
console.log(`SCENARIO ${key} — ${NAMES[key]}`);
console.log(`process date (UTC): ${new Date().toISOString()}   today() => ${todayIso()}`);
line();

const mock = installMockGraph(key);
console.log(`backfill window the mock generated data for: ${mock.window.start} .. ${mock.window.end}`);
console.log(`mock profile: ${JSON.stringify(mock.fixtures.profile)}`);
line("-");

const db = makeFakeDb({
  log: (s) => console.log(s),
  seed: {
    // account_secrets.select("access_token,extra").eq(...).single()
    account_secrets: [{ access_token: "EAAG_mock_page_token_xxx", extra: { page_id: "1112223334445556" } }],
    // metrics_daily.select("date")...maybeSingle() -> no prior rows => full 30d backfill
    metrics_daily: latestArg ? [{ date: latestArg }] : [],
  },
});

console.log("--- calling syncAccount(db, acc) ---");
let threw = null;
const t0 = Date.now();
try {
  await syncAccount(db, ACC);
} catch (e) {
  threw = e;
}
const ms = Date.now() - t0;
line("-");
console.log(`syncAccount returned after ${ms}ms. THREW: ${threw ? `YES -> ${threw && threw.stack ? threw.stack : threw}` : "NO"}`);

/* ------------------------------ report ---------------------------------- */
line();
console.log("GRAPH API URLS REQUESTED (in order):");
mock.calls.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. [${c.label}] ${c.method} ${c.url}`));
console.log(`  total requests: ${mock.calls.length}`);

line();
console.log("DB WRITES:");
const byTable = {};
for (const w of db._writes) {
  const k = `${w.table}.${w.op}`;
  byTable[k] = (byTable[k] ?? 0) + w.rows.length;
}
for (const [k, n] of Object.entries(byTable)) console.log(`  ${k}: ${n} row(s)`);
if (!db._writes.length) console.log("  (none)");

for (const t of ["metrics_daily", "content", "audience_snapshots", "social_accounts"]) {
  const ws = db._writes.filter((w) => w.table === t);
  const rows = ws.flatMap((w) => w.rows);
  line("-");
  console.log(`TABLE ${t}: ${ws.length} statement(s), ${rows.length} row(s) total`);
  if (!rows.length) { console.log("  NO ROWS WRITTEN"); continue; }
  console.log(`  onConflict: ${JSON.stringify(ws[0].opts)}`);
  scan(t, rows);
  if (t === "metrics_daily") {
    console.log("  first row : " + JSON.stringify(rows[0]));
    console.log("  middle row: " + JSON.stringify(rows[Math.floor(rows.length / 2)]));
    console.log("  last  row : " + JSON.stringify(rows[rows.length - 1]));
    console.log("  full followers series: " + JSON.stringify(rows.map((r) => [r.date, r.followers])));
    console.log("  full reach series    : " + JSON.stringify(rows.map((r) => [r.date, r.reach])));
    console.log("  full engagements     : " + JSON.stringify(rows.map((r) => [r.date, r.engagements])));
    const sums = rows.reduce((a, r) => ({ reach: a.reach + r.reach, impressions: a.impressions + r.impressions, views: a.views + r.views, engagements: a.engagements + r.engagements }), { reach: 0, impressions: 0, views: 0, engagements: 0 });
    console.log("  column sums: " + JSON.stringify(sums));
    console.log("  distinct dates: " + new Set(rows.map((r) => r.date)).size + `  (${rows[0].date} .. ${rows[rows.length - 1].date})`);
  } else if (t === "content") {
    console.log("  sample rows:");
    rows.slice(0, 3).forEach((r) => console.log("    " + JSON.stringify(r)));
    console.log("  all media_type/views/reach: " + JSON.stringify(rows.map((r) => [r.external_id, r.media_type, r.views, r.reach])));
  } else if (t === "audience_snapshots") {
    const r = rows[0];
    console.log("  age      : " + JSON.stringify(r.age));
    console.log("  gender   : " + JSON.stringify(r.gender));
    console.log("  countries: " + JSON.stringify(r.countries));
    console.log("  devices  : " + JSON.stringify(r.devices));
    console.log(`  active_hours: ${Array.isArray(r.active_hours) ? r.active_hours.length : "?"} x ${Array.isArray(r.active_hours?.[0]) ? r.active_hours[0].length : "?"}  sum=${(r.active_hours ?? []).flat().reduce((a, b) => a + b, 0)}`);
    console.log("  active_hours[0]: " + JSON.stringify(r.active_hours?.[0]));
    console.log("  keys: " + JSON.stringify(Object.keys(r)));
  } else {
    rows.forEach((r) => console.log("    " + JSON.stringify(r)));
    console.log("  filters: " + JSON.stringify(ws[0].filters));
  }
}

line();
console.log("ANOMALY SCAN (NaN / Infinity / undefined / negative counters):");
if (!bad.length) console.log("  none found");
else [...new Set(bad)].forEach((b) => console.log("  !! " + b));
line();
console.log(`RESULT scenario ${key}: threw=${threw ? "YES" : "NO"}  metrics_daily=${db._writes.filter(w=>w.table==="metrics_daily").flatMap(w=>w.rows).length}  content=${db._writes.filter(w=>w.table==="content").flatMap(w=>w.rows).length}  audience_snapshots=${db._writes.filter(w=>w.table==="audience_snapshots").flatMap(w=>w.rows).length}  anomalies=${new Set(bad).size}`);
line();
mock.restore();
