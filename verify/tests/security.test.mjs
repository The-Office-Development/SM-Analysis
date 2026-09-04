import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";

process.env.GRAPH_BACKOFF_BASE_MS = "1";
process.env.OAUTH_STATE_SECRET = "test-state-secret-value";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_APP_SECRET = "test-app-secret";

const lib = await import("../build/_lib.js");

/* ---- the OAuth account-takeover ----------------------------------------- */

test("a signed state is worthless without the matching browser cookie", () => {
  // The attack: sign up, read your OWN state out of the URL, send the victim a
  // platform dialog carrying it. The signature is valid, so the callback used to
  // trust state.uid and file the victim's Pages under the attacker's tenant.
  const nonce = lib.newNonce();
  const state = lib.signState({ uid: "attacker", provider: "meta", n: nonce });

  assert.equal(lib.verifyState(state, undefined), null, "no cookie must be rejected");
  assert.equal(lib.verifyState(state, "some-other-nonce"), null, "a different browser must be rejected");
  assert.equal(lib.verifyState(state, nonce)?.uid, "attacker", "the originating browser still works");
});

test("a tampered or truncated state is rejected without throwing", () => {
  const nonce = lib.newNonce();
  const state = lib.signState({ uid: "u1", provider: "meta", n: nonce });
  const [body, sig] = state.split(".");
  assert.equal(lib.verifyState(`${body}.${sig}x`, nonce), null, "extended signature");
  assert.equal(lib.verifyState(`${body}.`, nonce), null, "empty signature");
  assert.equal(lib.verifyState(body, nonce), null, "no dot");
  assert.equal(lib.verifyState(`${body}.${"A".repeat(sig.length)}`, nonce), null, "same-length forgery");
});

test("signing fails closed when the state secret is unset", () => {
  const saved = process.env.OAUTH_STATE_SECRET;
  delete process.env.OAUTH_STATE_SECRET;
  try {
    assert.throws(() => lib.signState({ uid: "u1", n: "n" }), /OAUTH_STATE_SECRET/);
  } finally { process.env.OAUTH_STATE_SECRET = saved; }
});

/* ---- tenant isolation ---------------------------------------------------- */

test("an account already owned by another tenant cannot be attached", async () => {
  const db = makeDb({
    social_accounts: [{ id: "a1", user_id: "victim", platform: "instagram", external_id: "IG123", username: "victim", status: "connected" }],
    account_secrets: [],
  });
  await assert.rejects(
    () => lib.saveAccount(db, "attacker", { platform: "instagram", external_id: "IG123", username: "x" }, { access_token: "t" }),
    (e) => e instanceof lib.AccountOwnedByAnotherTenant,
  );
  assert.equal(db._rows("social_accounts").length, 1, "no second row was created");
  assert.equal(db._rows("social_accounts")[0].user_id, "victim", "ownership unchanged");
});

test("the same tenant reconnecting the same account is allowed", async () => {
  const db = makeDb({
    social_accounts: [{ id: "a1", user_id: "u1", platform: "instagram", external_id: "IG123", username: "me", status: "expired" }],
    account_secrets: [],
  });
  await lib.saveAccount(db, "u1", { platform: "instagram", external_id: "IG123", username: "me" }, { access_token: "t" });
  assert.equal(db._rows("social_accounts")[0].status, "connected");
});

/* ---- tokens at rest ------------------------------------------------------ */

test("tokens round-trip through encryption and are not stored in the clear", () => {
  const plain = "EAAG_a_real_looking_page_token";
  const enc = lib.encryptToken(plain);
  assert.notEqual(enc, plain);
  assert.ok(!enc.includes(plain), "ciphertext must not contain the token");
  assert.equal(lib.decryptToken(enc), plain);
  assert.notEqual(lib.encryptToken(plain), enc, "each encryption uses a fresh IV");
});

test("rows written before encryption are still readable", () => {
  assert.equal(lib.decryptToken("legacy-plaintext-token"), "legacy-plaintext-token");
});

test("a tampered ciphertext fails rather than returning garbage", () => {
  const enc = lib.encryptToken("secret");
  const broken = enc.slice(0, -4) + "AAAA";
  assert.throws(() => lib.decryptToken(broken));
});

/* ---- error classification ------------------------------------------------ */

test("auth and throttle errors are told apart by code, not by message text", () => {
  const deprecation = new lib.GraphError("(#100) token is not a valid metric for this endpoint", { code: 100 });
  assert.equal(lib.isAuthError(deprecation), false, "a message containing 'token' is not an auth failure");
  assert.equal(lib.isAuthError(new lib.GraphError("expired", { code: 190 })), true);
  assert.equal(lib.isThrottleError(new lib.GraphError("slow down", { code: 4 })), true);
  assert.equal(lib.isThrottleError(new lib.GraphError("too many", { status: 429 })), true);
});

/* ---- redaction ----------------------------------------------------------- */

test("logging never emits token material", () => {
  const lines = [];
  const original = console.log;
  console.log = (l) => lines.push(l);
  try {
    lib.log("test.event", { access_token: "SECRET", appsecret_proof: "SECRET", account: "acc-1" });
  } finally { console.log = original; }
  assert.ok(!lines.join("").includes("SECRET"), "token material leaked into logs");
  assert.ok(lines.join("").includes("acc-1"), "non-sensitive fields still logged");
});

/* ---- deploy-preview credential guard ------------------------------------ */

test("a deploy preview refuses to use production database credentials", async () => {
  // Netlify env vars are global by default, so a preview build otherwise runs
  // with the production service-role key against production data.
  const saved = { ctx: process.env.CONTEXT, allow: process.env.ALLOW_NONPROD_DB,
                  url: process.env.VITE_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  delete process.env.ALLOW_NONPROD_DB;
  const fresh = await import(`../build/_lib.js?ctx=${Date.now()}`);
  try {
    process.env.CONTEXT = "deploy-preview";
    assert.throws(() => fresh.admin(), /Refusing to use these Supabase credentials/);
    process.env.CONTEXT = "branch-deploy";
    assert.throws(() => fresh.admin(), /Refusing/);
    process.env.ALLOW_NONPROD_DB = "1";
    assert.doesNotThrow(() => fresh.admin(), "an explicitly-configured non-prod database is allowed");
    process.env.CONTEXT = "production";
    delete process.env.ALLOW_NONPROD_DB;
    assert.doesNotThrow(() => fresh.admin(), "production is unaffected");
  } finally {
    process.env.CONTEXT = saved.ctx; process.env.ALLOW_NONPROD_DB = saved.allow;
    process.env.VITE_SUPABASE_URL = saved.url; process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

/**
 * The OAuth window has to cover a real detour through the platform: Instagram
 * login, 2FA, and reading the permission screen. Five minutes failed a genuine
 * first connection on 2026-09-04 and surfaced as `bad_state`, which reads like a
 * defect rather than "you took too long".
 *
 * The pair below is the part that must not drift: if the cookie dies before the
 * state does, the state is expired by proxy and the failure is misattributed.
 */
test("the nonce cookie outlives the state it is bound to", async () => {
  const { setNonceCookie } = await import("../build/_lib.js");
  const cookie = setNonceCookie("abc123");

  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
  assert.ok(Number.isFinite(maxAge), `no Max-Age in: ${cookie}`);
  assert.ok(maxAge >= 15 * 60, `cookie lives ${maxAge}s — too short for Instagram login plus 2FA`);

  // The attributes that make it a CSRF control rather than a convenience.
  for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
    assert.ok(cookie.includes(attr), `nonce cookie must set ${attr}: ${cookie}`);
  }
});
