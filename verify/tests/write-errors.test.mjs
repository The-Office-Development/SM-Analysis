import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccount } from "../build/_sync.js";
import { makeDb } from "./fake-supabase.mjs";
import { installLinkedInMock, ORG_ID, addDays } from "./mock-linkedin.mjs";

/**
 * A write that fails must not pass in silence.
 *
 * supabase-js does not throw on a PostgREST error. `.upsert()` resolves with
 * `{ data: null, error }` and the next line runs, so a call site that never
 * reads `error` treats an unapplied migration, a revoked grant, an RLS refusal
 * and a constraint violation as success. Nothing is stored and nothing anywhere
 * records that.
 *
 * The audience snapshot was the live example, and it is the one asserted here.
 * Migration 0015 adds `dimensions` to `audience_snapshots`; until it is applied
 * PostgREST rejects every snapshot carrying that column with 42703, so the
 * LinkedIn demographics were fetched at the cost of four calls and discarded.
 * What the client sees is an empty Audience page — which is exactly what a
 * platform that reported nothing looks like. That ambiguity is the defect: the
 * product cannot tell "we have no data" from "we threw the data away".
 *
 * These tests assert on the LOG, not on the database, because a refused write
 * leaves the database identical either way. The log line is the only difference
 * between the fixed code and the defect.
 */

process.env.TOKEN_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.GRAPH_BACKOFF_BASE_MS = "1";

const TODAY = new Date().toISOString().slice(0, 10);
const FROM = addDays(TODAY, -9);
const account = { id: "li-1", platform: "linkedin", external_id: ORG_ID, username: "drinkat" };

function seedDb(opts) {
  return makeDb({
    account_secrets: [{ account_id: "li-1", access_token: "PLAINTEXT_TOKEN", extra: { kind: "li_organization" } }],
    social_accounts: [{ id: "li-1", user_id: "u1", platform: "linkedin", external_id: ORG_ID, username: "drinkat", status: "connected" }],
    metrics_daily: [],
    content: [],
  }, opts);
}

/** Run one sync, capturing every structured log line it emits. */
async function syncCapturingLogs(db) {
  const lines = [];
  const real = console.log;
  console.log = (s) => { try { lines.push(JSON.parse(s)); } catch { /* not ours */ } };
  const mock = installLinkedInMock({ days: [FROM, TODAY] });
  try { await syncAccount(db, account); }
  finally { mock.restore(); console.log = real; }
  return lines;
}

const events = (lines) => lines.map((l) => l.event);

test("a refused audience write is reported, not swallowed", async () => {
  const db = seedDb({ failWrites: { audience_snapshots: true } });
  const lines = await syncCapturingLogs(db);

  assert.equal(db._rows("audience_snapshots").length, 0, "the fake must actually refuse the write");

  const failure = lines.find((l) => l.event === "sync.audience_write_failed");
  assert.ok(failure, `no failure logged. Events seen: ${events(lines).join(", ") || "(none)"}`);
  // The message the database gave is what turns "the Audience page is empty"
  // into "migration 0015 has not been applied". Without it the log says only
  // that something went wrong, which is barely better than saying nothing.
  assert.match(String(failure.detail), /dimensions/, "the database's own message must survive into the log");
  assert.equal(failure.pg_code, "42703");
  assert.equal(failure.account, "li-1");
});

test("the rest of the sync still completes when the snapshot is refused", async () => {
  /*
   * Deliberately NOT a throw.
   *
   * Demographics are optional and permission-gated — the surrounding catch in
   * syncAccount says so — and taking down the day metrics and the posts because
   * a snapshot could not be stored would turn a blank Audience panel into a
   * blank dashboard. Observable, not fatal.
   */
  const db = seedDb({ failWrites: { audience_snapshots: true } });
  await syncCapturingLogs(db);

  assert.ok(db._rows("metrics_daily").length > 0, "day metrics are still written");
  assert.ok(db._rows("content").length > 0, "posts are still written");
});

test("a successful sync logs no write failure at all", async () => {
  // The negative half of the assertion above: without it, code that logged the
  // failure unconditionally would pass every test in this file.
  const db = seedDb();
  const lines = await syncCapturingLogs(db);

  assert.equal(db._rows("audience_snapshots").length, 1, "the snapshot is stored when nothing refuses it");
  assert.deepEqual(events(lines).filter((e) => e.endsWith("_write_failed")), []);
});

test("a lost last_synced_at is reported too", async () => {
  /*
   * The same defect one table over. `last_synced_at` is what the manual-sync
   * throttle and the "updated N minutes ago" line both read, so losing it means
   * a sync that ran and a product that cannot tell.
   */
  const db = seedDb({ failWrites: { social_accounts: { code: "42501", message: "permission denied for table social_accounts" } } });
  const lines = await syncCapturingLogs(db);

  const failure = lines.find((l) => l.event === "sync.last_synced_write_failed");
  assert.ok(failure, `no failure logged. Events seen: ${events(lines).join(", ") || "(none)"}`);
  assert.match(String(failure.detail), /permission denied/);
});
