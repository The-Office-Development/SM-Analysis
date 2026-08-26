import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GRAPH_BACKOFF_BASE_MS = "1";
process.env.OAUTH_STATE_SECRET = "test-state-secret-value";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_APP_SECRET = "test-app-secret";

const { authorizeUrl, IG, exchangeCode, refreshLongLivedToken, igGet } = await import("../build/_instagram.js");

test("the authorize URL asks only for read-only Instagram scopes", () => {
  const u = new URL(authorizeUrl("app-1", "https://site/cb", "STATE"));
  // No Facebook in the loop, and no pages_* or business_management anywhere.
  assert.equal(u.origin + u.pathname, "https://www.instagram.com/oauth/authorize");
  const scopes = (u.searchParams.get("scope") ?? "").split(",");
  assert.deepEqual(scopes, ["instagram_business_basic", "instagram_business_manage_insights"]);
  for (const forbidden of ["pages_show_list", "pages_read_engagement", "business_management", "instagram_business_content_publish"]) {
    assert.ok(!scopes.includes(forbidden), `must not request ${forbidden}`);
  }
  assert.equal(u.searchParams.get("state"), "STATE");
  assert.equal(u.searchParams.get("response_type"), "code");
});

test("the code exchange upgrades to a long-lived token", async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.startsWith(IG.TOKEN)) {
      return new Response(JSON.stringify({ access_token: "SHORT", user_id: 987 }), { status: 200 });
    }
    return new Response(JSON.stringify({ access_token: "LONG", expires_in: 5184000 }), { status: 200 });
  };
  try {
    const t = await exchangeCode("id", "secret", "https://site/cb", "CODE");
    assert.equal(t.accessToken, "LONG", "the short-lived token must not be what we store");
    assert.equal(t.userId, "987");
    assert.ok(t.expiresAt && Date.parse(t.expiresAt) > Date.now());
  } finally { globalThis.fetch = original; }
  assert.ok(seen.some((u) => u.includes("ig_exchange_token")), "long-lived exchange must happen");
});

test("a failed exchange throws rather than returning an empty token", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error_message: "bad code" }), { status: 400 });
  try {
    await assert.rejects(() => exchangeCode("id", "secret", "https://site/cb", "BAD"));
  } finally { globalThis.fetch = original; }
});

test("refresh presents the token itself and returns a new expiry", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes("ig_refresh_token"));
    return new Response(JSON.stringify({ access_token: "RENEWED", expires_in: 5184000 }), { status: 200 });
  };
  try {
    const r = await refreshLongLivedToken("CURRENT");
    assert.equal(r.accessToken, "RENEWED");
    assert.ok(r.expiresAt);
  } finally { globalThis.fetch = original; }
});

test("igGet retries throttling and surfaces a permanent error", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    if (calls < 3) return new Response(JSON.stringify({ error: { message: "slow down", code: 4 } }), { status: 429 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  try {
    assert.deepEqual(await igGet("/me/insights", { metric: "reach" }, "T"), { data: [] });
    assert.equal(calls, 3, "throttling should be retried, not swallowed");
  } finally { globalThis.fetch = original; }

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "no such metric", code: 100 } }), { status: 400 });
  try {
    await assert.rejects(() => igGet("/me/insights", { metric: "nope" }, "T"), /no such metric/);
  } finally { globalThis.fetch = original; }
});
