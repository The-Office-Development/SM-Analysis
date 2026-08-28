import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccount, dayKeyFromEndTime, syncStart, seriesFrom } from "../build/_sync.js";
import { makeDb } from "./fake-supabase.mjs";
import { installGraphMock, trueValue, trueNetFollows, addDays } from "./mock-graph.mjs";

process.env.GRAPH_BACKOFF_BASE_MS = "1";
process.env.TOKEN_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
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

for (const [label, offset] of [["Amman (+3)", 3], ["Los Angeles (-7)", -7], ["UTC", 0], ["Tokyo (+9)", 9]]) {
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
  // No account-level interactions and no posts to fall back on: engagements is
  // unknown. Zero would claim the account had no engagement at all.
  assert.ok(rows.every((r) => r.engagements === null || r.engagements === 0));
  assert.ok(rows.every((r) => r.reach === trueValue("reach", r.date)), "other metrics still stored");
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
