import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";

/**
 * The scheduled sync's queue.
 *
 * Measured 2026-09-18 from the Worker's own log: each 15-minute firing synced
 * one account and FAILED the next with "Too many subrequests by single Worker
 * invocation" (50 on Cloudflare's free plan; one account spends ~27 calls plus
 * database work). The sync_log write failed with it, so the table showed zero
 * failures while half of all runs failed. Now: every minute, one due account.
 *
 * What these protect is mostly fairness. With one account per run, whatever
 * decides "who is next" decides who is never synced at all.
 */
const { runDue, DUE_AFTER_MS } = await import("../build/sync-cron.js");

const NOW = Date.parse("2026-09-19T12:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();

function db(accounts, extra = {}) {
  return makeDb({
    social_accounts: accounts.map((a) => ({ status: "connected", platform: "instagram", user_id: "u1", ...a })),
    sync_log: [],
    ...extra,
  });
}

function runner(outcomes = {}) {
  const ran = [];
  return {
    ran,
    runOne: async (_db, acc) => { ran.push(acc.id); return outcomes[acc.id] ?? { ok: true }; },
  };
}

test("one account per run, and it is the one that has waited longest", async () => {
  const d = db([
    { id: "recent", sync_turn_at: ago(20) },
    { id: "oldest", sync_turn_at: ago(90) },
    { id: "middle", sync_turn_at: ago(40) },
  ]);
  const r = runner();
  await runDue(d, r.runOne, NOW);
  assert.deepEqual(r.ran, ["oldest"], "exactly one, the longest-waiting; a second would hit the 50-subrequest cap");
});

test("an account that has never had a turn goes first", async () => {
  const d = db([{ id: "old", sync_turn_at: ago(500) }, { id: "new", sync_turn_at: null }]);
  const r = runner();
  await runDue(d, r.runOne, NOW);
  assert.deepEqual(r.ran, ["new"]);
});

test("an account whose turn is not yet due is left alone, and an idle minute runs nothing", async () => {
  const d = db([{ id: "a", sync_turn_at: ago(5) }, { id: "b", sync_turn_at: ago(14) }]);
  const r = runner();
  const res = await runDue(d, r.runOne, NOW);
  assert.deepEqual(r.ran, []);
  assert.equal(res.statusCode, 200, "nothing due is healthy, not a failure");
});

test("the turn is taken BEFORE the run, so a run that dies still goes to the back", async () => {
  const d = db([{ id: "broken", sync_turn_at: ago(60) }, { id: "healthy", sync_turn_at: ago(30) }]);
  const dying = async () => { throw new Error("Too many subrequests by single Worker invocation"); };
  await runDue(d, dying, NOW).catch(() => {});
  const broken = d._rows("social_accounts").find((a) => a.id === "broken");
  assert.equal(broken.sync_turn_at, new Date(NOW).toISOString(), "its turn was recorded even though the run died");

  // A minute later the healthy account gets its go, rather than the broken one again.
  const r = runner();
  await runDue(d, r.runOne, NOW + 60_000);
  assert.deepEqual(r.ran, ["healthy"], "a failing account cannot take every slot");
});

test("a failing account does not starve the others across many minutes", async () => {
  const d = db([
    { id: "always-fails", sync_turn_at: null },
    { id: "a", sync_turn_at: null },
    { id: "b", sync_turn_at: null },
  ]);
  const r = runner({ "always-fails": { ok: false, code: "error" } });
  // Fifteen minutes of firings, one a minute.
  for (let m = 0; m < 15; m++) await runDue(d, r.runOne, NOW + m * 60_000);
  for (const id of ["a", "b", "always-fails"]) {
    assert.ok(r.ran.includes(id), `${id} never got a turn: ${r.ran.join(",")}`);
  }
  assert.equal(r.ran.filter((id) => id === "always-fails").length, 1,
    "and the failing one is retried once its turn is due again, not every minute");
});

test("a LinkedIn page held back by its daily call limit uses its turn without blocking the queue", async () => {
  const d = db(
    [{ id: "li", platform: "linkedin", sync_turn_at: null }, { id: "ig", sync_turn_at: ago(30) }],
    { sync_log: [{ account_id: "li", started_at: ago(10) }] },   // synced 10 minutes ago: not due for hours
  );
  const r = runner();
  await runDue(d, r.runOne, NOW);
  assert.deepEqual(r.ran, ["ig"], "the Instagram account behind it still runs this minute");
  assert.ok(d._rows("social_accounts").find((a) => a.id === "li").sync_turn_at, "and the page is not re-examined every minute");
});

test("only connected accounts are queued", async () => {
  const d = db([{ id: "gone", status: "expired", sync_turn_at: null }, { id: "live", sync_turn_at: ago(60) }]);
  const r = runner();
  await runDue(d, r.runOne, NOW);
  assert.deepEqual(r.ran, ["live"]);
});

test("the due interval is fifteen minutes, which is what a story's 24 hours are budgeted on", () => {
  assert.equal(DUE_AFTER_MS, 15 * 60_000);
});
