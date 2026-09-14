import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";
import { installLinkedInMock, MEMBER_ID, ORG_ID, MEMBER_METRIC, addDays } from "./mock-linkedin.mjs";

/**
 * LinkedIn onboarding, end to end: the Connect button's request, LinkedIn's
 * consent round trip, the callback, and the first sync.
 *
 * The first handler-level test in this repo. Everything before it tested the
 * connect flow in parts, which is how three defects survived to 2026-09-14: the
 * database refused every LinkedIn row (0018), the start endpoint's errors were
 * unreadable, and the codes reached the user raw. Written for the first real
 * test, the operator's own profile: 500+ followers and no posts.
 */
process.env.OAUTH_STATE_SECRET = "test-state-secret-value";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.LINKEDIN_CLIENT_ID = "li-client";
process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
process.env.VITE_SITE_URL = "https://app.example";
process.env.URL = "https://app.example";

const lib = await import("../build/_lib.js");
const { handler: start } = await import("../build/oauth-linkedin.js");
const { handler: callback } = await import("../build/oauth-linkedin-callback.js");
const { syncAccount } = await import("../build/_sync.js");

const GRANTED = "r_organization_social,rw_organization_admin,r_basicprofile,r_member_profileAnalytics,r_member_postAnalytics";

function newDb() {
  return makeDb({ social_accounts: [], provider_identities: [], account_secrets: [], consents: [], metrics_daily: [], content: [] },
    { users: { "session-token": "u1" } });
}

/** Press Connect: the start endpoint, as the page calls it. */
async function pressConnect(db, kind) {
  lib.__setAdminForTests(db);
  const res = await start({ httpMethod: "POST", body: JSON.stringify({ token: "session-token", kind }), headers: {} });
  assert.equal(res.statusCode, 200, `start answered ${res.statusCode}: ${res.body}`);
  const url = new URL(JSON.parse(res.body).url);
  const cookie = String(res.headers["Set-Cookie"]).split(";")[0];
  return { url, cookie };
}

/** LinkedIn sends the browser back; the token exchange and API are mocked. */
async function landOnCallback(db, { url, cookie }, mockOpts = {}, query = null) {
  const mock = installLinkedInMock(mockOpts);
  const apiFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => String(u).includes("/oauth/v2/accessToken")
    ? new Response(JSON.stringify({ access_token: "LI-ACCESS", expires_in: 5184000, scope: GRANTED }), { status: 200 })
    : apiFetch(u, init);
  try {
    lib.__setAdminForTests(db);
    const res = await callback({
      httpMethod: "GET",
      queryStringParameters: query ?? { code: "auth-code", state: url.searchParams.get("state") },
      headers: { cookie },
    });
    return { res, location: new URL(res.headers.Location ?? res.headers.location), calls: mock.calls };
  } finally { mock.restore(); lib.__setAdminForTests(null); }
}

test("Connect profile asks LinkedIn for the five scopes, and records the consent", async () => {
  const db = newDb();
  const { url, cookie } = await pressConnect(db, "profile");
  assert.equal(url.origin + url.pathname, "https://www.linkedin.com/oauth/v2/authorization");
  assert.equal(url.searchParams.get("scope"),
    "r_organization_social rw_organization_admin r_basicprofile r_member_profileAnalytics r_member_postAnalytics",
    "space separated, and identical for pages and profiles");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example/api/oauth-linkedin-callback");
  assert.ok(cookie.includes("="), "the state nonce cookie is set");
  const consent = db._rows("consents")[0];
  assert.equal(consent.purpose, "connect_linkedin_profile");
  lib.__setAdminForTests(null);
});

test("a personal profile connects end to end, with no page lookup", async () => {
  const db = newDb();
  const started = await pressConnect(db, "profile");
  const { location, calls } = await landOnCallback(db, started);

  assert.equal(location.pathname, "/connections");
  assert.equal(location.searchParams.get("connected"), "linkedin", `redirected with ${location.search}`);
  assert.equal(calls.filter((c) => c.includes("organizationAcls")).length, 0, "a profile never asks which pages you administer");

  const acc = db._rows("social_accounts")[0];
  assert.equal(acc.platform, "linkedin");
  assert.equal(acc.auth_mode, "linkedin_member");
  assert.equal(acc.external_id, MEMBER_ID);
  assert.equal(acc.username, "bader-hamad");
  assert.equal(acc.display_name, "Bader Hamad");
  assert.deepEqual(acc.write_scopes, ["rw_organization_admin"], "the granted scopes are recorded, as LinkedIn reported them");

  const secret = db._rows("account_secrets")[0];
  assert.equal(secret.extra.kind, "li_member");
  assert.notEqual(secret.access_token, "LI-ACCESS", "the token is encrypted at rest");
  assert.equal(db._rows("provider_identities")[0].provider, "linkedin");
});

test("a Company Page still connects through the same flow", async () => {
  const db = newDb();
  const started = await pressConnect(db, "page");
  const { location } = await landOnCallback(db, started);
  assert.equal(location.searchParams.get("connected"), "linkedin");
  const acc = db._rows("social_accounts")[0];
  assert.equal(acc.auth_mode, "linkedin_organization");
  assert.equal(acc.external_id, ORG_ID);
});

test("Connect page with no page to administer says so, and connects nothing", async () => {
  const db = newDb();
  const started = await pressConnect(db, "page");
  const { location } = await landOnCallback(db, started, { adminsPage: false });
  assert.equal(location.searchParams.get("error"), "linkedin_no_admin_page");
  assert.equal(db._rows("social_accounts").length, 0);
});

test("cancelling on LinkedIn's screen connects nothing", async () => {
  const db = newDb();
  const started = await pressConnect(db, "profile");
  const { location } = await landOnCallback(db, started, {},
    { error: "user_cancelled_authorize", state: started.url.searchParams.get("state") });
  assert.equal(location.searchParams.get("error"), "permission_declined");
  assert.equal(db._rows("social_accounts").length, 0);
});

test("a state lifted into another browser is refused", async () => {
  const db = newDb();
  const started = await pressConnect(db, "profile");
  const { location } = await landOnCallback(db, { url: started.url, cookie: "pb_oauth_state=someone-else" });
  assert.equal(location.searchParams.get("error"), "bad_state");
  assert.equal(db._rows("social_accounts").length, 0);
});

/* ---- the first sync of a personal profile ---------------------------------- */

async function connectAndSync(mockOpts) {
  const db = newDb();
  const started = await pressConnect(db, "profile");
  await landOnCallback(db, started);
  const acc = db._rows("social_accounts")[0];
  const mock = installLinkedInMock(mockOpts);
  try {
    await syncAccount(db, { id: acc.id, platform: "linkedin", external_id: acc.external_id, username: acc.username, tz_offset_minutes: 180 });
  } finally { mock.restore(); }
  return { db, calls: mock.calls };
}

test("a profile with followers and no posts: the follower count, and nothing invented", async () => {
  const { db, calls } = await connectAndSync({ memberFollowers: 512, memberHasPosts: false });
  const today = new Date().toISOString().slice(0, 10);
  const rows = db._rows("metrics_daily");
  const todayRow = rows.find((r) => r.date === today);
  assert.equal(todayRow?.followers, 512, "today's follower total is stored");
  for (const r of rows) {
    assert.equal(r.impressions, null, `${r.date}: no posts reported is unknown, not 0 impressions`);
    assert.equal(r.engagements, null);
    assert.equal(r.reach, null, "LinkedIn has no daily reach for a member");
    assert.equal(r.views, null);
  }
  assert.equal(db._rows("content").length, 0, "no per-post rows: LinkedIn will not list a profile's posts");
  assert.equal((db._rows("audience_snapshots") ?? []).length, 0, "no demographics exist for a profile");
  for (const org of ["organizationAcls", "organizationalEntity", "networkSizes", "/rest/posts"]) {
    assert.equal(calls.filter((c) => c.includes(org)).length, 0, `a profile sync never calls ${org}`);
  }
});

test("a profile with posts: each day's summed impressions and engagements", async () => {
  const { db } = await connectAndSync({ memberHasPosts: true });
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = addDays(today, -1);
  const day = Number(yesterday.slice(8));
  const row = db._rows("metrics_daily").find((r) => r.date === yesterday);
  assert.equal(row.impressions, MEMBER_METRIC.IMPRESSION + day);
  assert.equal(row.engagements, (MEMBER_METRIC.REACTION + day) + (MEMBER_METRIC.COMMENT + day) + (MEMBER_METRIC.RESHARE + day),
    "reactions, comments and reposts summed");
});

test("a profile's post statistics are not kept past the 48-hour hold; its followers are", async () => {
  const { purgeLinkedInExpired } = await import("../build/_sync.js");
  const today = new Date().toISOString().slice(0, 10);
  const old = addDays(today, -5);
  const db = makeDb({ metrics_daily: [
    { account_id: "m1", date: old, followers: 500, impressions: 900, engagements: 40 },
    { account_id: "m1", date: today, followers: 512, impressions: 310, engagements: 20 },
  ] });
  await purgeLinkedInExpired(db, { id: "m1" }, Date.now(), true);
  const [o, t] = ["old", "today"].map((_, i) => db._rows("metrics_daily")[i]);
  assert.equal(o.followers, 500, "the follower history is kept");
  assert.equal(o.impressions, null, "post statistics older than the hold are nulled, not zeroed");
  assert.equal(o.engagements, null);
  assert.equal(t.impressions, 310, "recent ones stay");
});
