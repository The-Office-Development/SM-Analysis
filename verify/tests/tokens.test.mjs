import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";

process.env.OAUTH_STATE_SECRET = "test-state-secret-value";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_APP_SECRET = "test-app-secret";
process.env.META_APP_ID = "app-1";
process.env.TIKTOK_CLIENT_KEY = "ck";
process.env.TIKTOK_CLIENT_SECRET = "cs";

const { encryptToken, decryptToken } = await import("../build/_lib.js");
const { needsRefresh, acquireRefreshLock, refreshIdentity } = await import("../build/_tokens.js");

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

function identity(over = {}) {
  return {
    id: "id-1", user_id: "u1", provider: "tiktok", external_user_id: "open-1",
    access_token: encryptToken("OLD_ACCESS"), refresh_token: encryptToken("OLD_REFRESH"),
    expires_at: inHours(2), refresh_lock_at: null, ...over,
  };
}

test("refresh windows differ by provider", () => {
  // TikTok tokens live 24h, Meta's about 60 days; one window cannot serve both.
  assert.equal(needsRefresh(identity({ provider: "tiktok", expires_at: inHours(2) })), true);
  assert.equal(needsRefresh(identity({ provider: "tiktok", expires_at: inHours(20) })), false);
  assert.equal(needsRefresh(identity({ provider: "meta", expires_at: inHours(24 * 3) })), true);
  assert.equal(needsRefresh(identity({ provider: "meta", expires_at: inHours(24 * 30) })), false);
  assert.equal(needsRefresh(identity({ expires_at: null })), false);
});

test("only one caller can hold the refresh lock", async () => {
  const db = makeDb({ provider_identities: [identity()] });
  assert.equal(await acquireRefreshLock(db, "id-1"), true, "first caller claims it");
  assert.equal(await acquireRefreshLock(db, "id-1"), false, "second caller must stand down");
});

test("a lock abandoned by a crashed run is reclaimed", async () => {
  const stale = new Date(Date.now() - 60 * 60_000).toISOString();
  const db = makeDb({ provider_identities: [identity({ refresh_lock_at: stale })] });
  assert.equal(await acquireRefreshLock(db, "id-1"), true);
});

test("a TikTok refresh persists the ROTATED refresh token", async () => {
  // TikTok issues a NEW refresh token each time. Keeping the old one silently
  // breaks the next refresh and the account needs full re-authorisation.
  const db = makeDb({
    provider_identities: [identity()],
    social_accounts: [{ id: "a1", identity_id: "id-1", user_id: "u1" }],
    account_secrets: [{ account_id: "a1", access_token: encryptToken("OLD_ACCESS") }],
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    access_token: "NEW_ACCESS", refresh_token: "NEW_REFRESH", expires_in: 86400,
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    assert.equal(await refreshIdentity(db, identity()), "refreshed");
  } finally { globalThis.fetch = original; }

  const row = db._rows("provider_identities")[0];
  assert.equal(decryptToken(row.access_token), "NEW_ACCESS");
  assert.equal(decryptToken(row.refresh_token), "NEW_REFRESH", "the rotated refresh token must be stored");
  assert.equal(row.refresh_lock_at, null, "the lock is released");
  // The per-account copy is updated too, or the sync keeps using a dead token.
  assert.equal(decryptToken(db._rows("account_secrets")[0].access_token), "NEW_ACCESS");
});

test("concurrent refreshes spend the rotating token only once", async () => {
  const db = makeDb({
    provider_identities: [identity()],
    social_accounts: [], account_secrets: [],
  });
  let exchanges = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    exchanges++;
    return new Response(JSON.stringify({ access_token: "A", refresh_token: "R", expires_in: 86400 }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await Promise.all([refreshIdentity(db, identity()), refreshIdentity(db, identity())]);
  } finally { globalThis.fetch = original; }
  assert.equal(exchanges, 1, "a second concurrent refresh would kill the token chain");
});

test("a failed refresh releases the lock and is counted", async () => {
  const db = makeDb({ provider_identities: [identity()] });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  try {
    assert.equal(await refreshIdentity(db, identity()), "failed");
  } finally { globalThis.fetch = original; }
  const row = db._rows("provider_identities")[0];
  assert.equal(row.refresh_lock_at, null, "a failure must not leave the identity locked forever");
  assert.equal(row.refresh_failures, 1);
});
