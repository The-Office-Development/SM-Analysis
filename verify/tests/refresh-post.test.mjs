import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";

/**
 * "Check now" on one post: refresh-post.ts.
 *
 * It had no test at all until 2026-09-19, and CLAUDE.md said so. Writing one
 * found two defects immediately:
 *  - the response carried nulls for figures Instagram declined this time, and
 *    the page spreads the response over the stored post, so a real reach
 *    vanished from the screen while the database kept it;
 *  - a story was asked for the FEED metric list, which includes `saved`, not a
 *    story metric. Insights are all-or-nothing, so every story refresh failed.
 */
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.GRAPH_BACKOFF_BASE_MS = "0";

const lib = await import("../build/_lib.js");
const { handler } = await import("../build/refresh-post.js");
const { IG } = await import("../build/_instagram.js");

const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

function newDb({ story = false, expired = false, storyMetrics = null, stored = {}, owner = "u1" } = {}) {
  return makeDb({
    social_accounts: [
      { id: "acc-1", user_id: owner, platform: "instagram", external_id: "17841", story_metrics: storyMetrics },
    ],
    account_secrets: [{ account_id: "acc-1", access_token: lib.encryptToken("IG-TOKEN") }],
    content: [{
      id: "c-1", account_id: "acc-1", external_id: "media-1",
      media_type: story ? "Story" : "IMAGE",
      expires_at: story ? hours(expired ? -1 : 20) : null,
      refreshed_at: null, checked_at: "2026-09-18T00:00:00Z",
      views: 900, reach: 700, likes: 40, comments: 3, shares: 2, saves: 5, replies: 4,
      ...stored,
    }],
  }, { users: { "session-token": "u1", "intruder-token": "u2" } });
}

/**
 * Instagram, answering by path. `insights` is what /{id}/insights returns for
 * a given metric list (or an error object), keyed by the list itself.
 */
function installGraph({ media, insights = {} } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = new URL(String(u));
    calls.push(url.pathname + url.search);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/media-1/insights")) {
      const got = insights[url.searchParams.get("metric")];
      if (!got) return reply(400, { error: { message: "(#100) The metric link_clicks is not available on this endpoint", code: 100 } });
      if (got.error) return reply(400, got);
      return reply(200, got);
    }
    if (url.pathname.endsWith("/media-1")) return reply(200, media ?? {});
    return reply(404, { error: { message: "unmocked", code: 803 } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

async function refresh(db, graph, token = "session-token") {
  const g = installGraph(graph);
  lib.__setAdminForTests(db);
  try {
    const res = await handler({ httpMethod: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ id: "c-1" }) });
    return { res, body: JSON.parse(res.body), calls: g.calls };
  } finally { g.restore(); lib.__setAdminForTests(null); }
}

const rows = (o) => ({ data: Object.entries(o).map(([name, value]) => ({ name, values: [{ value }] })) });

test("a figure Instagram declines this time is neither written nor SENT, so the page cannot blank it", async () => {
  const db = newDb();
  // Reach and saves come back; views, shares are absent this time.
  const { res, body } = await refresh(db, { media: { like_count: 41, comments_count: 3, insights: rows({ reach: 710, saved: 6 }) } });
  assert.equal(res.statusCode, 200, body.message);
  assert.equal(body.reach, 710);
  assert.equal("shares" in body, false, "an absent figure is absent from the response, not null");
  // views falls back to reach for a photo, as the sync does; that is a figure, not a blank.
  const post = db._rows("content")[0];
  assert.equal(post.shares, 2, "and the stored figure is untouched");
  assert.equal(post.reach, 710);
});

test("a story is asked for STORY metrics, never the feed list with `saved` in it", async () => {
  const db = newDb({ story: true });
  const { res, body, calls } = await refresh(db, {
    insights: { [IG.STORY_INSIGHT_METRICS]: rows({ reach: 120, views: 180, replies: 6, profile_visits: 9 }) },
  });
  assert.equal(res.statusCode, 200, body.message);
  assert.ok(calls.every((c) => !c.includes("saved")), `a story was asked for saved: ${calls.join(" | ")}`);
  assert.equal(body.profile_visits, 9, "the creator metrics come back for a story");
  assert.equal(body.views, 180);
  assert.equal("likes" in body, false, "a story has no likes, and that is not sent as a figure");
  const post = db._rows("content")[0];
  assert.equal(post.likes, 40, "nor written over whatever is stored");
});

test("a refused story list steps down the ladder instead of failing the refresh", async () => {
  const db = newDb({ story: true });
  const { res, body, calls } = await refresh(db, {
    insights: { [IG.STORY_INSIGHT_METRICS_CORE]: rows({ reach: 50, views: 70 }) },
  });
  assert.equal(res.statusCode, 200, body.message);
  assert.equal(body.views, 70);
  assert.equal(calls.length, 3, "full, plus, then core");
});

test("the account's known narrowing is where a story refresh starts", async () => {
  const db = newDb({ story: true, storyMetrics: { v: 2, metrics: IG.STORY_INSIGHT_METRICS_CORE } });
  const { calls } = await refresh(db, { insights: { [IG.STORY_INSIGHT_METRICS_CORE]: rows({ reach: 50 }) } });
  assert.equal(calls.length, 1, "no calls spent on lists this account is known to refuse");
});

test("when no list answers, nothing is claimed: no figures, no 'checked just now'", async () => {
  const db = newDb({ story: true });
  const { res, body } = await refresh(db, { insights: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(body.refreshed_at, null, "no read time is claimed for figures nobody re-read");
  assert.ok(body.note);
  const post = db._rows("content")[0];
  assert.equal(post.checked_at, "2026-09-18T00:00:00Z", "the shown freshness does not move");
  assert.ok(post.refreshed_at, "but the cooldown is stamped, so it cannot be hammered");
  assert.equal(post.views, 900);
});

test("an expired story is not re-read at all", async () => {
  const db = newDb({ story: true, expired: true });
  const { res, body, calls } = await refresh(db, { insights: { [IG.STORY_INSIGHT_METRICS]: rows({ reach: 1 }) } });
  assert.equal(res.statusCode, 409);
  assert.equal(body.code, "story_expired");
  assert.equal(calls.length, 0, "no call spent on a story Instagram no longer serves");
});

test("another tenant's post cannot be refreshed, and reads as not theirs", async () => {
  const db = newDb();
  const { res, calls } = await refresh(db, { media: { insights: rows({ reach: 1 }) } }, "intruder-token");
  assert.equal(res.statusCode, 404);
  assert.equal(calls.length, 0);
  assert.equal(db._rows("content")[0].reach, 700);
});

test("a dead token on a story is reported as reconnect, not stepped down the ladder", async () => {
  const db = newDb({ story: true });
  const dead = { error: { message: "Error validating access token", code: 190 } };
  const { res, calls } = await refresh(db, { insights: { [IG.STORY_INSIGHT_METRICS]: dead } });
  assert.equal(res.statusCode, 409);
  assert.equal(calls.length, 1, "a narrower list cannot fix an expired token");
});
