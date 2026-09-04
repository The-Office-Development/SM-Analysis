import { test } from "node:test";
import assert from "node:assert/strict";
import { discovery, churn, formatPerformance, reachDrivers } from "../build-lib/insights.js";

/**
 * These functions produce the numbers a client is shown and a sponsor is
 * quoted. A wrong one is not a rendering bug — it is a figure someone puts in a
 * media kit. So they are tested against an explicit oracle, and every test that
 * matters here is about what happens when the platform reported NOTHING.
 */

const day = (d, extra) => ({
  account_id: "a", platform: "instagram", date: `2026-08-${String(d).padStart(2, "0")}`,
  followers: 100, reach: 1000, impressions: null, views: 0, engagements: 0,
  provisional: false, ...extra,
});

/* ---- discovery ---------------------------------------------------------- */

test("discovery rate is the non-follower share of ATTRIBUTED reach", () => {
  const m = [
    day(1, { reach_followers: 300, reach_non_followers: 700 }),
    day(2, { reach_followers: 100, reach_non_followers: 900 }),
  ];
  const d = discovery(m, "all");
  assert.equal(d.followers, 400);
  assert.equal(d.nonFollowers, 1600);
  // 1600 / 2000, NOT 1600 / total reach — the UNKNOWN bucket is not a denominator.
  assert.equal(d.discoveryRate, 0.8);
});

test("discovery flags itself partial when reach exceeds the attributed halves", () => {
  // reach 1000, but only 900 attributed: Meta's UNKNOWN bucket holds the rest.
  const d = discovery([day(1, { reach: 1000, reach_followers: 400, reach_non_followers: 500 })], "all");
  assert.equal(d.partial, true, "a UI must be able to say the split is incomplete");
});

test("an unreported discovery split is null, never 0%", () => {
  const d = discovery([day(1), day(2)], "all");
  assert.equal(d.discoveryRate, null, "0% would claim nobody new saw the account");
  assert.equal(d.followers, null);
  assert.equal(d.partial, false);
});

test("provisional days are excluded from the sponsor-facing split", () => {
  const d = discovery([
    day(1, { reach_followers: 100, reach_non_followers: 100 }),
    day(2, { reach_followers: 999, reach_non_followers: 999, provisional: true }),
  ], "all");
  assert.equal(d.followers, 100, "a still-settling day must not inflate a quoted figure");
});

/* ---- churn -------------------------------------------------------------- */

test("churn exposes the losses a net figure hides", () => {
  const c = churn([
    day(1, { follows: 200, unfollows: 190 }),
    day(2, { follows: 212, unfollows: 202 }),
  ], "all");
  assert.equal(c.gained, 412);
  assert.equal(c.lost, 392);
  assert.equal(c.net, 20);
  // The point of the whole function: +20 looks fine, 0.95 does not.
  assert.ok(c.churnRate > 0.94 && c.churnRate < 0.96, `churn rate was ${c.churnRate}`);
});

test("churn is null when the platform reported neither direction", () => {
  const c = churn([day(1), day(2)], "all");
  assert.deepEqual(c, { gained: null, lost: null, net: null, churnRate: null });
});

/* ---- format performance ------------------------------------------------- */

const post = (id, type, reach, saves = 0, shares = 0) => ({
  id, account_id: "a", platform: "instagram", external_id: id, title: "",
  media_type: type, permalink: null, published_at: "2026-08-01T00:00:00Z",
  views: 0, likes: 0, comments: 0, shares, saves, reach,
  avg_watch_seconds: null, retention_pct: null,
});

test("formats rank on per-post median, not on totals", () => {
  // Feed wins on total reach purely by volume; Reels win per post.
  const rows = formatPerformance([
    post("r1", "Reel", 5000), post("r2", "Reel", 5000),
    ...Array.from({ length: 20 }, (_, i) => post(`f${i}`, "Photo", 1000)),
  ]);
  assert.equal(rows[0].format, "Reel", "totals would have ranked Photo first");
  assert.equal(rows[0].medianReach, 5000);
  assert.equal(rows[1].reach, 20000, "Photo still has the larger total");
});

test("one viral post does not redefine what a format does", () => {
  const rows = formatPerformance([
    post("a", "Reel", 100), post("b", "Reel", 100), post("c", "Reel", 1000000),
  ]);
  // A mean would report ~333,400 as typical for a Reel.
  assert.equal(rows[0].medianReach, 100);
});

test("save and share rates are null when reach was never reported", () => {
  const rows = formatPerformance([post("a", "Reel", 0, 5, 5)]);
  assert.equal(rows[0].saveRate, null, "a rate needs a denominator that exists");
});

/* ---- reach drivers ------------------------------------------------------ */

test("a reach change decomposes into volume and per-post effects that sum to it", () => {
  const prev = Array.from({ length: 10 }, (_, i) => post(`p${i}`, "Reel", 100));
  const curr = Array.from({ length: 5 }, (_, i) => post(`c${i}`, "Reel", 100));
  const drivers = reachDrivers(curr, prev, 500, 1000);
  const total = drivers.reduce((a, d) => a + d.effect, 0);
  assert.equal(total, -500, "the parts must account for the whole change");
  assert.equal(drivers[0].label, "How much you posted", "halving output is the dominant cause here");
});

test("reach drivers stay silent rather than explaining an unmeasurable change", () => {
  assert.deepEqual(reachDrivers([], [], 100, 200), []);
  assert.deepEqual(reachDrivers([post("a", "Reel", 1)], [], 100, 200), []);
  assert.deepEqual(reachDrivers([post("a", "Reel", 1)], [post("b", "Reel", 1)], 100, null), []);
});
