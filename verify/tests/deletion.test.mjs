import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeDb } from "./fake-supabase.mjs";

process.env.GRAPH_BACKOFF_BASE_MS = "1";
process.env.OAUTH_STATE_SECRET = "test-state-secret-value";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_APP_SECRET = "test-app-secret";

const { verifySignedRequest, deleteEverythingForMetaUser } = await import("../build/meta-data-deletion.js");
const { deletionStatus } = await import("../build/_lib.js");

function signedRequest(payload, secret = "test-app-secret") {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${sig}.${body}`;
}

test("a genuine signed_request is accepted", () => {
  const out = verifySignedRequest(signedRequest({ user_id: "123", algorithm: "HMAC-SHA256" }), "test-app-secret");
  assert.equal(out?.user_id, "123");
});

test("a forged or tampered signed_request is rejected", () => {
  // Anyone can POST to this endpoint; the signature is the only thing that makes
  // it trustworthy, so it must be verified rather than parsed.
  assert.equal(verifySignedRequest(signedRequest({ user_id: "123" }, "wrong-secret"), "test-app-secret"), null);
  const good = signedRequest({ user_id: "123" });
  const [sig, body] = good.split(".");
  const tampered = Buffer.from(JSON.stringify({ user_id: "victim" })).toString("base64url");
  assert.equal(verifySignedRequest(`${sig}.${tampered}`, "test-app-secret"), null, "payload swap");
  assert.equal(verifySignedRequest(body, "test-app-secret"), null, "no signature");
  assert.equal(verifySignedRequest(`.${body}`, "test-app-secret"), null, "empty signature");
  assert.equal(verifySignedRequest(good, ""), null, "no app secret configured means no trust");
});

test("deletion actually removes the tokens, the accounts and the metrics", async () => {
  // Acknowledging a deletion request without deleting is both an App Review
  // failure and an enforcement risk.
  const db = makeDb({
    provider_identities: [{ id: "pi-1", provider: "meta", external_user_id: "fb-9", user_id: "u1" }],
    social_accounts: [
      { id: "a1", identity_id: "pi-1", user_id: "u1", platform: "instagram" },
      { id: "a2", identity_id: "pi-1", user_id: "u1", platform: "facebook" },
      { id: "other", identity_id: "pi-2", user_id: "u2", platform: "instagram" },
    ],
    account_secrets: [{ account_id: "a1", access_token: "T1" }, { account_id: "a2", access_token: "T2" }, { account_id: "other", access_token: "T3" }],
    metrics_daily: [{ account_id: "a1", date: "2026-08-01" }, { account_id: "other", date: "2026-08-01" }],
    content: [{ account_id: "a1", external_id: "p1" }],
    audience_snapshots: [{ account_id: "a1", captured_on: "2026-08-01" }],
  });

  const { deleted, failed } = await deleteEverythingForMetaUser(db, "fb-9");
  assert.equal(deleted, 2);
  assert.equal(failed, 0);

  assert.deepEqual(db._rows("social_accounts").map((r) => r.id), ["other"], "only this user's accounts go");
  assert.deepEqual(db._rows("account_secrets").map((r) => r.account_id), ["other"], "tokens deleted");
  assert.deepEqual(db._rows("metrics_daily").map((r) => r.account_id), ["other"], "metrics deleted");
  assert.equal(db._rows("content").length, 0);
  assert.equal(db._rows("audience_snapshots").length, 0);
  assert.equal(db._rows("provider_identities").length, 0);
});

test("a deletion request for an unknown user reports nothing deleted", async () => {
  const db = makeDb({ provider_identities: [], social_accounts: [] });
  assert.deepEqual(await deleteEverythingForMetaUser(db, "nobody"), { deleted: 0, failed: 0 });
});

test("a deletion that could not delete reports the failure, not a count", async () => {
  /*
   * The count alone cannot tell an erasure that worked from one where every
   * delete was refused: the loop reaches the end either way, and supabase-js
   * resolves rather than throws, so `deleted` is 1 in both cases.
   *
   * This is the difference between a confirmation code that means something and
   * one that closes a data subject's request against data we still hold —
   * which the suite's own comment above calls an App Review failure and an
   * enforcement risk.
   */
  const db = makeDb({
    provider_identities: [{ id: "pi-1", provider: "meta", external_user_id: "fb-9", user_id: "u1" }],
    social_accounts: [{ id: "a1", identity_id: "pi-1", user_id: "u1", platform: "instagram" }],
    metrics_daily: [{ account_id: "a1", date: "2026-08-01" }],
  }, { failWrites: { metrics_daily: { code: "42501", message: "permission denied for table metrics_daily" } } });

  const { deleted, failed } = await deleteEverythingForMetaUser(db, "fb-9");
  assert.equal(deleted, 1, "the account itself did go");
  assert.ok(failed > 0, "and the refused delete is counted, not absorbed");
  assert.equal(db._rows("metrics_daily").length, 1, "the data really is still there");
});

/* ---- what the request row is allowed to claim ---------------------------- */

test("a failure outranks every other status", () => {
  /*
   * There is no "partly deleted" for a data subject: either their data is gone
   * or it is not. A row that says 'completed' over rows the database refused
   * closes the request, issues a confirmation code, and tells the person their
   * data is gone while we still hold it.
   */
  assert.equal(deletionStatus(true, 0), "completed");
  assert.equal(deletionStatus(false, 0), "not_found", "holding nothing is not a refusal");
  assert.equal(deletionStatus(true, 1), "failed", "one refused write is enough");
  assert.equal(deletionStatus(false, 1), "failed", "and it outranks 'nothing to delete' too");
});
