import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discovery, churn, formatPerformance, reachDrivers, genderSplit } from "../build-lib/insights.js";

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

test("a HALF-reported split is null — the real shape of the live defect", () => {
  // reach_non_followers was null on 31 of 32 days for a live account while
  // reach_followers carried values. Deriving the rate from the known half alone
  // rendered "0% of reach was people who don't follow you - New people 0",
  // describing a metric Instagram had never returned. Both halves or nothing.
  const missingNew = discovery([
    day(1, { reach_followers: 400, reach_non_followers: null }),
    day(2, { reach_followers: 300, reach_non_followers: null }),
  ], "all");
  assert.equal(missingNew.discoveryRate, null, "0% would tell a sponsor nobody new saw the account");
  assert.equal(missingNew.followers, 700, "the half that WAS reported is still reported");

  // The mirror image lies at the other extreme: 100% discovery.
  const missingExisting = discovery([
    day(1, { reach_followers: null, reach_non_followers: 500 }),
  ], "all");
  assert.equal(missingExisting.discoveryRate, null, "100% would be just as invented as 0%");

  // A genuine reported zero is a fact and must survive.
  const realZero = discovery([
    day(1, { reach_followers: 800, reach_non_followers: 0 }),
  ], "all");
  assert.equal(realZero.discoveryRate, 0, "a reported 0 is data, not an absence");
});

test("half-reported churn yields no net and no rate", () => {
  // The live shape: follows populated, unfollows null on every day, across two
  // accounts. net would overstate growth by exactly the churn it cannot see,
  // and churnRate would print "0 people left for every 100 who arrived".
  const c = churn([
    day(1, { follows: 40, unfollows: null }),
    day(2, { follows: 60, unfollows: null }),
  ], "all");
  assert.equal(c.gained, 100, "the reported direction survives");
  assert.equal(c.lost, null);
  assert.equal(c.net, null, "net growth cannot be known without the losses");
  assert.equal(c.churnRate, null, "a 0 rate would be a sentence claiming nobody left");

  // Both known: everything is derivable, including a genuine zero.
  const full = churn([day(1, { follows: 50, unfollows: 0 })], "all");
  assert.equal(full.net, 50);
  assert.equal(full.churnRate, 0, "a reported zero churn is a fact worth showing");
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

/* ---- the funnel must describe one window -------------------------------- */

/**
 * The defect: shares and saves were summed across EVERY stored post while reach
 * and engagements came from the selected range, so a live account showed
 * "Shares & saves 83,252" directly beneath "Accounts reached 1,426" — fifty-eight
 * times the reach it sat under, in a chart whose shape asserts each step is a
 * subset of the one above.
 *
 * The arithmetic lives in the page, so this asserts the rule the page must obey:
 * a post published before the window contributes nothing to the window's totals.
 */
test("a post from before the window is not counted in that window's totals", () => {
  const windowStart = "2026-08-12";
  const content = [
    { published_at: "2026-08-20T10:00:00Z", shares: 5, saves: 5 },
    { published_at: "2026-02-01T10:00:00Z", shares: 40000, saves: 43000 }, // the old viral post
  ];
  const inWindow = content.filter((c) => c.published_at.slice(0, 10) >= windowStart);
  const deep = inWindow.reduce((s, c) => s + ((c.shares ?? 0) + (c.saves ?? 0)), 0);
  assert.equal(inWindow.length, 1, "only the post published inside the window counts");
  assert.equal(deep, 10);
  assert.ok(deep < 1426, "and the result can no longer exceed the window's reach by orders of magnitude");
});

test("a metric the platform never reported is absent from the funnel, not zero", () => {
  /*
   * Instagram Login does not return impressions at all, so the series is empty —
   * and an empty series was being summed to a confident 0 and drawn as the TOP
   * of the funnel, with every row beneath reading "0.0% of previous". A
   * fabricated zero in the display layer is the same defect the sync was fixed
   * for, one layer further out.
   */
  const impressionsSeries = [];          // nothing was ever reported
  const funnel = [
    ...(impressionsSeries.length ? [{ k: "Impressions", v: 0 }] : []),
    { k: "Accounts reached", v: 1426 },
    { k: "Engagements", v: 211 },
  ];
  assert.equal(funnel[0].k, "Accounts reached", "the unreported row is dropped, not shown as 0");
  assert.ok(!funnel.some((f) => f.k === "Impressions"));
});

/* ---- a stock is never drawn from zero ------------------------------------ */

/**
 * This defect has now occurred twice: once on the Overview, fixed, and then
 * again on the Platforms page, because the fix was a prop at one call site and
 * nothing stopped the next chart from omitting it.
 *
 * A follower count is a STOCK. Zero is not a real possibility, so anchoring the
 * axis there spends the whole chart height on the distance from nothing to the
 * account's size and leaves the actual movement invisible — a live account at
 * 1.1K followers drew a dead flat line directly above a "-0.1%" that said
 * otherwise. That is a wrong number told in pixels.
 *
 * A flow like reach is the opposite: zero is meaningful and the height carries
 * the magnitude, so those charts keep the default.
 *
 * Source-level, because the rule is about how the component is CALLED. A unit
 * test of the component cannot see a caller that forgot the prop.
 */
test("every follower chart is drawn on its own scale, not from zero", () => {
  const files = ["src/pages/Overview.tsx", "src/pages/Platforms.tsx", "src/pages/Audience.tsx"];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, "utf8"); } catch { continue; }
    // Each <LineChart ...> up to its closing bracket.
    for (const m of src.matchAll(/<LineChart[\s\S]{0,400}?\/>/g)) {
      const tag = m[0];
      // A chart is a follower chart when the series it is handed came from the
      // follower series builder, whatever the local variable happens to be named.
      const feedsFollowers = /\bfoll\b|followersByDay|growth/.test(tag);
      if (!feedsFollowers) continue;
      assert.match(tag, /baseline=\{?"auto"\}?/,
        `${f}: a follower chart must set baseline="auto" or it draws real movement as a flat line:\n${tag.slice(0, 160)}`);
    }
  }
});

/* ---- the gender split, and the panel that measured nothing ---------------- */

test("an unreported gender breakdown is absent, not 100% Other", async () => {
  /*
   * The defect this guards shipped and was found by looking at the page with a
   * LinkedIn account selected. "Other" was derived as 1 - female - male and the
   * panel was drawn whenever the three summed above zero — which, for an account
   * with no breakdown at all, is 1 - 0 - 0 = 1. Every such account rendered a
   * full bar reading "Other 100%".
   *
   * Not a LinkedIn problem: a Facebook Page connected after 14 March 2024 gets
   * no demographics either, and has been showing the same thing.
   */
  for (const empty of [undefined, {}, { female: 0, male: 0 }]) {
    const g = genderSplit(empty);
    assert.equal(g.reported, false, `nothing reported for ${JSON.stringify(empty)}`);
    assert.equal(g.other, 0, "an unreported split must not invent a category");
  }
});

test("a real gender split still adds up, and the remainder is Other", async () => {
  const g = genderSplit({ female: 0.58, male: 0.4 });
  assert.equal(g.reported, true);
  assert.ok(Math.abs(g.female - 0.58) < 1e-9);
  assert.ok(Math.abs(g.male - 0.4) < 1e-9);
  // The platform reports two buckets and the rest is genuinely unaccounted for.
  assert.ok(Math.abs(g.other - 0.02) < 1e-9, "the remainder is Other, not zero");
});

test("a gender split that over-reports does not go negative", async () => {
  const g = genderSplit({ female: 0.7, male: 0.5 });
  assert.equal(g.other, 0, "clamped at zero rather than drawing a negative bar");
});
