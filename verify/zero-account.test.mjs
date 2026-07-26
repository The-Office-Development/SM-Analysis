/**
 * ADVERSARIAL harness for the ZERO-CONTENT Instagram account.
 *
 * Runs the REAL, UNMODIFIED syncAccount() from netlify/functions/_sync.ts
 * (compiled to verify/build/_sync.js) against a mocked Graph API, then feeds
 * the resulting metrics_daily rows through the REAL, UNMODIFIED frontend math
 * from src/lib/api.ts + src/lib/analytics.ts (compiled to verify/build-ui/)
 * and prints exactly what Overview.tsx would render.
 *
 *   node verify/zero-account.test.mjs Z1   # every insights call errors
 *   node verify/zero-account.test.mjs Z2   # profile omits followers_count
 *   node verify/zero-account.test.mjs Z3   # gross follower_count deltas > total
 *   node verify/zero-account.test.mjs Z4   # posts exist, interactions metric errors
 *   node verify/zero-account.test.mjs Z5   # insight end_time on the `until` boundary
 */
import { syncAccount } from "./build/_sync.js";
import { makeFakeDb } from "./fake-db.mjs";
import {
  seriesByDay, followersByDay, sum, latest, momentum, stockDelta, engagementRate,
} from "./build-ui/api.js";
import { anomalies, periodCompare, bestTimes, summarizeForAI } from "./build-ui/analytics.js";
import { compact, pct, pctPlain, ratioPct } from "./build-ui/format.js";

const KEY = (process.argv[2] ?? "Z1").toUpperCase();
const NAMES = {
  Z1: "every insights call errors; /media empty; 12 followers, 0 posts  [THE USER]",
  Z2: "same as Z1 but the profile response omits followers_count",
  Z3: "follower_count returns GROSS new-follow deltas summing above the current total",
  Z4: "user posts 3 reels; total_interactions + reach still permission-gated",
  Z5: "reach/impressions succeed but end_time lands on the `until` boundary date",
};

const ACC = { id: "acc-1", platform: "instagram", external_id: "17841400000000000", username: "noor_nono113" };
const TOKEN = "EAAG_mock_page_token_xxx";
const iso = (d) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/* ---- realistic Meta error envelopes for a brand-new, tiny IG business acct ---- */
const ERR_METRIC = { error: { message: "(#100) The value must be a valid insights metric", type: "OAuthException", code: 100, fbtrace_id: "Ax9mock" } };
const ERR_PERM = { error: { message: "(#10) Application does not have permission for this action", type: "OAuthException", code: 10, fbtrace_id: "Bx7mock" } };
const ERR_DATA = { error: { message: "Not enough data available for this metric. The account must have at least 100 followers.", type: "OAuthException", code: 10, error_subcode: 2108006, fbtrace_id: "Cx3mock" } };

const requests = [];
function installMock(scenario) {
  const now = todayIso();
  const start = addDays(now, -29);
  globalThis.fetch = async (url) => {
    const u = String(url);
    requests.push(u.replace(TOKEN, "<TOKEN>"));
    const body = route(u, scenario, start, now);
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  return { start, now };
}

function route(u, s, start, now) {
  const has = (x) => u.includes(x);

  // 1. profile
  if (has("fields=followers_count,media_count")) {
    if (s === "Z2") return { media_count: 0, id: ACC.external_id };
    if (s === "Z4") return { followers_count: 47, media_count: 3, id: ACC.external_id };
    return { followers_count: 12, media_count: 0, id: ACC.external_id };
  }

  // 2. reach,impressions (day)
  if (has("metric=reach,impressions")) {
    if (s === "Z4") {
      // Meta gates account-level reach on new accounts too, but let ONE day through
      // to model the moment it starts working -> non-zero denominator for ER.
      return { data: [{ name: "reach", period: "day", values: [{ value: 40, end_time: `${now}T07:00:00+0000` }] }] };
    }
    if (s === "Z5") {
      // Every value's end_time carries the `until` boundary date (now+1).
      const vals = [];
      for (let i = 0; i < 30; i++) vals.push({ value: 3, end_time: `${addDays(start, i + 1)}T07:00:00+0000` });
      return { data: [
        { name: "reach", period: "day", values: vals },
        { name: "impressions", period: "day", values: vals.map((v) => ({ ...v, value: 5 })) },
      ] };
    }
    return ERR_METRIC;
  }

  // 3. total_interactions (day)
  if (has("metric=total_interactions")) return ERR_METRIC;

  // 4. follower_count (day)
  if (has("metric=follower_count")) {
    if (s === "Z3") {
      // GROSS new-follow counts: 20 follows arrived, 8 later unfollowed, so the
      // profile shows 12 while the deltas sum to 20.
      const vals = [];
      const gains = [3, 5, 4, 2, 6]; // 20 total, on the last 5 days
      for (let i = 0; i < 5; i++) vals.push({ value: gains[i], end_time: `${addDays(now, -4 + i)}T07:00:00+0000` });
      return { data: [{ name: "follower_count", period: "day", values: vals }] };
    }
    return ERR_METRIC;
  }

  // 5. media
  if (has("/media?fields=")) {
    if (s === "Z4") {
      return { data: [0, 1, 2].map((i) => ({
        id: `1790000000000000${i}`,
        caption: `reel ${i}`,
        media_type: "VIDEO",
        permalink: `https://www.instagram.com/reel/Cx${i}/`,
        timestamp: `${addDays(now, -2 - i)}T09:00:00+0000`,
        like_count: [180, 140, 90][i],
        comments_count: [22, 16, 9][i],
        insights: { data: [{ name: "saved", values: [{ value: [31, 20, 12][i] }] }, { name: "shares", values: [{ value: [14, 9, 5][i] }] }] },
      })) };
    }
    return { data: [] };
  }

  // 6-8. follower_demographics
  if (has("metric=follower_demographics")) return has("breakdown=country") ? ERR_PERM : ERR_DATA;

  // 9. online_followers
  if (has("metric=online_followers")) return ERR_PERM;

  return { error: { message: `unrouted: ${u}`, code: 1 } };
}

/* ------------------------------- run ------------------------------------- */
const line = (c = "=") => console.log(c.repeat(80));
line();
console.log(`SCENARIO ${KEY} — ${NAMES[KEY]}`);
console.log(`clock (UTC): ${new Date().toISOString()}    today() => ${todayIso()}`);
line();

const { start, now } = installMock(KEY);
const db = makeFakeDb({
  log: () => {},
  seed: {
    account_secrets: [{ access_token: TOKEN, extra: { page_id: "1112223334445556" } }],
    metrics_daily: [], // no prior rows -> full 30-day backfill
  },
});

let threw = null;
const t0 = Date.now();
try { await syncAccount(db, ACC); } catch (e) { threw = e; }
console.log(`syncAccount(): ${threw ? `THREW -> ${threw.message}` : "completed WITHOUT throwing"}  (${Date.now() - t0} ms)`);
console.log(`graph requests issued: ${requests.length}`);
line("-");

const upserts = db._writes.filter((w) => w.op === "upsert");
for (const w of upserts) console.log(`WRITE ${w.table}.upsert  rows=${w.rows.length}  onConflict=${w.opts?.onConflict}`);
const updates = db._writes.filter((w) => w.op === "update");
for (const w of updates) console.log(`WRITE ${w.table}.update ${JSON.stringify(w.rows[0])}`);
if (!upserts.some((w) => w.table === "audience_snapshots")) console.log("WRITE audience_snapshots: NONE (hasAudience() was false)");
if (!upserts.some((w) => w.table === "content")) console.log("WRITE content: NONE (posts array was empty)");
line("-");

const metricRows = upserts.find((w) => w.table === "metrics_daily")?.rows ?? [];
console.log(`metrics_daily rows written: ${metricRows.length}`);
if (metricRows.length) {
  const show = [0, 1, Math.floor(metricRows.length / 2), metricRows.length - 2, metricRows.length - 1];
  for (const i of [...new Set(show)]) if (metricRows[i]) console.log(`  [${String(i).padStart(2)}] ${JSON.stringify(metricRows[i])}`);
  const cols = ["followers", "reach", "impressions", "views", "engagements"];
  console.log("  column summary:");
  for (const c of cols) {
    const vs = metricRows.map((r) => r[c]);
    console.log(`    ${c.padEnd(12)} min=${Math.min(...vs)} max=${Math.max(...vs)} sum=${vs.reduce((a, b) => a + b, 0)} distinct=${new Set(vs).size}` +
      `${vs.some((v) => v < 0) ? "   <<< NEGATIVE" : ""}${vs.some((v) => Number.isNaN(v)) ? "   <<< NaN" : ""}`);
  }
  const missing = [];
  for (let d = start; d <= now; d = addDays(d, 1)) if (!metricRows.some((r) => r.date === d)) missing.push(d);
  if (missing.length) console.log(`  dates in the window with NO row: ${missing.join(", ")}`);
}
line("-");

/* ---- feed the persisted rows through the REAL frontend math -------------- */
const metrics = metricRows.map((r) => ({
  account_id: r.account_id, platform: r.platform, date: r.date,
  followers: r.followers, reach: r.reach, impressions: r.impressions,
  views: r.views, engagements: r.engagements,
}));
const contentRows = (upserts.find((w) => w.table === "content")?.rows ?? []).map((r, i) => ({ id: `c${i}`, ...r }));
const audienceRows = (upserts.find((w) => w.table === "audience_snapshots")?.rows ?? []);
const scope = "all";
const connected = ["instagram"];

// DashboardContext.tsx:76
const hasData = metrics.length > 0 && connected.some((p) => metrics.some((m) => m.platform === p));
console.log(`DashboardContext hasData -> ${hasData}   => Overview renders ${hasData ? "THE FULL DASHBOARD" : "the <NoData> empty state"}`);
line("-");

const follSeries = followersByDay(metrics, scope);
const reachSeries = seriesByDay(metrics, scope, "reach");
const viewSeries = seriesByDay(metrics, scope, "views");
const engSeries = seriesByDay(metrics, scope, "engagements");
const reachTotal = sum(reachSeries);
const impressionsTotal = sum(seriesByDay(metrics, scope, "impressions"));
const engTotal = sum(engSeries);
const er = engagementRate(metrics, scope);

console.log("Overview.tsx KPI row, exactly as rendered:");
console.log(`  Followers          value="${compact(latest(follSeries))}"   delta="${pct(stockDelta(follSeries))}"`);
console.log(`  Reach              value="${compact(reachTotal)}"   delta="${pct(momentum(reachSeries))}"`);
console.log(`  Video views        value="${compact(sum(viewSeries))}"   delta="${pct(momentum(viewSeries))}"`);
console.log(`  Engagement rate    value="${pctPlain(er)}"   delta="${pct(momentum(engSeries))}"    (raw er = ${er})`);

const deep = contentRows.reduce((s, c) => s + c.shares + c.saves, 0);
const funnel = [
  { k: "Impressions", v: impressionsTotal }, { k: "Accounts reached", v: reachTotal },
  { k: "Engagements", v: engTotal }, { k: "Shares & saves", v: deep },
];
console.log("Overview.tsx funnel:");
// Mirrors Overview.tsx:94, which now routes through the shared ratioPct() guard.
funnel.forEach((f, i) => console.log(`  ${f.k.padEnd(18)} ${f.v}   sub="${i ? `${ratioPct(f.v, funnel[i - 1].v).toFixed(1)}% of previous` : "top of funnel"}"`));

// Overview.tsx buildInsights()
console.log("Overview.tsx Insights panel copy:");
const byEr = connected.map((p) => ({ p, er: engagementRate(metrics, p) })).sort((a, b) => b.er - a.er);
if (byEr[0]) console.log(`  * "Instagram leads on engagement" / "Converting reach at ${byEr[0].er.toFixed(1)}%. Lean into the formats working there."`);
const aud = audienceRows.find((a) => connected.includes(a.platform));
if (aud?.active_hours?.length) console.log(`  * "Post around your peak window" (audience snapshot present)`);
const reachMom = momentum(seriesByDay(metrics, scope, "reach"));
console.log(reachMom < 0
  ? `  * "Reach cooled this period" / "Down ${Math.abs(reachMom).toFixed(1)}% vs the prior window."`
  : `  * "Momentum is building" / "Reach is up ${reachMom.toFixed(1)}% period over period. Keep your cadence steady."`);

console.log("Sparkline inputs (min/max decide whether the spark is flat):");
for (const [n, s] of [["followers", follSeries], ["reach", reachSeries], ["views", viewSeries], ["engagements", engSeries]]) {
  const vs = s.map((x) => x.value);
  console.log(`  ${n.padEnd(12)} len=${vs.length} min=${Math.min(...vs)} max=${Math.max(...vs)} range=${Math.max(...vs) - Math.min(...vs)}${Math.max(...vs) === Math.min(...vs) ? "  -> Sparkline range fallback (||1), line pinned to the FLOOR" : ""}`);
}
// LineChart yMax (Overview "Audience growth")
{
  const vs = follSeries.map((x) => x.value);
  const m = Math.max(0, ...vs);
  console.log(`LineChart yMax for Audience growth = ${m} * 1.14 || 1 = ${m * 1.14 || 1}   (n=${vs.length})`);
}

console.log("Planner.tsx / analytics:");
console.log(`  anomalies() -> ${anomalies(metrics, scope).length} alerts`);
console.log(`  bestTimes() -> ${bestTimes(audienceRows, connected, 5).length} windows`);
console.log("  periodCompare() ->");
for (const c of periodCompare(metrics, scope)) console.log(`     ${c.label.padEnd(12)} current=${c.current} previous=${c.previous} deltaPct=${c.deltaPct}`);

console.log("Assistant.tsx grounded summary sent to the model:");
console.log(summarizeForAI({ range: 30, scope, connectedPlatforms: connected, metrics, content: contentRows, audience: audienceRows })
  .split("\n").map((l) => "  | " + l).join("\n"));

line("-");
const bad = [];
for (const r of metricRows) for (const k of Object.keys(r)) {
  const v = r[k];
  if (typeof v === "number") {
    if (Number.isNaN(v)) bad.push(`NaN metrics_daily[${r.date}].${k}`);
    if (!Number.isFinite(v)) bad.push(`non-finite metrics_daily[${r.date}].${k}`);
    if (v < 0) bad.push(`NEGATIVE ${v} metrics_daily[${r.date}].${k}`);
  }
}
for (const [n, v] of [["engagementRate", er], ["stockDelta(followers)", stockDelta(follSeries)], ["momentum(reach)", momentum(reachSeries)], ["momentum(views)", momentum(viewSeries)], ["momentum(eng)", momentum(engSeries)]]) {
  if (Number.isNaN(v)) bad.push(`NaN from ${n}`);
  if (!Number.isFinite(v)) bad.push(`non-finite from ${n}`);
}
console.log(bad.length ? `ANOMALIES (${bad.length}):\n  ` + bad.join("\n  ") : "ANOMALY SCAN: clean (no NaN / Infinity / negative)");
line();
console.log("Graph requests, in order:");
requests.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.replace("https://graph.facebook.com/v19.0", "")}`));
line();
