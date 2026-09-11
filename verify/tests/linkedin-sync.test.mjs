import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccount } from "../build/_sync.js";
import { makeDb } from "./fake-supabase.mjs";
import {
  installLinkedInMock, trueValue, trueEngagements, addDays, ORG_ID, FOLLOWERS,
  DEMOGRAPHICS, URN_NAMES, trueShare,
} from "./mock-linkedin.mjs";

/**
 * The LinkedIn sync, against an oracle.
 *
 * The other LinkedIn file tests conversions and invariants in isolation. This one
 * runs the actual sync and checks what lands in the database against a mock that
 * knows each day's true value — the same discipline as the Instagram tests, and
 * for the same reason recorded in CLAUDE.md: the previous harness reported PASS
 * throughout the period the sync was writing wrong numbers, because it only ever
 * checked that nothing threw.
 *
 * Still not a substitute for a live call. LinkedIn has never answered this code,
 * and the mock can only be as right as the documentation it was built from.
 * What it does prove is that the code does what we BELIEVE LinkedIn's shape to
 * be — so when a real response disagrees, the disagreement is the finding rather
 * than being buried under a crash.
 */

/*
 * The window the sync will actually ask for, not an arbitrary week.
 *
 * With nothing stored, syncWindow takes the most recent chunk ending TODAY. The
 * mock honours the range it is given — as the real API does — so a fixed August
 * week would simply return nothing. Pinning these to today is what makes the
 * exclusive-end assertion meaningful rather than decorative.
 */
const TODAY = new Date().toISOString().slice(0, 10);
const FROM = addDays(TODAY, -9);
const TO = TODAY;

const account = { id: "li-1", platform: "linkedin", external_id: ORG_ID, username: "drinkat" };

function seedDb() {
  return makeDb({
    account_secrets: [{ account_id: "li-1", access_token: "PLAINTEXT_TOKEN", extra: { kind: "li_organization" } }],
    social_accounts: [{ id: "li-1", user_id: "u1", platform: "linkedin", external_id: ORG_ID, username: "drinkat", status: "connected" }],
    metrics_daily: [],
    content: [],
  });
}

async function run(opts = {}) {
  const db = seedDb();
  const mock = installLinkedInMock({ days: [FROM, TO], ...opts });
  try { await syncAccount(db, account); } finally { mock.restore(); }
  return { db, calls: mock.calls };
}

/* ---- the daily series ---------------------------------------------------- */

test("each day is stored under its own date, with the platform's own figures", async () => {
  const { db } = await run();
  const rows = db._rows("metrics_daily").filter((r) => r.date >= FROM && r.date <= TO);
  assert.ok(rows.length >= 7, `expected a week of rows, got ${rows.length}`);

  for (const r of rows) {
    assert.equal(r.impressions, trueValue("impressionCount", r.date), `impressions on ${r.date}`);
    // uniqueImpressionsCount is LinkedIn's nearest thing to reach.
    assert.equal(r.reach, trueValue("uniqueImpressionsCount", r.date), `reach on ${r.date}`);
    assert.equal(r.engagements, trueEngagements(r.date), `engagements on ${r.date}`);
    assert.equal(r.account_id, "li-1", "rows must belong to the syncing account");
  }
});

test("a day is not filed one out, despite the exclusive end", async () => {
  /*
   * LinkedIn's timeRange.start is the start of the day and its range end is
   * EXCLUSIVE. Meta's end_time is local midnight of the FOLLOWING day. Reading
   * one with the other's convention files every figure a day out — the defect
   * that put the whole of the Americas a day late on the Instagram path.
   */
  const { db } = await run();
  const dates = db._rows("metrics_daily").map((r) => r.date).sort();
  assert.ok(dates.includes(FROM), `the first day asked for must be stored: ${dates[0]}`);
  assert.ok(dates.includes(TO), `and so must the last: ${dates[dates.length - 1]}`);
  assert.ok(!dates.includes(addDays(TO, 1)), "and nothing beyond it");
});

test("views and the follower split stay unknown, because LinkedIn has neither", async () => {
  /*
   * A Company Page has no "views" separate from impressions, and no follower
   * movement or discovery split at all. Writing zeros would make the churn and
   * discovery panels report that nobody left and nobody new was reached, which
   * is a claim rather than an absence.
   */
  const { db } = await run();
  for (const r of db._rows("metrics_daily").filter((x) => x.date >= FROM && x.date <= TO)) {
    assert.equal(r.views, null, `views on ${r.date}`);
    assert.equal(r.follows, null, `follows on ${r.date}`);
    assert.equal(r.unfollows, null, `unfollows on ${r.date}`);
    assert.equal(r.reach_followers, null, `reach_followers on ${r.date}`);
    assert.equal(r.reach_non_followers, null, `reach_non_followers on ${r.date}`);
  }
});

test("today carries the follower total, and no earlier day pretends to", async () => {
  // The follower count is a lifetime figure from a different endpoint. Spreading
  // it backwards would invent a follower history that was never measured.
  const { db } = await run();
  const rows = db._rows("metrics_daily");
  const withFollowers = rows.filter((r) => r.followers !== null);
  assert.equal(withFollowers.length, 1, "exactly one day should carry it");
  assert.equal(withFollowers[0].followers, FOLLOWERS);
});

/* ---- posts --------------------------------------------------------------- */

test("posts are stored with impressions, and with reach left unknown", async () => {
  /*
   * uniqueImpressionsCount is absent from the per-share response. Copying
   * impressions into reach would inflate every reach-derived figure — the
   * multiple over following, the engagement rate, the discovery split — with a
   * quantity that means something else.
   */
  const { db } = await run({ posts: 3 });
  const posts = db._rows("content");
  assert.equal(posts.length, 3);
  for (const p of posts) {
    assert.equal(p.reach, null, `${p.external_id} must not borrow impressions as reach`);
    assert.ok(typeof p.views === "number", "impressions are stored as views");
    assert.equal(p.saves, null, "LinkedIn has no per-post save count");
  }
});

test("a negative like count survives, because LinkedIn means it", async () => {
  // "This field can become negative when members who liked a sponsored share
  // later unlike it." Clamping would invent a figure.
  const { db } = await run({ posts: 3 });
  const negative = db._rows("content").filter((p) => p.likes < 0);
  assert.equal(negative.length, 1, "the mock's one negative post should arrive negative");
});

test("a post omitted from the statistics response is a real zero", async () => {
  /*
   * The single inversion of the usual rule, and it is LinkedIn's own words:
   * "Shares that are not returned in the list of elements can be assumed to have
   * counts of 0 for all statistics." It applies ONLY when the request succeeded
   * and the post was left out.
   */
  const { db } = await run({ posts: 3, silentPosts: 1 });
  const posts = db._rows("content");
  assert.equal(posts.length, 3, "the silent post is still stored");
  const zeroed = posts.filter((p) => p.views === 0);
  assert.equal(zeroed.length, 1, "and its figures are zero, not null");
});

test("the post's text becomes a single-line title", async () => {
  const { db } = await run({ posts: 1 });
  const title = db._rows("content")[0].title;
  assert.ok(!/\n/.test(title), "a newline in a caption must not become a two-line table row");
  assert.ok(!/ {2}/.test(title), "and runs of spaces are collapsed");
});

test("a video post is labelled a video, so it is compared with videos", async () => {
  // Format drives the median comparison. A mislabelled post is compared against
  // the wrong peer group, which is a wrong number rather than a cosmetic slip.
  const { db } = await run({ posts: 3 });
  const kinds = db._rows("content").map((p) => p.media_type);
  assert.ok(kinds.includes("Video"), `expected the video post to be recognised: ${kinds.join(", ")}`);
});

/* ---- the call budget ----------------------------------------------------- */

test("a whole sync costs a handful of calls, not one per day", async () => {
  /*
   * LinkedIn's Development Tier allows 500 requests per app per DAY and 100 per
   * member. The Instagram sync spends about 2,100 a day on a single account, so
   * that shape is impossible here: the daily series must come back in one call
   * and every post's statistics in one more.
   */
  const { calls } = await run({ posts: 3 });
  const api = calls.filter((c) => c.includes("api.linkedin.com"));
  /*
   * Nine, and every one of them accounted for: the daily series, the follower
   * total, the post list, all posts' statistics together (4), the lifetime
   * facet call (1), and one call per taxonomy to turn URNs into words (4).
   *
   * The number that matters is not nine, it is that none of them is per-day or
   * per-value. The ceiling moved when Phase 2 added demographics; it must not
   * move again for a longer window or a page with more industries in it.
   */
  assert.ok(api.length <= 9,
    `a week of history and three posts should cost a few calls, spent ${api.length}:\n${api.join("\n")}`);
  const stats = api.filter((c) => c.includes("organizationalEntityShareStatistics"));
  assert.equal(stats.length, 2, "one call for the daily series, one for all posts together");
});

test("the second sync of a day does not pay for demographics again", async () => {
  /*
   * Demographics are a daily snapshot and the cron runs hourly. Re-fetching them
   * every hour would spend 120 of LinkedIn's 500 daily calls on one page telling
   * us the same thing twenty-four times — and it was exactly this waste on the
   * Instagram path that starved the rest of a run once a budget guard existed.
   */
  const db = seedDb();
  const mock = installLinkedInMock({ days: [FROM, TO] });
  try {
    await syncAccount(db, account);
    const first = mock.calls.length;
    await syncAccount(db, account);
    const second = mock.calls.slice(first);
    assert.ok(!second.some((c) => c.includes("FollowerStatistics")),
      "today's facets were already captured; the call must not be repeated");
    assert.ok(!second.some((c) => c.includes("/v2/")),
      "and nothing needs resolving if nothing was fetched");
  } finally { mock.restore(); }
});

test("history is clamped to the twelve months LinkedIn serves", async () => {
  // Asking further back is not an error, it returns nothing — and a silently
  // empty response is indistinguishable from a page with no activity.
  const { calls } = await run();
  const series = calls.find((c) => c.includes("timeIntervals"));
  assert.ok(series, "the daily series should have been requested");
  const start = Number(/start:(\d+)/.exec(decodeURIComponent(series))?.[1]);
  const oldest = Date.now() - 366 * 86_400_000;
  assert.ok(start >= oldest, "the window must not reach past the rolling twelve months");
});

/* ---- the connection lifecycle -------------------------------------------- */

import { flagLinkedInExpiry, needsRefresh } from "../build/_tokens.js";

test("a LinkedIn token is never reported as refreshed, because it cannot be", async () => {
  /*
   * Every other platform swaps an old token for a new one in a cron. LinkedIn
   * does not offer that to this app: "Programmatic refresh tokens are available
   * for a limited set of partners", and otherwise "go through the authorization
   * process again to fetch a new token" — which needs the member's browser.
   *
   * Returning "refreshed" would let a token lapse silently and hand the client
   * an empty dashboard with no explanation.
   */
  const updates = [];
  const db = {
    from: () => ({
      // Resolves to { error } like the real client does, because the caller now
      // reads it: a flag that silently failed to save is a client who never gets
      // the reconnect prompt this whole function exists to raise.
      update: (patch) => ({ eq: async (col, val) => { updates.push({ patch, col, val }); return { data: [], error: null }; } }),
    }),
  };
  const id = {
    id: "idn-1", user_id: "u1", provider: "linkedin", external_user_id: "5515715",
    access_token: "x", refresh_token: null,
    expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), refresh_lock_at: null,
  };
  const result = await flagLinkedInExpiry(db, id);
  assert.equal(result, "skipped", "nothing was refreshed, so nothing may claim to be");
  assert.equal(updates.length, 1, "the account should be flagged for the client");
  assert.equal(updates[0].patch.needs_reauth, true);
});

test("the client is warned while a silent reconnect still works", () => {
  /*
   * LinkedIn skips the consent screen only while the token is still valid. The
   * warning therefore has to arrive BEFORE expiry, not on it — after that the
   * same click becomes a full consent screen and, for a Company Page, a hunt for
   * an administrator.
   */
  const at = (days) => ({
    provider: "linkedin", expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
  });
  assert.equal(needsRefresh(at(30)), false, "a month out is not yet worth nagging about");
  assert.equal(needsRefresh(at(5)), true, "five days out the client must be told");
  assert.equal(needsRefresh(at(-1)), true, "and an already-lapsed account still needs them");
});

/* ---- follower demographics ------------------------------------------------
 *
 * Phase 2. Every assertion below is against an oracle the mock computes from
 * ORGANIC counts alone, because the single most likely defect in this file is
 * the one LinkedIn warns about in prose: the field named `organicFollowerCount`
 * already contains the paid followers, and adding `paidFollowerCount` to it —
 * which is what the names invite — double-counts every one of them.
 */

const near = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: expected ${b}, got ${a}`);

const snapshot = (db) => db._rows("audience_snapshots")[0];

test("demographics are asked for WITHOUT a time range", async () => {
  const { calls } = await run();
  const facetCalls = calls.filter((c) => c.includes("organizationalEntityFollowerStatistics"));
  assert.equal(facetCalls.length, 1, "one lifetime call for the facets");
  /*
   * LinkedIn returns 200 and no facets when a range is given, so this cannot be
   * caught downstream by anything except an empty snapshot that looks exactly
   * like a page nobody has classified.
   */
  assert.ok(!facetCalls[0].includes("timeIntervals"),
    "a time range suppresses every facet; the call must not carry one");
});

test("a facet's shares come from organic counts alone, never organic plus paid", async () => {
  const { db } = await run();
  const industry = snapshot(db).dimensions.industry;

  near(industry["Software Development"], trueShare("followerCountsByIndustry", "urn:li:industry:4"),
    "Software Development share");
  near(industry["Retail Groceries"], trueShare("followerCountsByIndustry", "urn:li:industry:96"),
    "Retail Groceries share");

  // And prove the oracle can tell the two readings apart, so the test above is
  // not passing by coincidence on data where both give the same answer.
  const rows = DEMOGRAPHICS.followerCountsByIndustry.rows;
  const bothTotal = rows.reduce((s, r) => s + r.organic + r.paid, 0);
  const wrong = (rows[0].organic + rows[0].paid) / bothTotal;
  assert.ok(Math.abs(industry["Software Development"] - wrong) > 1e-6,
    "adding paidFollowerCount must change the answer, or this test proves nothing");
});

test("URNs are resolved to words before anything is stored", async () => {
  const { db } = await run();
  const snap = snapshot(db);
  const keys = [
    ...Object.keys(snap.countries),
    ...Object.values(snap.dimensions).flatMap((d) => Object.keys(d)),
  ];
  assert.ok(keys.length > 0, "something must have been stored");
  for (const k of keys) {
    assert.ok(!k.startsWith("urn:"), `a raw URN reached storage: ${k}`);
  }
  assert.ok(Object.keys(snap.dimensions.seniority).includes(URN_NAMES.seniority["9"]),
    "seniority URNs resolve through the taxonomy endpoint");
});

test("a URN the taxonomy cannot name becomes Unknown and keeps its weight", async () => {
  const { db } = await run();
  const industry = snapshot(db).dimensions.industry;

  // urn:li:industry:777 is absent from the taxonomy the mock serves.
  near(industry["Unknown"], trueShare("followerCountsByIndustry", "urn:li:industry:777"),
    "the unnamed industry keeps its own share");
  /*
   * Dropping it instead would be the quiet defect: every other bar would grow
   * to fill the gap and nothing would say why.
   */
  const total = Object.values(industry).reduce((a, b) => a + b, 0);
  near(total, 1, "shares must still sum to one");
});

test("countries share the existing column; market areas do not", async () => {
  const { db } = await run();
  const snap = snapshot(db);

  near(snap.countries["Jordan"], trueShare("followerCountsByGeoCountry", "urn:li:geo:102713980"),
    "country share");
  assert.ok(snap.countries["United States"] > 0, "both countries stored");

  /*
   * followerCountsByGeo is a COARSER second geography — a follower appears in
   * both it and the country facet — so merging them into one column would count
   * every follower twice.
   */
  assert.ok(!("Amman Governorate, Jordan" in snap.countries),
    "market areas must not be mixed into countries");
  near(snap.dimensions.regions["Amman Governorate, Jordan"],
    trueShare("followerCountsByGeo", "urn:li:geo:90009626"), "region share");
});

test("enum facets are rendered without inventing a value", async () => {
  const { db } = await run();
  const snap = snapshot(db);
  assert.ok("1 employee" in snap.dimensions.company_size, "SIZE_1");
  assert.ok("2–10 employees" in snap.dimensions.company_size, "SIZE_2_TO_10");
  assert.ok("Employee" in snap.dimensions.association, "EMPLOYEE");
});

test("age and gender stay empty for a page that reports neither", async () => {
  const { db } = await run();
  const snap = snapshot(db);
  assert.deepEqual(snap.age, {}, "LinkedIn reports no age; empty, not zeros");
  assert.deepEqual(snap.gender, {}, "LinkedIn reports no gender; empty, not zeros");
});

test("each taxonomy costs one call, not one per value", async () => {
  const { calls } = await run();
  const v2 = calls.filter((c) => c.includes("/v2/"));
  /*
   * Development Tier allows 500 calls per app per DAY. Resolving a URN at a time
   * would spend that on a single sync of a single page, which is why geo and
   * industry are batched and the two small taxonomies are fetched whole.
   */
  assert.equal(v2.filter((c) => c.includes("/v2/geo")).length, 1, "one batched geo call");
  assert.equal(v2.filter((c) => c.includes("industryTaxonomyVersions")).length, 1, "one batched industry call");
  assert.equal(v2.filter((c) => c.includes("/v2/seniorities")).length, 1, "one seniorities call");
  assert.equal(v2.filter((c) => c.includes("/v2/functions")).length, 1, "one functions call");
});
