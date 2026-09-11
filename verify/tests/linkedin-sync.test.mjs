import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccount } from "../build/_sync.js";
import { makeDb } from "./fake-supabase.mjs";
import {
  installLinkedInMock, trueValue, trueEngagements, addDays, ORG_ID, FOLLOWERS,
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
  assert.ok(api.length <= 6,
    `a week of history and three posts should cost a few calls, spent ${api.length}:\n${api.join("\n")}`);
  const stats = api.filter((c) => c.includes("organizationalEntityShareStatistics"));
  assert.equal(stats.length, 2, "one call for the daily series, one for all posts together");
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
