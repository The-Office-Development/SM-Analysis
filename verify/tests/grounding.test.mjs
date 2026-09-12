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
