import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";

/**
 * A shared report link that ends.
 *
 * Until 2026-09-19 a link was permanent and irrevocable, and the privacy policy
 * said so: "treat one as public once you have sent it". That sentence described
 * a missing control, not a decision.
 *
 * The expiry is enforced in the FUNCTION, and these tests exist mainly to hold
 * that line. The public read uses the service-role key, which bypasses RLS, so
 * a database policy would never be consulted on the one path that serves
 * strangers. If the check here is removed, nothing else stops an expired link.
 */
process.env.VITE_SITE_URL = "https://app.example";
process.env.URL = "https://app.example";

const lib = await import("../build/_lib.js");
const { handler } = await import("../build/share.js");

const SNAP = { v: 1, title: "Performance report", figures: { reach: 1200 } };
const hourFromNow = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

function newDb(rows = []) {
  return makeDb({ report_shares: rows }, { users: { "session-token": "u1" } });
}

async function call(db, event) {
  lib.__setAdminForTests(db);
  try {
    const res = await handler(event);
    return { res, body: JSON.parse(res.body) };
  } finally { lib.__setAdminForTests(null); }
}

const create = (db, expiresInDays) => call(db, {
  httpMethod: "POST",
  headers: { authorization: "Bearer session-token" },
  body: JSON.stringify({ snapshot: SNAP, expires_in_days: expiresInDays }),
});
const read = (db, slug) => call(db, { httpMethod: "GET", headers: {}, queryStringParameters: { slug } });

test("a link created with an expiry carries one, and still reads while it is live", async () => {
  const db = newDb();
  const { res, body } = await create(db, 30);
  assert.equal(res.statusCode, 200);
  assert.ok(body.expires_at, "the caller is told when it ends");
  const days = (new Date(body.expires_at).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days < 30.1, `30 days, got ${days}`);

  const got = await read(db, body.slug);
  assert.equal(got.res.statusCode, 200);
  assert.deepEqual(got.body.snapshot, SNAP);
});

test("an expired link serves NOTHING, and says which of the two it is", async () => {
  const db = newDb([{ slug: "old", user_id: "u1", payload: SNAP, created_at: hourFromNow(-48), expires_at: hourFromNow(-1) }]);
  const { res, body } = await read(db, "old");
  assert.equal(res.statusCode, 410, "gone, not 404 and not 200");
  assert.equal(body.code, "expired");
  assert.equal(body.snapshot, undefined, "the figures do not travel with the refusal");
});

test("a link with no expiry keeps working, because every old link is one", async () => {
  const db = newDb([{ slug: "forever", user_id: "u1", payload: SNAP, created_at: hourFromNow(-9000), expires_at: null }]);
  const { res, body } = await read(db, "forever");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(body.snapshot, SNAP);
});

test("omitting the expiry stores null rather than inventing a date", async () => {
  const db = newDb();
  const { body } = await create(db, undefined);
  assert.equal(body.expires_at, null);
  assert.equal(db._rows("report_shares")[0].expires_at, null);
});

test("an expiry outside the allowed range is refused, and nothing is stored", async () => {
  // NaN and Infinity are deliberately absent: JSON.stringify turns both into
  // null, which is the legitimate "no expiry" value, so they would test the
  // encoder rather than the rule. The server still guards them for a hand-built
  // request body, which is the case the encoder cannot produce.
  for (const bad of [0, -5, 400, "30", true]) {
    const db = newDb();
    const { res } = await create(db, bad);
    assert.equal(res.statusCode, 400, `${String(bad)} should be refused`);
    assert.equal(db._rows("report_shares").length, 0, `${String(bad)} stored a row anyway`);
  }
});

test("a link is only created for someone signed in", async () => {
  const db = newDb();
  const { res } = await call(db, { httpMethod: "POST", headers: {}, body: JSON.stringify({ snapshot: SNAP }) });
  assert.equal(res.statusCode, 401);
  assert.equal(db._rows("report_shares").length, 0);
});

test("a slug that does not exist is a 404, distinct from an expired one", async () => {
  const { res, body } = await read(newDb(), "nope");
  assert.equal(res.statusCode, 404);
  assert.notEqual(body.code, "expired");
});
