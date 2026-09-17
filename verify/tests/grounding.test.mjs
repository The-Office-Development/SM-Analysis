import { test } from "node:test";
import assert from "node:assert/strict";
import { periodCompare, summarizeForAI } from "../build-lib/analytics.js";
import { buildSnapshot } from "../build-lib/snapshot.js";

/**
 * The two modules that could not be tested until 2026-09-12.
 *
 * `analytics.ts` and `snapshot.ts` imported `api.ts` and `platforms.tsx`, so
 * reaching them meant reaching the Supabase client and the React tree. Three
 * defects lived here and every one was found by LOOKING at a rendered page:
 *
 *   - "Your audience is most active Sun 12am", given to accounts with no hourly
 *     data at all, because the scan seeded its best score at -1
 *   - a sponsor-facing report scoped to LinkedIn printing Instagram's posting
 *     times, because the caller passed connectedPlatforms instead of the scope
 *   - the AI assistant grounded on "Video views: 0 (+0.0%)" for a platform that
 *     reports no views, which it would then repeat to the client as measured
 *
 * The pure parts moved to `series.ts` and `platformNames.ts` so the arithmetic
 * could be reached without the network. These tests are the point of that move.
 */

const LI = "linkedin", IG = "instagram";

const day = (d, platform, extra) => ({
  account_id: platform, platform, date: `2026-08-${String(d).padStart(2, "0")}`,
  followers: 1000 + d, reach: 500, impressions: 600, views: 400, engagements: 40,
  follows: 5, unfollows: 2, reach_followers: 300, reach_non_followers: 150,
  provisional: false, ...extra,
});

/** A LinkedIn page: no page-level views, no churn, no discovery split. */
const liDay = (d) => day(d, LI, {
  views: null, follows: null, unfollows: null,
  reach_followers: null, reach_non_followers: null,
});

const heat = (dow, hour) => {
  const g = Array.from({ length: 7 }, () => Array(24).fill(0));
  g[dow][hour] = 10;
  return g;
};

const input = (over = {}) => ({
  scope: LI, range: 30, connectedPlatforms: [IG, LI],
  accounts: [
    { id: "i", user_id: "u", platform: IG, external_id: "i", username: "north", display_name: null, avatar_url: null, status: "connected", connected_at: "", last_synced_at: null },
    { id: "l", user_id: "u", platform: LI, external_id: "l", username: "north-co", display_name: null, avatar_url: null, status: "connected", connected_at: "", last_synced_at: null },
  ],
  metrics: [...Array.from({ length: 8 }, (_, i) => liDay(i + 1)),
            ...Array.from({ length: 8 }, (_, i) => day(i + 1, IG))],
  content: [],
  // Only Instagram reports when followers are online. LinkedIn never does.
  audience: [
    { account_id: "i", platform: IG, captured_on: "2026-08-08", age: {}, gender: {}, countries: {}, devices: {}, active_hours: heat(6, 19) },
    { account_id: "l", platform: LI, captured_on: "2026-08-08", age: {}, gender: {}, countries: {}, devices: {}, active_hours: heat(0, 0).map((r) => r.map(() => 0)) },
  ],
  ...over,
});

/* ---- periodCompare -------------------------------------------------------- */

test("a metric the platform never reported is marked unreported, not zero", () => {
  const cmp = periodCompare(input().metrics.filter((m) => m.platform === LI), LI);
  const views = cmp.find((c) => c.label === "Video views");
  assert.equal(views.reported, false, "LinkedIn reports no page-level views");
  const reach = cmp.find((c) => c.label === "Reach");
  assert.equal(reach.reported, true, "reach IS reported and must not be swept up");
});

/* ---- the AI grounding ----------------------------------------------------- */

test("the assistant is never grounded on a total nobody measured", () => {
  const text = summarizeForAI(input());
  assert.match(text, /Video views: not reported by this platform/,
    "a 0 here is repeated to the client as a measurement");
  assert.ok(!/Video views: 0/.test(text), "and must not appear as a figure");
});

test("the assistant is not handed another platform's posting windows", () => {
  const li = summarizeForAI(input());
  assert.ok(!/Best posting windows/.test(li),
    "LinkedIn reports no hourly activity; there is nothing to recommend");

  // The same data scoped to Instagram, which does report it, still gets them.
  const ig = summarizeForAI(input({ scope: IG }));
  assert.match(ig, /Best posting windows: Saturday · 7pm/,
    "and the platform that does report it is unaffected");
});

test("the grounding names the platform in scope, not Instagram", () => {
  const text = summarizeForAI(input());
  assert.ok(!/Instagram has never reported unfollows/.test(text),
    "the assistant repeats its grounding as fact, to a client reading it");
  assert.match(text, /LinkedIn does not report unfollows for a Company Page/);
});

/* ---- the report snapshot -------------------------------------------------- */

test("a scoped report does not borrow another platform's posting times", () => {
  // The worst placement of this defect: the report is the artefact that leaves
  // the building and goes to a sponsor.
  assert.deepEqual(buildSnapshot(input()).windows, []);
  assert.deepEqual(buildSnapshot(input({ scope: IG })).windows.slice(0, 1), ["Saturday · 7pm"]);
});

test("a scoped report is headed with the account it is about, and no others", () => {
  assert.equal(buildSnapshot(input()).account, "north-co");
  assert.equal(buildSnapshot(input({ scope: "all" })).account, "north / north-co");
});

test("a headline total nobody measured is null, and carries no trend", () => {
  const h = buildSnapshot(input()).headline.find((x) => x.label === "Video views");
  assert.equal(h.total, null, "no total");
  assert.equal(h.deltaPct, null, "and therefore no movement to report");
});

test("the report says which platform its figures came from", () => {
  assert.match(buildSnapshot(input()).source, /LinkedIn's official API/);
  assert.match(buildSnapshot(input({ scope: "all" })).source, /the platforms' official APIs/);
  // The Instagram-app reconciliation caveat is an Instagram finding and must not
  // be asserted of a platform nothing has ever been reconciled against.
  assert.ok(!/Instagram app/.test(buildSnapshot(input()).provenance));
});

/* ---- connecting an account is not follower growth --------------------------- */

const { followerGrowth } = await import("../build-lib/series.js");

const fgDay = (n) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
const fgPoint = (account_id, platform, date, followers) => ({
  account_id, platform, date, followers, reach: null, impressions: null, views: null,
  engagements: null, follows: null, unfollows: null, reach_followers: null, reach_non_followers: null,
});

test("an account that starts reporting mid-window is not counted as gained followers", () => {
  /*
   * LinkedIn gives no follower history, only today's total, so every page or
   * profile arrives as a single day at the end of the window. The combined line's
   * first-vs-last read that arrival as growth: an Instagram account going from
   * 1,000 to 1,100 beside a LinkedIn page of 5,000 connected on the last day was
   * reported as +510%.
   */
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => fgPoint("ig", "instagram", fgDay(i), 1000 + Math.round(i * 100 / 29))),
    fgPoint("li", "linkedin", fgDay(29), 5000),
  ];
  const g = followerGrowth(rows, "all");
  assert.ok(g, "growth is measurable from the account that was there all along");
  assert.ok(Math.abs(g.pct - 10) < 1e-9, `expected +10%, got ${g.pct}`);

  assert.equal(followerGrowth(rows, "linkedin"), null,
    "a single day of LinkedIn is a level, not a change, so its growth is unknown");

  const cmp = periodCompare(rows, "all").find((c) => c.key === "followers");
  assert.equal(cmp.deltaKnown, true);
  assert.ok(cmp.deltaPct > 0 && cmp.deltaPct < 10, `the trend ignores the arrival: ${cmp.deltaPct}`);
  assert.equal(cmp.current, 6100, "while the total shown still includes every account");
});

test("a follower trend nobody can measure is said to be unmeasurable, never +0%", () => {
  /*
   * Six days in the window, so halves can be compared. Account A was measured
   * only before the midpoint and stopped; account B only after it. Neither has a
   * start and an end, so no change was measured by anyone.
   */
  const rows = [
    fgPoint("a", "instagram", fgDay(0), 400), fgPoint("a", "instagram", fgDay(1), 400), fgPoint("a", "instagram", fgDay(2), 400),
    fgPoint("b", "instagram", fgDay(3), 900), fgPoint("b", "instagram", fgDay(4), 900), fgPoint("b", "instagram", fgDay(5), 900),
  ];
  const cmp = periodCompare(rows, "instagram").find((c) => c.key === "followers");
  assert.equal(cmp.reported, true, "followers exist");
  assert.equal(cmp.deltaKnown, false, "but no change was measured");

  const text = summarizeForAI({ range: 7, scope: "instagram", connectedPlatforms: ["instagram"], metrics: rows, content: [], audience: [] });
  assert.match(text, /Followers: 900 \(trend not measurable yet/, "the assistant is told the trend is unknown, not +0% or +125%");
});

test("a platform's accounts that started on different days are drawn as separate lines", () => {
  /*
   * A summed follower line adds a later account's whole following on the day it
   * connected and draws that as a surge. A LinkedIn page with a profile connected
   * six days later showed exactly that step in the demo.
   */
  return import("../build-lib/series.js").then(({ followerLines }) => {
    const page = Array.from({ length: 30 }, (_, i) => fgPoint("page", "linkedin", fgDay(i), 9000 + i * 10));
    const profile = Array.from({ length: 7 }, (_, i) => fgPoint("me", "linkedin", fgDay(23 + i), 2300 + i));
    const split = followerLines([...page, ...profile], "linkedin");
    assert.equal(split.length, 2, "two lines, not one line with a step");
    const me = split.find((l) => l.account_id === "me");
    assert.equal(me.points[0].date, fgDay(23), "the profile's line starts when the profile started");
    assert.equal(me.points[0].value, 2300);
    const pg = split.find((l) => l.account_id === "page");
    assert.ok(pg.points.every((p) => p.value < 10000), "the page's line never includes the profile's followers");

    const together = [...page, ...page.map((r) => ({ ...r, account_id: "page2", followers: r.followers + 1 }))];
    const one = followerLines(together, "linkedin");
    assert.equal(one.length, 1, "accounts with the same history stay one summed line");
    assert.equal(one[0].account_id, null);
  });
});
