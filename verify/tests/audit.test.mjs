import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";

/**
 * The security audit log (migration 0023; Meta DPA 3.1-22).
 *
 * Writing it found two endpoints that told people their data was handled
 * when it might not have been: disconnect said "stored data deleted" after
 * refused deletes, and deauthorize counted an account as stopped after its
 * credential delete was refused. Both are pinned here.
 */
process.env.OAUTH_STATE_SECRET = "test-state-secret-value";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.HEALTH_KEY = "k";

const lib = await import("../build/_lib.js");
const A = await import("../build/_audit.js");
const { handler: disconnect } = await import("../build/disconnect.js");
const { assess } = await import("../build/health.js");

const rows = (db) => db._rows("audit_log");
const withDb = async (db, fn) => { lib.__setAdminForTests(db); try { return await fn(); } finally { lib.__setAdminForTests(null); } };

test("a credential-looking key never reaches an audit row", () => {
  assert.deepEqual(A.cleanDetail({ access_token: "x", appsecret_proof: "y", code: "ok", reason: "denied" }),
    { code: "ok", reason: "denied" });
});

test("a refused audit write never blocks or breaks the action it describes", async () => {
  const db = makeDb({}, { failWrites: { audit_log: "permission denied" } });
  await A.audit(db, "disconnect", "success", { user_id: "u1" });   // must not throw
  assert.equal(rows(db).length, 0);
});

/* ---------- every exit of a connect callback is recorded ---------- */

function signed(uid) {
  const n = lib.newNonce();
  return { state: lib.signState({ uid, n }), cookie: `${lib.STATE_COOKIE}=${n}` };
}
const redirectTo = (loc) => async () => ({ statusCode: 302, headers: { Location: loc }, body: "" });

test("a successful connect is recorded with the VERIFIED user id", async () => {
  const db = makeDb({});
  const { state, cookie } = signed("u1");
  const h = A.auditedCallback("instagram", redirectTo("https://app.x/connections?connected=instagram"));
  await withDb(db, () => h({ httpMethod: "GET", headers: { cookie }, queryStringParameters: { state } }));
  const r = rows(db)[0];
  assert.equal(r.event, "connect"); assert.equal(r.outcome, "success"); assert.equal(r.user_id, "u1"); assert.equal(r.platform, "instagram");
});

test("an error redirect is a recorded failure with its reason", async () => {
  const db = makeDb({});
  const { state, cookie } = signed("u1");
  const h = A.auditedCallback("linkedin", redirectTo("https://app.x/connections?error=linkedin_no_admin_page"));
  await withDb(db, () => h({ httpMethod: "GET", headers: { cookie }, queryStringParameters: { state } }));
  assert.equal(rows(db)[0].outcome, "failure");
  assert.equal(rows(db)[0].detail.reason, "linkedin_no_admin_page");
});

test("a forged or replayed state records NO user id rather than a claimed one", async () => {
  const db = makeDb({});
  const { state } = signed("victim");
  const h = A.auditedCallback("instagram", redirectTo("https://app.x/connections?error=bad_state"));
  await withDb(db, () => h({ httpMethod: "GET", headers: { cookie: `${lib.STATE_COOKIE}=someone-elses-nonce` }, queryStringParameters: { state } }));
  assert.equal(rows(db)[0].user_id, null);
});

test("a callback that throws is recorded, and still throws", async () => {
  const db = makeDb({});
  const h = A.auditedCallback("tiktok", async () => { throw new Error("boom"); });
  await assert.rejects(withDb(db, () => h({ httpMethod: "GET", headers: {}, queryStringParameters: {} })));
  assert.equal(rows(db)[0].outcome, "failure");
});

/* ---------- disconnect tells the truth ---------- */

function disconnectDb(opts) {
  return makeDb({
    social_accounts: [{ id: "a1", user_id: "u1", platform: "instagram", username: "someone", identity_id: null }],
    account_secrets: [{ account_id: "a1", access_token: "enc" }],
    metrics_daily: [{ account_id: "a1", date: "2026-09-18" }], content: [], audience_snapshots: [],
  }, { users: { "t": "u1" }, ...opts });
}
const pressDisconnect = (db) => withDb(db, () => disconnect({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ account_id: "a1" }) }));

test("disconnect says 'deleted' only when the deletes succeeded", async () => {
  const db = disconnectDb({ failWrites: { metrics_daily: "permission denied" } });
  const res = await pressDisconnect(db);
  assert.equal(res.statusCode, 500, "a refused delete is not reported as deleted");
  assert.doesNotMatch(JSON.parse(res.body).message, /data deleted/);
  const r = rows(db).find((x) => x.event === "disconnect");
  assert.equal(r.outcome, "failure");
  assert.deepEqual(r.detail.tables_not_deleted, ["metrics_daily"]);
  assert.equal(A.isAlarming(r), true, "and a person is paged");
});

test("a clean disconnect is a recorded success", async () => {
  const db = disconnectDb({});
  const res = await pressDisconnect(db);
  assert.equal(res.statusCode, 200);
  assert.equal(rows(db).find((x) => x.event === "disconnect").outcome, "success");
});

/* ---------- what pages a person, and what does not ---------- */

test("alarms are narrow: rights failures and unmatched Meta requests, not a cancelled consent", () => {
  assert.equal(A.isAlarming({ event: "connect", outcome: "failure", detail: { reason: "denied" } }), false);
  assert.equal(A.isAlarming({ event: "token.refresh", outcome: "failure" }), false);
  assert.equal(A.isAlarming({ event: "account.delete", outcome: "failure" }), true);
  assert.equal(A.isAlarming({ event: "platform.deletion_request", outcome: "success", detail: { status: "not_found" } }), true);
  assert.equal(A.isAlarming({ event: "platform.deauthorize", outcome: "success", detail: { matched: false } }), true);
  assert.equal(A.isAlarming({ event: "platform.deletion_request", outcome: "success", detail: { status: "completed" } }), false);
});

/* ---------- retention and the weekly review ---------- */

const NOW = Date.now();
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

test("the weekly review runs when due, counts the week, and records that it ran", async () => {
  const db = makeDb({ audit_log: [
    { event: "connect", outcome: "success", at: daysAgo(2) },
    { event: "account.delete", outcome: "failure", at: daysAgo(1) },
    { event: "connect", outcome: "success", at: daysAgo(30) },          // outside the week
  ] });
  assert.equal(await A.weeklyReview(db, NOW), "reviewed");
  const rev = rows(db).find((x) => x.event === "audit.weekly_review");
  assert.equal(rev.detail.events, 2);
  assert.equal(rev.detail.alarming, 1);
  assert.equal(await A.weeklyReview(db, NOW + 3_600_000), "not_due", "not twice in a week");
});

test("the purge removes only rows past 90 days", async () => {
  const db = makeDb({ audit_log: [{ event: "old", outcome: "success", at: daysAgo(91) }, { event: "new", outcome: "success", at: daysAgo(89) }] });
  assert.equal(await A.purgeAudit(db, NOW), true);
  assert.deepEqual(rows(db).map((r) => r.event), ["new"]);
});

/* ---------- health reads the audit log ---------- */

const healthy = [{ platform: "instagram", status: "connected", connected_at: daysAgo(10), last_synced_at: daysAgo(0.01), sync_turn_at: daysAgo(0.005) }];

test("an alarming event in the last 24 hours turns health red", async () => {
  const db = makeDb({ social_accounts: healthy, audit_log: [
    { event: "platform.deletion_request", outcome: "success", detail: { status: "not_found" }, at: daysAgo(0.2) },
    { event: "audit.weekly_review", outcome: "success", at: daysAgo(1) },
  ] });
  const r = await assess(db, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.detail.security_alarms_24h, 1);
});

test("a weekly review that has stopped running turns health red", async () => {
  const db = makeDb({ social_accounts: healthy, audit_log: [{ event: "audit.weekly_review", outcome: "success", at: daysAgo(9) }] });
  assert.equal((await assess(db, NOW)).ok, false);
});

test("a young audit log is not yet owed a review, so a new deployment is not red", async () => {
  const db = makeDb({ social_accounts: healthy, audit_log: [{ event: "connect", outcome: "success", at: daysAgo(2) }] });
  assert.equal((await assess(db, NOW)).ok, true);
});

/* ---------- the two other promises the audit log makes true ---------- */

import crypto from "node:crypto";
process.env.INSTAGRAM_APP_SECRET = "test-instagram-secret";
const { handler: deauthorize } = await import("../build/meta-deauthorize.js");
const { handler: accountData } = await import("../build/account-data.js");

function signedRequest(payload, secret) {
  const body = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", ...payload })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${sig}.${body}`;
}

test("deauthorize: a refused credential delete is a recorded failure, not 'ok'", async () => {
  const db = makeDb({
    provider_identities: [{ id: "i1", provider: "instagram", external_user_id: "1784" }],
    social_accounts: [{ id: "a1", identity_id: "i1", status: "connected" }],
    account_secrets: [{ account_id: "a1", access_token: "enc" }],
  }, { failWrites: { account_secrets: "permission denied" } });
  const body = "signed_request=" + encodeURIComponent(signedRequest({ user_id: "1784" }, "test-instagram-secret"));
  const res = await withDb(db, () => deauthorize({ httpMethod: "POST", headers: {}, body }));
  assert.equal(JSON.parse(res.body).ok, false, "the credential the person withdrew is still held");
  const r = rows(db).find((x) => x.event === "platform.deauthorize");
  assert.equal(r.outcome, "failure");
  assert.equal(A.isAlarming(r), true);
});

test("deauthorize matching nobody is recorded, because it is the untested id question", async () => {
  const db = makeDb({ provider_identities: [] });
  const body = "signed_request=" + encodeURIComponent(signedRequest({ user_id: "999" }, "test-instagram-secret"));
  await withDb(db, () => deauthorize({ httpMethod: "POST", headers: {}, body }));
  const r = rows(db).find((x) => x.event === "platform.deauthorize");
  assert.equal(r.detail.matched, false);
  assert.equal(A.isAlarming(r), true);
});

test("account deletion: 'we have been alerted' is backed by an alarm", async () => {
  const db = makeDb({ social_accounts: [], goals: [], report_shares: [], consents: [] }, { users: { t: "u1" } });
  db.auth.admin.deleteUser = async () => ({ data: null, error: { message: "refused" } });
  const res = await withDb(db, () => accountData({ httpMethod: "DELETE", headers: { authorization: "Bearer t" } }));
  assert.match(JSON.parse(res.body).message, /alerted/);
  const r = rows(db).find((x) => x.event === "account.delete");
  assert.equal(r.outcome, "failure");
  assert.equal(A.isAlarming(r), true, "the message claims someone was alerted; this is what alerts them");
});
