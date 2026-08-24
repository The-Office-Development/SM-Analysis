import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeDb } from "./fake-supabase.mjs";

process.env.GRAPH_BACKOFF_BASE_MS = "1";
process.env.OAUTH_STATE_SECRET = "test-state-secret-value";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_APP_SECRET = "test-app-secret";

const { verifySignedRequest, deleteEverythingForMetaUser } = await import("../build/meta-data-deletion.js");

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

  const deleted = await deleteEverythingForMetaUser(db, "fb-9");
  assert.equal(deleted, 2);

  assert.deepEqual(db._rows("social_accounts").map((r) => r.id), ["other"], "only this user's accounts go");
  assert.deepEqual(db._rows("account_secrets").map((r) => r.account_id), ["other"], "tokens deleted");
  assert.deepEqual(db._rows("metrics_daily").map((r) => r.account_id), ["other"], "metrics deleted");
  assert.equal(db._rows("content").length, 0);
  assert.equal(db._rows("audience_snapshots").length, 0);
  assert.equal(db._rows("provider_identities").length, 0);
});

test("a deletion request for an unknown user reports nothing deleted", async () => {
  const db = makeDb({ provider_identities: [], social_accounts: [] });
  assert.equal(await deleteEverythingForMetaUser(db, "nobody"), 0);
});
