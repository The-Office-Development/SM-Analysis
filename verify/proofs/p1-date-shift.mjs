/**
 * PROOF 1 — timezone-dependent off-by-one day on every Meta daily metric.
 *
 * Runs the REAL syncAccount() from netlify/functions/_sync.ts against an IG mock
 * whose `end_time` follows Meta's documented convention (end_time = END of the
 * period = midnight local time of the FOLLOWING day, rendered in +0000).
 * The account timezone is a parameter.
 */
import { syncAccount } from "/home/user/SM-Analysis/verify/build/_sync.js";
import { makeFakeDb } from "/home/user/SM-Analysis/verify/fake-db.mjs";

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(isoDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const TODAY = iso(new Date());

/** true reach for calendar day D (deterministic, easy to eyeball) */
const TRUE_REACH = (dayIso) => 1000 + Number(dayIso.slice(8, 10)); // 1001..1031

/** end_time for calendar day D in an account whose UTC offset is `off` hours. */
function endTimeFor(dayIso, off) {
  // local midnight at the START of D+1  ==  D+1 00:00 local  ==  (D+1 00:00 - off h) UTC
  const t = Date.parse(addDays(dayIso, 1) + "T00:00:00Z") - off * 3600_000;
  return new Date(t).toISOString().replace(".000Z", "+0000");
}

function installMock({ off, start, end, followers = 10000 }) {
  const original = globalThis.fetch;
  const daily = (name, fn) => {
    const values = []; let d = start;
    while (d <= end) { values.push({ value: fn(d), end_time: endTimeFor(d, off) }); d = addDays(d, 1); }
    return { name, period: "day", values };
  };
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    const m = u.searchParams.get("metric") ?? "";
    let body;
    if (!u.pathname.endsWith("/insights") && !u.pathname.endsWith("/media")) body = { followers_count: followers, media_count: 3 };
    else if (m === "reach,impressions") body = { data: [daily("reach", TRUE_REACH), daily("impressions", (d) => 2 * TRUE_REACH(d))] };
    else if (m === "total_interactions") body = { data: [daily("total_interactions", () => 100)] };
    else if (m === "follower_count") body = { data: [daily("follower_count", () => 5)] };
    else if (u.pathname.endsWith("/media")) body = { data: [] };
    else body = { data: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  return () => { globalThis.fetch = original; };
}

async function run(label, off, latest = null) {
  const end = TODAY;
  const apiStart = addDays(end, -40); // API happily serves whatever we ask for
  const restore = installMock({ off, start: apiStart, end });
  const db = makeFakeDb({ seed: {
    account_secrets: [{ access_token: "t", extra: {} }],
    metrics_daily: latest ? [{ date: latest }] : [],
  }});
  await syncAccount(db, { id: "acc-1", platform: "instagram", external_id: "1784100", username: "x" });
  restore();
  const rows = db._writes.filter((w) => w.table === "metrics_daily").flatMap((w) => w.rows);
  const wrong = rows.filter((r) => r.reach !== TRUE_REACH(r.date));
  console.log(`\n### ${label}  (UTC offset ${off >= 0 ? "+" : ""}${off}h)  latest=${latest ?? "none"}`);
  console.log(`   rows written: ${rows.length}  (${rows[0]?.date} .. ${rows[rows.length - 1]?.date})`);
  console.log(`   rows whose stored reach != the platform's true value for that date: ${wrong.length}/${rows.length}`);
  for (const r of rows.slice(0, 3).concat(rows.slice(-2))) {
    const t = TRUE_REACH(r.date);
    const src = Object.entries({}).length;
    console.log(`     ${r.date}: stored reach=${String(r.reach).padStart(5)}  true=${t}  ${r.reach === t ? "ok" : `WRONG (this is ${r.reach === 0 ? "no data" : "the value for " + addDays(r.date, -1)})`}`);
  }
  const storedSum = rows.reduce((s, r) => s + r.reach, 0);
  const trueSum = rows.reduce((s, r) => s + TRUE_REACH(r.date), 0);
  console.log(`   window reach total: stored=${storedSum}  true=${trueSum}  error=${(storedSum - trueSum)} (${(((storedSum - trueSum) / trueSum) * 100).toFixed(2)}%)`);
  return rows;
}

console.log(`today (UTC) = ${TODAY}`);
await run("Los Angeles page (America/Los_Angeles, PDT)", -7);
await run("New York page (America/New_York, EDT)", -4);
await run("UTC page (Europe/London in winter / Accra)", 0);
await run("London page in summer (BST)", +1);
await run("Tokyo page (JST)", +9);

console.log("\n--- incremental (daily cron) sync on a PDT account, one prior row ---");
await run("PDT, incremental", -7, addDays(TODAY, -1));
