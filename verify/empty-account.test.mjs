/**
 * Scenario: ONE connected Instagram account.
 *   metrics_daily -> 30 rows, every flow metric 0, followers flat at 1284
 *   content       -> EMPTY
 *   audience_snapshots -> EMPTY
 *
 * Runs the REAL, UNMODIFIED src/lib + src/components code (compiled by tsc into
 * verify/build-fe, only lib/supabase.js stubbed) and prints every derived value
 * a page would show, flagging NaN / Infinity / thrown errors.
 *
 *   node verify/empty-account.test.mjs
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  seriesByDay, followersByDay, sum, latest, momentum, stockDelta, engagementRate,
} from "./build-fe/lib/api.js";
import {
  activeGrid, bestTimes, anomalies, periodCompare, summarizeForAI,
} from "./build-fe/lib/analytics.js";
import { buildSnapshot } from "./build-fe/lib/snapshot.js";
import { buildCsv } from "./build-fe/lib/reports.js";
import { compact, pctPlain, pct, full, ratioPct } from "./build-fe/lib/format.js";
import LineChart from "./build-fe/components/charts/LineChart.js";
import Sparkline from "./build-fe/components/charts/Sparkline.js";
import BarList from "./build-fe/components/BarList.js";
import StatCard from "./build-fe/components/StatCard.js";
import Delta from "./build-fe/components/Delta.js";
import ReportSheet from "./build-fe/components/ReportSheet.js";

/* ------------------------------ fixture --------------------------------- */
const ACCOUNT_ID = "acc-ig-1";
const FOLLOWERS = 1284;

function isoDaysAgo(n) {
  const d = new Date("2026-07-26T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const metrics = Array.from({ length: 30 }, (_, i) => ({
  account_id: ACCOUNT_ID,
  platform: "instagram",
  date: isoDaysAgo(29 - i),
  followers: FOLLOWERS,   // flat stock
  reach: 0,
  impressions: 0,
  views: 0,
  engagements: 0,
}));

const accounts = [{
  id: ACCOUNT_ID, user_id: "u1", platform: "instagram", external_id: "17841400000000000",
  username: "brandnew.studio", display_name: "Brand New Studio", avatar_url: null,
  status: "connected", connected_at: "2026-07-01T00:00:00Z", last_synced_at: "2026-07-26T06:00:00Z",
}];

const dash = {
  range: 30, scope: "all", accounts, metrics,
  content: [],            // EMPTY
  audience: [],           // EMPTY
  connectedPlatforms: ["instagram"],
  hasData: metrics.length > 0 && metrics.some((m) => m.platform === "instagram"),
  loading: false, error: null, syncing: false,
  refresh: async () => {}, sync: async () => {},
};

/* ------------------------------ helpers --------------------------------- */
let bad = 0;
const BADRE = /NaN|Infinity|undefined|null%|-%/;
function show(label, produce) {
  let v, err = null;
  try { v = produce(); } catch (e) { err = e; }
  if (err) {
    bad++;
    console.log(`  !! THROWS  ${label}\n              ${err.name}: ${err.message}`);
    return undefined;
  }
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const flag = BADRE.test(String(s)) ? "  <-- BAD" : "";
  if (flag) bad++;
  console.log(`     ${label.padEnd(46)} ${s}${flag}`);
  return v;
}
function head(t) { console.log(`\n=== ${t} ${"=".repeat(Math.max(0, 60 - t.length))}`); }
function markup(label, el) {
  let html;
  try { html = renderToStaticMarkup(el); } catch (e) {
    bad++; console.log(`  !! THROWS  ${label}\n              ${e.name}: ${e.message}`); return "";
  }
  const hits = html.match(/NaN|Infinity/g);
  if (hits) { bad++; console.log(`  !! ${label}: ${hits.length} NaN/Infinity token(s) in rendered SVG/HTML  <-- BAD`); }
  else console.log(`     ${label.padEnd(46)} rendered clean (${html.length} chars, no NaN/Infinity)`);
  return html;
}

console.log("PulseBoard — connected-but-empty Instagram account");
console.log(`fixture: 1 IG account · ${metrics.length} metric rows (all flow metrics 0, followers ${FOLLOWERS} flat) · 0 content · 0 audience`);
console.log(`DashboardContext.hasData -> ${dash.hasData}  (so RequireData renders the page, not an empty state)`);

/* ------------------------- 1. Overview KPI cards ------------------------- */
head("1. Overview KPI cards (src/pages/Overview.tsx:59-62)");
const follSeries = followersByDay(metrics, "all");
const reachSeries = seriesByDay(metrics, "all", "reach");
const viewSeries = seriesByDay(metrics, "all", "views");
const engSeries = seriesByDay(metrics, "all", "engagements");
console.log(`     series lengths: foll=${follSeries.length} reach=${reachSeries.length} views=${viewSeries.length} eng=${engSeries.length}`);
show("Followers  value  compact(latest(foll))", () => compact(latest(follSeries)));
show("Followers  delta  stockDelta(foll)", () => pct(stockDelta(follSeries)));
show("Reach      value  compact(sum(reach))", () => compact(sum(reachSeries)));
show("Reach      delta  momentum(reach)", () => pct(momentum(reachSeries)));
show("Views      value  compact(sum(views))", () => compact(sum(viewSeries)));
show("Views      delta  momentum(views)", () => pct(momentum(viewSeries)));
show("Eng.rate   value  pctPlain(engagementRate)", () => pctPlain(engagementRate(metrics, "all")));
show("Eng.rate   delta  momentum(eng)", () => pct(momentum(engSeries)));
markup("<StatCard> Reach (real component)", createElement(StatCard, {
  label: "Reach", value: compact(sum(reachSeries)), delta: momentum(reachSeries),
  spark: reachSeries.map((d) => d.value), color: "var(--fb)",
}));
markup("<Delta value={0}>", createElement(Delta, { value: 0 }));

head("1b. Overview funnel + share-of-reach (Overview.tsx:41-54, 92-105)");
const impressions = sum(seriesByDay(metrics, "all", "impressions"));
const funnel = [
  { k: "Impressions", v: impressions },
  { k: "Accounts reached", v: sum(reachSeries) },
  { k: "Engagements", v: sum(engSeries) },
  { k: "Shares & saves", v: dash.content.reduce((s, c) => s + c.shares + c.saves, 0) },
];
const fMax = Math.max(...funnel.map((f) => f.v), 1);
show("fMax = Math.max(...values, 1)", () => fMax);
funnel.forEach((f, i) => {
  show(`bar width  ${f.k}`, () => `${(f.v / fMax) * 100}%`);
  show(`caption    ${f.k}`, () => (i ? `${((f.v / funnel[i - 1].v) * 100 || 0).toFixed(1)}% of previous` : "top of funnel"));
});
const shareRows = dash.connectedPlatforms.map((p) => ({ key: p, label: p, value: sum(seriesByDay(metrics, p, "reach")) }));
const shareTotal = shareRows.reduce((s, r) => s + r.value, 0) || 1;
show("shareTotal (|| 1 guard)", () => shareTotal);
show("share display", () => `${((shareRows[0].value / shareTotal) * 100).toFixed(0)}%`);
markup("<BarList> share of reach", createElement(BarList, {
  keyWidth: 92,
  rows: shareRows.map((r) => ({ ...r, display: `${((r.value / shareTotal) * 100).toFixed(0)}%`, color: "var(--ig)" })),
}));

head("1c. Overview insight strings (Overview.tsx:137-165)");
const byEr = dash.connectedPlatforms.map((p) => ({ p, er: engagementRate(metrics, p) })).sort((a, b) => b.er - a.er);
show("insight 1 body", () => `Converting reach at ${byEr[0].er.toFixed(1)}%.`);
const reachMom = momentum(seriesByDay(metrics, "all", "reach"));
show("insight 3 (reachMom<0 ? cooled : building)", () => (reachMom < 0
  ? `Down ${Math.abs(reachMom).toFixed(1)}% vs the prior window.`
  : `Reach is up ${reachMom.toFixed(1)}% period over period.`));

/* ---------------------------- 2. chart axes ----------------------------- */
head("2. Chart axis math (LineChart.tsx:29-38, Sparkline.tsx:11-13)");
const zeroPts = reachSeries;                 // 30 points, all value 0
const flatPts = follSeries;                  // 30 points, all value 1284
for (const [name, pts] of [["all-zero reach", zeroPts], ["flat followers", flatPts]]) {
  let m = 0; for (const p of pts) m = Math.max(m, p.value);
  const yMax = m * 1.14 || 1;
  const height = 264, padT = 10, padB = 24;
  show(`LineChart yMax (${name})`, () => yMax);
  show(`LineChart Y(first point) (${name})`, () => padT + (height - padT - padB) * (1 - pts[0].value / yMax));
  show(`LineChart y-tick labels (${name})`, () => Array.from({ length: 5 }, (_, t) => compact((yMax * t) / 4)).join(" | "));
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  show(`Sparkline range=max-min||1 (${name})`, () => `min=${min} max=${max} range=${range}`);
  show(`Sparkline Y(v0) (${name})`, () => 2 + (26 - 4) * (1 - (vals[0] - min) / range));
}
markup("<LineChart> all-zero reach series", createElement(LineChart, {
  series: [{ key: "instagram", label: "Instagram", color: "#E1306C", points: zeroPts }], height: 264,
}));
markup("<LineChart> flat followers series", createElement(LineChart, {
  series: [{ key: "instagram", label: "Instagram", color: "#E1306C", points: flatPts }], height: 264,
}));
markup("<Sparkline> all-zero", createElement(Sparkline, { values: zeroPts.map((p) => p.value) }));
markup("<Sparkline> flat", createElement(Sparkline, { values: flatPts.map((p) => p.value) }));
markup("<LineChart> EMPTY series array (n===0 path)", createElement(LineChart, { series: [], height: 200 }));
markup("<Sparkline> single value (len<2 path)", createElement(Sparkline, { values: [0] }));

/* ------------------------------ 3. Content ------------------------------ */
head("3. Content page (src/pages/Content.tsx:32-42)");
const items = dash.content.filter((c) => dash.connectedPlatforms.includes(c.platform));
show("items.length", () => items.length);
show("KPI Posts synced", () => compact(items.length));
show("KPI Total views", () => compact(items.reduce((s, c) => s + c.views, 0)));
show("KPI Total engagements", () => compact(items.reduce((s, c) => s + c.likes + c.comments + c.shares + c.saves, 0)));
show("KPI Avg engagement rate", () => {
  const avgEr = items.length ? (items.reduce((s, c) => s + (c.reach ? (c.likes + c.comments + c.shares + c.saves) / c.reach : 0), 0) / items.length) * 100 : 0;
  return pctPlain(avgEr);
});
show("sorted rows rendered in <tbody>", () => [...items].sort((a, b) => -1 * (a.views - b.views)).length);
show("panel subtitle", () => `${items.length} posts · click a column to sort`);
console.log("     NOTE: Content.tsx tbody (l.74-96) has NO empty-state <tr>; Overview's table does (l.126).");

/* ------------------------------ 4. Audience ----------------------------- */
head("4. Audience page (src/pages/Audience.tsx:20-35)");
const parts = dash.connectedPlatforms.map((p) => {
  const snap = dash.audience.find((a) => a.platform === p);
  const foll = followersByDay(dash.metrics, p);
  const weight = foll[foll.length - 1]?.value ?? 0;
  return snap ? { snap, weight: weight || 1 } : null;
}).filter((x) => x !== null);
show("parts.length (0 => early-return empty state)", () => parts.length);
show("early return taken?", () => (parts.length === 0 ? "YES - renders the 'No audience snapshot has synced yet' panel" : "no"));

/* ------------------------------ 5. Planner ------------------------------ */
head("5. Planner (src/pages/Planner.tsx:32-35, analytics.ts:15-72)");
const grid = show("activeGrid dims", () => {
  const g = activeGrid(dash.audience, dash.connectedPlatforms);
  return `${g.length}x${g[0].length}, all cells 0 = ${g.flat().every((v) => v === 0)}`;
});
const gridMax = Math.max(...activeGrid(dash.audience, dash.connectedPlatforms).flat(), 0);
show("gridMax = Math.max(...grid.flat(), 0)", () => gridMax);
show("heatmap branch", () => (gridMax > 0 ? "heat grid" : "muted 'No audience-activity data yet' copy"));
show("bestTimes(...).length", () => bestTimes(dash.audience, dash.connectedPlatforms, 5).length);
show("Math.max(...grid.flat()) inside bestTimes", () => Math.max(...activeGrid(dash.audience, dash.connectedPlatforms).flat()));
show("anomalies(...).length", () => anomalies(dash.metrics, dash.scope).length);
show("anomalies with EMPTY metrics []", () => anomalies([], "all").length);
show("periodCompare(...)", () => periodCompare(dash.metrics, dash.scope).map((c) => `${c.label}:cur=${c.current},prev=${c.previous},d=${c.deltaPct}`).join(" | "));
show("periodCompare with EMPTY metrics []", () => periodCompare([], "all").map((c) => `${c.label}:${c.deltaPct}`).join(" | "));
show("bestTimes with EMPTY platforms []", () => bestTimes([], [], 5).length);
show("goal progress pct (cur=0,target=1000)", () => `${Math.min(100, (0 / 1000) * 100).toFixed(0)}%`);
show("goal progress pct (cur=0,target=0 - DB-only edge)", () => `${Math.min(100, ratioPct(0, 0)).toFixed(0)}%`);

/* --------------------------- 6. Reports / CSV --------------------------- */
head("6. Reports + CSV export (src/lib/snapshot.ts, src/lib/reports.ts)");
const snap = show("buildSnapshot -> headline", () => buildSnapshot(dash).headline.map((h) => `${h.label}:${h.total}/${h.deltaPct}`).join(" | "));
const full_ = buildSnapshot(dash);
show("buildSnapshot -> engagementRate.toFixed(1)", () => `${full_.engagementRate.toFixed(1)}%`);
show("buildSnapshot -> platforms", () => JSON.stringify(full_.platforms));
show("buildSnapshot -> top/windows/alerts lengths", () => `top=${full_.top.length} windows=${full_.windows.length} alerts=${full_.alerts.length}`);
markup("<ReportSheet> (real component)", createElement(ReportSheet, { snap: full_ }));
const csv = show("buildCsv -> line count", () => buildCsv(dash).split("\n").length);
console.log("     ---- CSV verbatim ----");
console.log(buildCsv(dash).split("\n").map((l) => `     | ${l}`).join("\n"));
console.log("     ----------------------");
show("CSV last line is the content header (no data rows)", () => JSON.stringify(buildCsv(dash).split("\n").pop()));

/* ------------------------------ 7. AI text ------------------------------ */
head("7. summarizeForAI (analytics.ts:114) — used by Assistant.tsx:39");
const s = show("summary length", () => summarizeForAI({
  range: dash.range, scope: dash.scope, connectedPlatforms: dash.connectedPlatforms,
  metrics: dash.metrics, content: dash.content, audience: dash.audience,
}).length);
console.log(summarizeForAI({
  range: dash.range, scope: dash.scope, connectedPlatforms: dash.connectedPlatforms,
  metrics: dash.metrics, content: dash.content, audience: dash.audience,
}).split("\n").map((l) => `     | ${l}`).join("\n"));

/* ---------------------- 8. harsher: zero metric rows -------------------- */
head("8. Control: ZERO metric rows (hasData=false -> gated, but functions probed anyway)");
show("followersByDay([]) -> latest", () => latest(followersByDay([], "all")));
show("stockDelta([])", () => stockDelta(followersByDay([], "all")));
show("momentum([])", () => momentum(seriesByDay([], "all", "reach")));
show("engagementRate([])", () => engagementRate([], "all"));
show("sum([])", () => sum([]));
show("compact(0) / full(0) / pctPlain(0)", () => `${compact(0)} / ${full(0)} / ${pctPlain(0)}`);
show("buildCsv with no accounts+no rows", () => buildCsv({ ...dash, metrics: [], connectedPlatforms: [], content: [] }).split("\n").length);
show("buildSnapshot with no accounts+no rows", () => JSON.stringify(buildSnapshot({ ...dash, metrics: [], connectedPlatforms: [], content: [] }).headline));

console.log(`\nRESULT: ${bad === 0 ? "PASS — no NaN / Infinity / thrown error in any probed expression" : `FAIL — ${bad} problem(s) flagged above`}`);
