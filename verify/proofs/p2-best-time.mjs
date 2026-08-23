/**
 * PROOF 2 — the Planner's "best time to post".
 * Runs the REAL syncAccount() (audienceInstagram -> bucketOnline) then the REAL
 * frontend bestTimes()/activeGrid() on the row it wrote.
 *
 * Ground truth we plant: the audience peaks on SATURDAY at 20:00 LOCAL.
 */
import { syncAccount } from "/home/user/SM-Analysis/verify/build/_sync.js";
import { makeFakeDb } from "/home/user/SM-Analysis/verify/fake-db.mjs";
import { bestTimes, activeGrid, DOW } from "/home/user/SM-Analysis/verify/build-fe/lib/analytics.js";

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (i, n) => { const d = new Date(i + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const TODAY = iso(new Date());
const DOWN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const localDow = (dayIso) => new Date(dayIso + "T12:00:00Z").getUTCDay();

const PEAK_DOW = 6;   // Saturday, in the account's own local calendar
const PEAK_HOUR = 20; // 8pm local

function endTimeFor(dayIso, off) {
  const t = Date.parse(addDays(dayIso, 1) + "T00:00:00Z") - off * 3600_000;
  return new Date(t).toISOString().replace(".000Z", "+0000");
}

function install({ off, nDays }) {
  const original = globalThis.fetch;
  const values = [];
  for (let k = nDays - 1; k >= 0; k--) {
    const day = addDays(TODAY, -k - 1);
    const map = {};
    for (let h = 0; h < 24; h++) {
      // baseline activity + a big Saturday-8pm-local peak
      map[String(h)] = 100 + (localDow(day) === PEAK_DOW && h === PEAK_HOUR ? 900 : 0);
    }
    values.push({ value: map, end_time: endTimeFor(day, off) });
  }
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    const m = u.searchParams.get("metric") ?? "";
    let body = { data: [] };
    if (!u.pathname.endsWith("/insights") && !u.pathname.endsWith("/media")) body = { followers_count: 10000, media_count: 0 };
    else if (m === "online_followers") body = { data: [{ name: "online_followers", period: "lifetime", values }] };
    return { ok: true, status: 200, json: async () => body };
  };
  return () => { globalThis.fetch = original; };
}

async function run(label, off, nDays) {
  const restore = install({ off, nDays });
  const db = makeFakeDb({ seed: { account_secrets: [{ access_token: "t", extra: {} }], metrics_daily: [] } });
  await syncAccount(db, { id: "acc-1", platform: "instagram", external_id: "1784100", username: "x" });
  restore();
  const snap = db._writes.filter((w) => w.table === "audience_snapshots").flatMap((w) => w.rows)[0];
  if (!snap) { console.log(`${label}: NO audience row written`); return; }
  const rows = [{ platform: "instagram", active_hours: snap.active_hours }];
  const top = bestTimes(rows, ["instagram"], 3);
  const grid = activeGrid(rows, ["instagram"]);
  const perDay = grid.map((r, d) => `${DOWN[d]}=${r.reduce((a, b) => a + b, 0)}`).join(" ");
  console.log(`\n### ${label}  (offset ${off >= 0 ? "+" : ""}${off}h, ${nDays} days of online_followers)`);
  console.log(`   truth planted : ${DOW[PEAK_DOW]} ${PEAK_HOUR}:00 local`);
  console.log(`   app advises   : ${top.map((t) => t.label).join(" | ")}`);
  console.log(`   weekday totals: ${perDay}`);
}

await run("PDT account (America/Los_Angeles)", -7, 28);
await run("PDT account, 30-day window (uneven weekday sample counts)", -7, 30);
await run("Tokyo account (JST)", +9, 28);
await run("London account (BST)", +1, 30);
