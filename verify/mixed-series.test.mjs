/**
 * Adjacent case to the "connected-but-empty" scenario: TWO connected accounts
 * where ONE of them has no metrics_daily rows yet (e.g. IG just connected and
 * has not synced, Facebook already has 30 days). Overview.tsx:30-33 and
 * Platforms.tsx:18-21 build one LineChart Series per connected platform, so
 * one series ends up shorter than another.
 *
 *   node verify/mixed-series.test.mjs
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seriesByDay, followersByDay } from "./build-fe/lib/api.js";
import LineChart from "./build-fe/components/charts/LineChart.js";

const day = (n) => {
  const d = new Date("2026-07-26T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const fbRows = Array.from({ length: 30 }, (_, i) => ({
  account_id: "acc-fb", platform: "facebook", date: day(29 - i),
  followers: 5000 + i, reach: 100, impressions: 200, views: 50, engagements: 10,
}));
// Instagram is connected but has ZERO metric rows.
const metrics = fbRows;
const connected = ["facebook", "instagram"];

function attempt(label, fn) {
  try {
    const html = fn();
    const hits = String(html).match(/NaN|Infinity/g);
    console.log(`  ${label}: ${hits ? `RENDERED WITH ${hits.length} NaN/Infinity token(s)  <-- BAD` : "rendered clean"}`);
  } catch (e) {
    console.log(`  ${label}: THROWS ${e.name}: ${e.message}   <-- CRASH`);
  }
}

console.log("Two connected platforms, one with zero metric rows");
for (const order of [["facebook", "instagram"], ["instagram", "facebook"]]) {
  const growth = order.map((p) => ({
    key: p, label: p, color: "#888", points: followersByDay(metrics, p),
  }));
  console.log(`\nplatform order ${JSON.stringify(order)} -> series point counts ${JSON.stringify(growth.map((g) => g.points.length))}`);
  console.log(`  n = series[0].points.length = ${growth[0].points.length}`);
  attempt("Overview <LineChart series={growth}> (followers)", () =>
    renderToStaticMarkup(createElement(LineChart, { series: growth, height: 264 })));
  const reach = order.map((p) => ({ key: p, label: p, color: "#888", points: seriesByDay(metrics, p, "reach") }));
  attempt("Platforms <LineChart series={comparison}> (reach)", () =>
    renderToStaticMarkup(createElement(LineChart, { series: reach, height: 260 })));
}
console.log(`\nNOTE: connectedPlatforms order comes from PLATFORM_ORDER in src/lib/platforms.tsx.`);
