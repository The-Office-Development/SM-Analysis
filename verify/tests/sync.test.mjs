import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccount, dayKeyFromEndTime, syncStart, syncWindow, backfillTurn, seriesFrom, rotatingWindow } from "../build/_sync.js";
import { makeDb } from "./fake-supabase.mjs";
import { installGraphMock, trueValue, trueNetFollows, addDays } from "./mock-graph.mjs";

process.env.GRAPH_BACKOFF_BASE_MS = "1";
process.env.TOKEN_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
// The per-run call budget exists to fit a serverless host's subrequest cap. It
// is a deployment constraint, not a property of the sync's correctness, and the
// tests below deliberately sync wide windows. Raised here so it does not mask
// what they are actually asserting; the budget has its own test instead.
process.env.IG_CALL_BUDGET = "10000";
process.env.META_APP_SECRET ??= "test-app-secret";

const TODAY = new Date().toISOString().slice(0, 10);
const account = { id: "acc-1", platform: "instagram", external_id: "1784100", username: "creator" };

function seedDb(extra = {}) {
  return makeDb({
    account_secrets: [{ account_id: "acc-1", access_token: "PLAINTEXT_TOKEN", extra: {} }],
    social_accounts: [{ id: "acc-1", user_id: "u1", platform: "instagram", external_id: "1784100", username: "creator", status: "connected" }],
    metrics_daily: [],
    ...extra,
  });
}

/**
 * Run the sync the way the cron does: repeatedly.
 *
 * Only `reach` has a daily series; every other account metric costs one call per
 * day, so a run fetches a bounded window and the next run resumes where it
 * stopped. A backfill therefore completes over several runs, and a test that
 * syncs once and expects a month of history is testing a sync that would blow
 * its function timeout on a real account.
 */
async function syncUntilCaughtUp(db, acc, opts, runs = 6) {
  for (let i = 0; i < runs; i++) {
    const mock = installGraphMock(opts);
    try { await syncAccount(db, acc); } finally { mock.restore(); }
  }
}

/* ---- the day-boundary oracle ------------------------------------------- */

test("dayKeyFromEndTime recovers the account's calendar day at every offset", () => {
  // end_time is local midnight of the NEXT day, in UTC.
  const cases = [
    ["2026-08-24T07:00:00+0000", -7, "2026-08-23"],  // Los Angeles
    ["2026-08-24T04:00:00+0000", -4, "2026-08-23"],  // New York
    ["2026-08-24T00:00:00+0000", 0,  "2026-08-23"],  // UTC
    ["2026-08-23T23:00:00+0000", +1, "2026-08-23"],  // London BST
    ["2026-08-23T21:00:00+0000", +3, "2026-08-23"],  // Amman
    ["2026-08-23T15:00:00+0000", +9, "2026-08-23"],  // Tokyo
  ];
  for (const [endTime, offset, expected] of cases) {
    assert.equal(dayKeyFromEndTime(endTime), expected, `offset ${offset}`);
  }
});

test("seriesFrom distinguishes an unavailable metric from a zero", () => {
  assert.equal(seriesFrom({ data: [] }, "reach").available, false);
  const s = seriesFrom({ data: [{ name: "reach", values: [{ value: 0, end_time: "2026-08-24T00:00:00+0000" }] }] }, "reach");
  assert.equal(s.available, true);
  assert.equal(s.byDate["2026-08-23"], 0);
});

/* ---- the frozen-day regression ------------------------------------------ */

test("syncStart always re-fetches a trailing window, even right after a sync", () => {
  // The defect: after syncing today, the next run started at today and never
  // revisited any earlier day, freezing each one at a few hours of activity.
  const start = syncStart(TODAY);
  assert.ok(start <= addDays(TODAY, -6), `expected a trailing window, got ${start}`);
});

test("syncStart still backfills a first sync and never runs past today", () => {
  assert.equal(syncStart(null), addDays(TODAY, -29));
  assert.ok(syncStart(TODAY) <= TODAY);
});

/* ---- end-to-end, against the oracle ------------------------------------- */

/*
 * Each case is an account whose OWN calendar day is `offset`, and whose platform
 * reports on that same boundary. Before 0007 the code inferred the account's day
 * from the platform's end_time, so these two were never separable. They are now,
 * and the account states its own timezone — which is why every case passes
 * tz_offset_minutes rather than relying on the Amman default.
 */
for (const [label, offset] of [["Amman (+3)", 3], ["Los Angeles (-7)", -7], ["UTC", 0], ["Tokyo (+9)", 9]]) {
  const account = { id: "acc-1", platform: "instagram", external_id: "1784100", username: "creator", tz_offset_minutes: offset * 60 };
  test(`stored reach matches the platform's true value per day — ${label}`, async () => {
    const from = addDays(TODAY, -29);
    const db = seedDb();
    await syncUntilCaughtUp(db, account, { offset, days: [from, TODAY] });

    const rows = db._rows("metrics_daily");
    assert.ok(rows.length >= 25, `expected a month of rows, got ${rows.length}`);
    for (const r of rows) {
      assert.equal(r.reach, trueValue("reach", r.date), `reach on ${r.date}`);
      assert.equal(r.account_id, "acc-1", "rows must belong to the syncing account");
    }
  });

  /*
   * `views` is total_value only, so its day boundaries come from the REQUEST.
   * The mock aggregates by real-time overlap with each local day, exactly as the
   * platform does, so asking for a UTC day on a UTC+3 account returns a blend of
   * two days rather than an error. An exact match is therefore proof the window
   * was built in the account's own timezone.
   */
  test(`total_value day windows are the account's own days — ${label}`, async () => {
    const from = addDays(TODAY, -29);
    const db = seedDb();
    await syncUntilCaughtUp(db, account, { offset, days: [from, TODAY] });

    const rows = db._rows("metrics_daily");
    assert.ok(rows.length >= 25, `expected a month of rows, got ${rows.length}`);
    for (const r of rows) {
      assert.equal(r.views, trueValue("views", r.date), `views on ${r.date} — window misaligned by the account offset`);
    }
  });

  test(`the follower series is rebuilt from net follows and unfollows — ${label}`, async () => {
    const from = addDays(TODAY, -29);
    const db = seedDb();
    await syncUntilCaughtUp(db, account, { offset, days: [from, TODAY] });

    const rows = db._rows("metrics_daily").slice().sort((a, b) => a.date.localeCompare(b.date));
    const withFollowers = rows.filter((r) => r.followers !== null);
    assert.ok(withFollowers.length >= 25, "a follower value per day, not one flat line");
    // Day-over-day movement must equal follows minus unfollows for that day. A
    // series that ignored unfollows would drift upward by the unfollow count.
    for (let i = 1; i < withFollowers.length; i++) {
      const expected = trueNetFollows(withFollowers[i].date);
      assert.equal(withFollowers[i].followers - withFollowers[i - 1].followers, expected,
        `net follower change on ${withFollowers[i].date}`);
    }
  });
}

/* ---- the zero-overwrite regression -------------------------------------- */

test("a throttled metric never overwrites stored data with zeros", async () => {
  const from = addDays(TODAY, -29);
  // First sync: everything succeeds.
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });

  const before = db._rows("metrics_daily");
  assert.ok(before.every((r) => r.reach > 0), "precondition: real values are stored");

  // Second sync: Meta rate limits us.
  const mock = installGraphMock({ offset: 3, days: [from, TODAY], failMetric: "reach" });
  let threw = false;
  try { await syncAccount(db, account); } catch { threw = true; } finally { mock.restore(); }

  assert.ok(threw, "a throttled sync must fail loudly, not persist an empty result");
  const after = db._rows("metrics_daily");
  for (const r of after) {
    assert.notEqual(r.reach, 0, `reach on ${r.date} was overwritten with a fabricated zero`);
    assert.equal(r.reach, trueValue("reach", r.date), `reach on ${r.date} changed`);
  }
});

test("a metric the account does not expose is stored as unknown, not as zero", async () => {
  const from = addDays(TODAY, -29);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY], missing: ["total_interactions"] });

  const rows = db._rows("metrics_daily");
  assert.ok(rows.length > 0);

  // The mock serves two posts, on the first and last day of the window, so the
  // post-derived fallback legitimately produces a figure for those two days.
  // Every OTHER day has no account-level interactions and no post to derive
  // from, and must therefore be null. Zero would claim the account had no
  // engagement at all on days we simply cannot speak for.
  const postDays = new Set([from, TODAY]);
  const quiet = rows.filter((r) => !postDays.has(r.date));
  assert.ok(quiet.length > 0, "the window must contain days without posts");
  assert.ok(
    quiet.every((r) => r.engagements === null),
    "a day with no interactions metric and no posts must be unknown, never 0",
  );
  assert.ok(rows.every((r) => r.reach === trueValue("reach", r.date)), "other metrics still stored");
});

test("a post the platform has not reported on stores null, never zero", async () => {
  const from = addDays(TODAY, -29);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });

  const rows = db._rows("content");
  const reported = rows.find((r) => r.external_id === "post_reported");
  const unreported = rows.find((r) => r.external_id === "post_unreported");
  assert.ok(reported && unreported, "both posts are stored");

  // The reported one keeps its figures.
  assert.equal(reported.reach, 500);
  assert.equal(reported.likes, 11);
  assert.equal(reported.saves, 7);

  // The unreported one — no insights edge, no like_count — must be null on
  // every metric. This is the shape Instagram returns for a post published
  // minutes ago, which is exactly when a creator opens the dashboard to decide
  // whether to keep it. Storing 0 answers "did anyone see this?" with a
  // confident no, at the moment of maximum consequence.
  for (const k of ["views", "reach", "likes", "comments", "shares", "saves"]) {
    assert.equal(unreported[k], null, `${k} must be null, not 0, when unreported`);
  }
});

test("an active story is captured, with the metrics it has and nulls for the rest", async () => {
  const from = addDays(TODAY, -29);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });

  const story = db._rows("content").find((r) => r.external_id === "story_live");
  assert.ok(story, "the story was captured at all — it cannot be fetched again after 24h");
  assert.equal(story.media_type, "Story");
  assert.equal(story.reach, 320);
  assert.equal(story.views, 410);
  assert.equal(story.replies, 4);
  assert.equal(story.navigation, 88);

  // A story has no likes, comments or saves. Zero would be a claim about
  // engagement that cannot exist, and would sink the story to the bottom of any
  // ranking sorted on those columns.
  assert.equal(story.likes, null);
  assert.equal(story.comments, null);
  assert.equal(story.saves, null);

  // expires_at is what later tells "final numbers" from "still climbing".
  assert.ok(story.expires_at, "expiry is recorded");
  assert.ok(Date.parse(story.expires_at) > Date.parse(story.published_at));
});

test("a run stops at its call budget, and still saves what it fetched", async () => {
  /*
   * The failure this guards against is not fetching less. A serverless host caps
   * outgoing requests per invocation, and past the cap it refuses EVERYTHING,
   * including the database writes. On 2026-09-07 a production run reported
   * sync.ok with 46 calls while demographics, online_followers and the sync_log
   * insert were all being refused, and the account's last_synced_at appeared
   * frozen for seven hours because the write that updates it never landed.
   *
   * So two things must hold: the run stops ASKING at the budget, and it still
   * reaches its writes.
   */
  const from = addDays(TODAY, -29);
  const db = seedDb();
  const BUDGET = 12;                        // far below a 30-day window's needs
  const previous = process.env.IG_CALL_BUDGET;
  process.env.IG_CALL_BUDGET = String(BUDGET);

  let res;
  const mock = installGraphMock({ offset: 3, days: [from, TODAY] });
  try {
    res = await syncAccount(db, account);
  } finally {
    mock.restore();
    process.env.IG_CALL_BUDGET = previous;
  }

  // It stopped asking. Without the guard this window costs far more than 12.
  assert.ok(res.calls <= BUDGET,
    `the run must not exceed its budget; made ${res.calls} calls against a budget of ${BUDGET}`);

  // And it still got to its writes, which is the whole point of stopping early.
  const rows = db._rows("metrics_daily");
  assert.ok(rows.length > 0, "the run wrote rows despite running out of budget");
});

test("a backfilling account still refreshes its recent days", () => {
  /*
   * The backfill branch used to return unconditionally, so an account still
   * digging through history never reached the trailing refresh at all. Over a
   * 30-day backfill that is hours of a client's current numbers standing still;
   * over the two years Meta allows it would be days, which is what made a deep
   * backfill unusable rather than merely slow.
   */
  const t = TODAY;
  const latest = t;                        // recent data exists

  /*
   * Walked by DATA, not by clock.
   *
   * The turn used to come from `Math.floor(now / 15min) % 4`, so this test drove
   * it by passing successive ticks. That made the whole suite a function of the
   * wall clock: six syncs inside one quarter-hour all computed the identical
   * window, and the sync tests failed for fifteen minutes in every hour. It also
   * meant a client pressing Sync repeatedly during onboarding repeated the same
   * work every time. The turn now advances with how much history is left, so
   * this walks the backfill the way a real one progresses.
   */
  let earliest = addDays(t, -25);          // history has not reached the floor yet
  let backfilled = 0, refreshedPresent = 0;
  for (let i = 0; i < 8; i++) {
    const w = syncWindow(latest, earliest);
    if (w.end === t) refreshedPresent++;
    else { backfilled++; earliest = w.start; }
  }

  assert.ok(backfilled > 0, "it must still make progress on history");
  assert.ok(refreshedPresent > 0,
    "a backfilling account must still refresh today; otherwise the dashboard freezes for the length of the dig");
});

test("repeated syncs in the same minute each make progress", () => {
  /*
   * The defect this guards, which was a client-facing one and not only a test
   * artifact: the backfill turn was a pure function of the wall clock, and the
   * Sync button throttles at two minutes against a fifteen-minute tick. So a
   * client watching a backfill crawl could press Sync seven times and every
   * press would recompute the identical window and fetch exactly what the last
   * one fetched. Onboarding is precisely when somebody presses it repeatedly.
   */
  const t = TODAY;
  let earliest = addDays(t, -25);
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    // The same instant every time. Only the stored data moves.
    const w = syncWindow(t, earliest, 1_700_000_000_000);
    seen.add(`${w.start}..${w.end}`);
    if (w.end !== t) earliest = w.start;
  }
  assert.ok(seen.size > 1,
    "presses at the same instant produced one window every time; the client would be pressing Sync for nothing");
});

test("a deep backfill still gives one run in four to the present", () => {
  /*
   * The reason the branch exists at all. Meta allows two years, and a dig that
   * long used to return unconditionally, so a client's current numbers stood
   * still for days while it worked. The rhythm is three runs digging, one on the
   * present, and it must come from how much history is left rather than from the
   * clock, or two runs in the same quarter-hour make the same decision.
   */
  const budget = 10;
  const turns = [];
  // Walk inwards the way a real dig does: one budget closer to the floor a run.
  for (let daysLeft = 400; daysLeft > 0; daysLeft -= budget) {
    turns.push(backfillTurn(addDays(TODAY, -(400 - daysLeft) - 1), addDays(TODAY, -401), budget));
  }
  const present = turns.filter((x) => x === 3).length;
  assert.ok(present > 0, "a deep dig must reach the present at some point");
  const ratio = present / turns.length;
  assert.ok(ratio > 0.15 && ratio < 0.35,
    `expected roughly one run in four on the present, got ${present} of ${turns.length}`);
});

test("the trailing window rotates, so every day is refreshed across runs", () => {
  /*
   * Every run re-fetching the same window in the same order meant a run that
   * stopped early always stopped in the same place, and the far end of the
   * window was never reached at all. Rotation is what lets a run be small
   * enough to finish while still covering everything over time.
   */
  const week = ["2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-05","2026-09-06","2026-09-07"];
  const TICK = 15 * 60 * 1000;
  const seen = new Set();

  for (let i = 0; i < 12; i++) {
    const picked = rotatingWindow(week, 2, 2, i * TICK);
    assert.ok(picked.length <= 4, `a run must stay small; got ${picked.length}`);
    // The two newest are non-negotiable: they are what a client looks at and
    // the only days still changing.
    assert.ok(picked.includes("2026-09-06") && picked.includes("2026-09-07"),
      `the newest days must be in every run, got ${picked.join(",")}`);
    picked.forEach((d) => seen.add(d));
  }

  // And across a handful of runs, nothing is left behind.
  for (const d of week) {
    assert.ok(seen.has(d), `${d} was never refreshed by any run`);
  }
});

test("a truncated run keeps the NEWEST days, not the oldest", async () => {
  /*
   * A run can stop early for several reasons — the call budget, a throttle, a
   * timeout — and whatever it has not reached yet is what goes missing. The days
   * ran oldest-first, so the casualties were the most RECENT ones: the days a
   * client looks at, and the only days still changing.
   *
   * Dropping the oldest end of the trailing window instead costs nothing: those
   * days were stored by earlier runs, have settled, and are revisited next hour.
   */
  const from = addDays(TODAY, -29);
  const db = seedDb();
  const previous = process.env.IG_CALL_BUDGET;
  process.env.IG_CALL_BUDGET = "14";           // enough for a few days, not all
  try {
    const mock = installGraphMock({ offset: 3, days: [from, TODAY] });
    try { await syncAccount(db, account); } finally { mock.restore(); }
  } finally {
    process.env.IG_CALL_BUDGET = previous;
  }

  const dates = db._rows("metrics_daily")
    .filter((r) => r.views !== null || r.engagements !== null)
    .map((r) => r.date).sort();
  assert.ok(dates.length > 0, "a truncated run still stored something");

  // Whatever it managed, the newest day must be among it.
  assert.equal(dates[dates.length - 1], TODAY,
    `a truncated run must reach today; newest stored was ${dates[dates.length - 1]}`);
});

test("media is paged, not truncated at the first page", async () => {
  /*
   * The sync fetched one page of 25 and stopped. For an account with years of
   * output everything older was silently absent — no error, no note, just a gap
   * where last spring's campaign should be. The mock now returns a cursor and a
   * second page, which is what Instagram actually does.
   */
  const from = addDays(TODAY, -29);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });

  const ids = db._rows("content").map((r) => r.external_id);
  assert.ok(ids.includes("post_reported"), "first page stored");
  assert.ok(ids.includes("post_older"),
    "the SECOND page must be stored too — stopping at page one is the defect");
});

test("recent days are flagged provisional so the UI need not read them as a drop", async () => {
  const from = addDays(TODAY, -29);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });

  const rows = db._rows("metrics_daily");
  assert.equal(rows.find((r) => r.date === TODAY)?.provisional, true);
  assert.equal(rows.find((r) => r.date === addDays(TODAY, -10))?.provisional, false);
});

/* ---- the TikTok success envelope ---------------------------------------- */

test("a TikTok success response is not mistaken for an error", async () => {
  // Every TikTok v2 response carries error:{code:"ok"} on SUCCESS. Treating any
  // `error` key as a failure meant no TikTok metric was ever stored, while the
  // account still displayed as connected and healthy.
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = String(url).includes("/user/info/")
      ? { data: { user: { follower_count: 4321, likes_count: 9, video_count: 3 } }, error: { code: "ok", message: "", log_id: "1" } }
      : { data: { videos: [] }, error: { code: "ok", message: "", log_id: "2" } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const db = makeDb({
    account_secrets: [{ account_id: "tt-1", access_token: "PLAINTEXT", extra: {} }],
    social_accounts: [{ id: "tt-1", user_id: "u1", platform: "tiktok", external_id: "open123", username: "creator", status: "connected" }],
    metrics_daily: [],
  });
  try {
    await syncAccount(db, { id: "tt-1", platform: "tiktok", external_id: "open123", username: "creator" });
  } finally { globalThis.fetch = original; }

  const rows = db._rows("metrics_daily");
  assert.equal(rows.length, 1, "the day's follower count should be stored");
  assert.equal(rows[0].followers, 4321);
  // Lifetime video views are not a day's reach and must not be recorded as one.
  assert.equal(rows[0].reach, null);
});

/* ---- 0007: the day boundary belongs to the account, not to the platform ---- */

/**
 * The defect this guards, observed live on 2026-09-04.
 *
 * `offsetFrom()` read the account's UTC offset out of a time_series `end_time`.
 * A Jordanian account came back with `end_time: 2026-08-29T07:00:00+0000` —
 * midnight US PACIFIC, not midnight Amman. So the sync derived -7 and built
 * every per-day `total_value` window on a Pacific boundary. Nothing errored.
 * Every daily figure simply covered 10:00→10:00 Amman time while carrying a
 * label that said otherwise.
 *
 * Reading Meta's buckets from end_time is correct. DEFINING a day from them is
 * not, and the difference is invisible in the stored data — which is exactly the
 * failure mode this project treats as worse than an outage.
 */
test("day windows follow the account's timezone, not the platform's bucketing", async () => {
  const from = addDays(TODAY, -3);
  const db = seedDb();
  // The account keeps Amman days. The platform reports on US Pacific.
  const amman = { id: "acc-1", platform: "instagram", external_id: "1784100", username: "creator", tz_offset_minutes: 180 };
  const mock = installGraphMock({ offset: -7, days: [from, TODAY] });
  let calls;
  try { await syncAccount(db, amman); } finally { calls = mock.calls; mock.restore(); }

  const windows = calls
    .map((u) => new URL(u))
    .filter((u) => u.searchParams.get("metric_type") === "total_value" && u.searchParams.get("since"))
    .map((u) => Number(u.searchParams.get("since")));
  assert.ok(windows.length > 0, "expected per-day total_value windows to be requested");

  // Amman midnight is 21:00 UTC the previous day; Pacific midnight is 07:00 UTC.
  // The UTC hour of every window start says which boundary was used.
  for (const since of windows) {
    const hour = new Date(since * 1000).getUTCHours();
    assert.equal(hour, 21,
      `window starts at ${hour}:00 UTC — Amman days start at 21:00 UTC. ` +
      `07:00 means the platform's Pacific boundary was used instead of the account's.`);
  }
});

test("an account with no stored timezone falls back to Amman, never to the platform's", async () => {
  const from = addDays(TODAY, -3);
  const db = seedDb();
  // No tz_offset_minutes at all, and a platform reporting Pacific days.
  const unset = { id: "acc-1", platform: "instagram", external_id: "1784100", username: "creator" };
  const mock = installGraphMock({ offset: -7, days: [from, TODAY] });
  let calls;
  try { await syncAccount(db, unset); } finally { calls = mock.calls; mock.restore(); }

  const hours = calls
    .map((u) => new URL(u))
    .filter((u) => u.searchParams.get("metric_type") === "total_value" && u.searchParams.get("since"))
    .map((u) => new Date(Number(u.searchParams.get("since")) * 1000).getUTCHours());
  assert.ok(hours.length > 0, "expected per-day total_value windows to be requested");
  assert.ok(hours.every((h) => h === 21),
    "an unset timezone must default to the operator's own (+3), not silently inherit the platform's");
});

/* ---- 0008: the figures a sponsor actually asks about --------------------- */

/**
 * The net hides the business. "+20" and "gained 412, lost 392" are the same
 * number and completely different situations, and only the second one tells a
 * client they have a retention problem.
 *
 * Both figures were already being parsed out of the follows_and_unfollows
 * breakdown before 0008 and then discarded in favour of their difference.
 */
test("gross follows and unfollows are stored, not just the net", async () => {
  const from = addDays(TODAY, -29);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });

  const rows = db._rows("metrics_daily").filter((r) => r.follows !== null);
  assert.ok(rows.length >= 25, `expected gross follow figures, got ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.follows, trueValue("follows", r.date), `follows on ${r.date}`);
    assert.equal(r.unfollows, trueValue("unfollows", r.date), `unfollows on ${r.date}`);
    // The pair must reconstruct the net the follower line is built from, or the
    // two series on the dashboard would contradict each other.
    assert.equal(r.follows - r.unfollows, trueNetFollows(r.date), `net on ${r.date}`);
  }
});

/**
 * Reach among people who do NOT already follow the account is the half a sponsor
 * is buying. Meta returns FOLLOWER, NON_FOLLOWER and UNKNOWN, and the mock's
 * UNKNOWN bucket is non-zero on purpose: a parser that folded it into either
 * side would inflate that side and pass a laxer test.
 */
test("reach splits into followers and non-followers, and UNKNOWN is not folded in", async () => {
  const from = addDays(TODAY, -29);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });

  const rows = db._rows("metrics_daily").filter((r) => r.reach_non_followers !== null);
  assert.ok(rows.length >= 25, `expected a discovery split, got ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.reach_followers, trueValue("reach_followers", r.date), `follower reach on ${r.date}`);
    assert.equal(r.reach_non_followers, trueValue("reach_non_followers", r.date), `non-follower reach on ${r.date}`);
  }
});

/**
 * A breakdown that stops being returned must not erase what was already stored.
 * This is the `?? 0` defect in another costume: the failure writes nothing
 * rather than a zero, and the previously fetched value survives.
 */
test("a breakdown that disappears does not blank the stored discovery split", async () => {
  const from = addDays(TODAY, -6);
  const db = seedDb();
  await syncUntilCaughtUp(db, account, { offset: 3, days: [from, TODAY] });
  const before = db._rows("metrics_daily").filter((r) => r.reach_non_followers !== null).length;
  assert.ok(before > 0, "precondition: some discovery figures were stored");

  // Now the platform stops answering for reach entirely.
  const mock = installGraphMock({ offset: 3, days: [from, TODAY], failMetric: "reach" });
  try { await syncAccount(db, account); } catch { /* reach failing is allowed to throw */ }
  finally { mock.restore(); }

  const after = db._rows("metrics_daily").filter((r) => r.reach_non_followers !== null).length;
  assert.equal(after, before, "stored discovery figures must survive a failed re-fetch");
});
