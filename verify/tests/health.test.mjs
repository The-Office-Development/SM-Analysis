import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";

/**
 * /api/health, for an uptime monitor.
 *
 * Built because of 2026-09-18: half of all scheduled syncs had been failing for
 * at least a week while sync_log recorded nothing (the failure was running out
 * of subrequests, and so was the log write). So it judges by outcomes (last
 * SUCCESS, the cron's last turn), never by the log.
 */
process.env.HEALTH_KEY = "test-health-key";
const lib = await import("../build/_lib.js");
const { handler, assess, staleAfterMs, CRON_SILENT_MS } = await import("../build/health.js");

// The handler reads the real clock, so the data is anchored to it too. A pinned
// date made "5 hours ago" a time in the future and the red case read green.
const NOW = Date.now();
const min = (m) => new Date(NOW - m * 60_000).toISOString();
const acct = (o) => ({ platform: "instagram", status: "connected", connected_at: min(60 * 24 * 10), last_synced_at: min(10), sync_turn_at: min(5), ...o });

test("a healthy estate is ok", async () => {
  const r = await assess(makeDb({ social_accounts: [acct({}), acct({})] }), NOW);
  assert.equal(r.ok, true, r.reasons.join("; "));
});

test("the 2026-09-18 failure: turns keep being taken, but an account never SUCCEEDS", async () => {
  // Exactly what sync_log could not show: the cron runs, the account's turn
  // moves every 15 minutes, and its last success falls further behind.
  const r = await assess(makeDb({ social_accounts: [
    acct({}),
    acct({ last_synced_at: min(60 * 5), sync_turn_at: min(2) }),
  ] }), NOW);
  assert.equal(r.ok, false);
  assert.equal(r.detail.stale, 1);
});

test("a stopped cron is caught even when every account's last success is still recent", async () => {
  const r = await assess(makeDb({ social_accounts: [acct({ last_synced_at: min(40), sync_turn_at: min(40) })] }), NOW);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /scheduled sync/.test(x)));
  assert.ok(40 * 60_000 > CRON_SILENT_MS);
});

test("a brand-new connection gets its grace from when it was connected, not an instant red", async () => {
  const r = await assess(makeDb({ social_accounts: [acct({ last_synced_at: null, connected_at: min(3), sync_turn_at: min(2) })] }), NOW);
  assert.equal(r.ok, true);
});

test("a connection that NEVER syncs does go red once its grace is up", async () => {
  const r = await assess(makeDb({ social_accounts: [acct({ last_synced_at: null, connected_at: min(60 * 6), sync_turn_at: min(2) })] }), NOW);
  assert.equal(r.ok, false);
});

test("a LinkedIn page on its slower schedule is not called stale at Instagram's pace", async () => {
  const r = await assess(makeDb({ social_accounts: [acct({ platform: "linkedin", last_synced_at: min(60 * 5) })] }), NOW);
  assert.equal(r.ok, true, "5 hours is inside three of LinkedIn's 4-hour turns");
  assert.ok(staleAfterMs("linkedin", 1) > staleAfterMs("instagram", 1));
});

test("the window widens as accounts are added, since each waits longer for its turn", () => {
  assert.equal(staleAfterMs("instagram", 1), 2 * 3_600_000, "the floor");
  assert.equal(staleAfterMs("instagram", 60), 3 * 60 * 60_000, "60 accounts: a turn an hour, stale after three");
});

test("an account the client must reconnect is reported but does not turn the check red", async () => {
  const r = await assess(makeDb({ social_accounts: [acct({}), acct({ status: "expired", last_synced_at: min(60 * 48) })] }), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.detail.needs_reconnect, 1);
});

test("an unreadable database is a failure, not an empty estate", async () => {
  const broken = makeDb({});
  broken.from = () => ({ select: async () => ({ data: null, error: { message: "boom" } }) });
  const r = await assess(broken, NOW);
  assert.equal(r.ok, false);
});

async function hit(db, query = {}) {
  lib.__setAdminForTests(db);
  try { return await handler({ httpMethod: "GET", headers: {}, queryStringParameters: query }); }
  finally { lib.__setAdminForTests(null); }
}

test("red is a 503 the monitor can see, and nothing is cached", async () => {
  const res = await hit(makeDb({ social_accounts: [acct({ last_synced_at: min(60 * 5) })] }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("without the key, the public answer is only ok or not", async () => {
  const res = await hit(makeDb({ social_accounts: [acct({}), acct({})] }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true }, "no counts, no reasons, no identifiers for strangers");
});

test("with the key, the operator gets counts and reasons, and still never an account id or name", async () => {
  const res = await hit(makeDb({ social_accounts: [acct({ id: "acc-secret", username: "malekismaiil" })] }), { key: "test-health-key" });
  const body = JSON.parse(res.body);
  assert.equal(body.connected, 1);
  assert.ok(!res.body.includes("acc-secret") && !res.body.includes("malekismaiil"));
});

test("a wrong key gets the public answer, not the detail", async () => {
  const res = await hit(makeDb({ social_accounts: [acct({})] }), { key: "nope" });
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});
