import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDb } from "./fake-supabase.mjs";
import { installLinkedInMock, ORG_ID, ORG_ID_2, ORG_ID_3 } from "./mock-linkedin.mjs";

/**
 * Choosing which LinkedIn Page a connection reads.
 *
 * The callback takes the FIRST page a member administers, because LinkedIn's
 * consent screen offers no choice. For a client with one page that is correct
 * and invisible. For a client with three it was a silent wrong answer: their
 * dashboard would show one page's numbers under the belief it was another.
 *
 * What these tests protect is not the button. It is that a switch cannot leave
 * two pages' history in one account: a blended follower line with no marking is
 * exactly the fabricated figure this project refuses to produce.
 */
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.LINKEDIN_CLIENT_ID = "li-client";
process.env.LINKEDIN_CLIENT_SECRET = "li-secret";

const lib = await import("../build/_lib.js");
const { handler } = await import("../build/linkedin-page.js");

const URN = (id) => `urn:li:organization:${id}`;
const ALL = [URN(ORG_ID), URN(ORG_ID_2), URN(ORG_ID_3)];

function newDb(opts = {}) {
  return makeDb({
    social_accounts: [
      { id: "acc-1", user_id: "u1", platform: "linkedin", external_id: ORG_ID, username: "drinkat", display_name: "Drinkat", auth_mode: "linkedin_page", last_synced_at: "2026-09-17T00:00:00Z" },
      { id: "acc-other", user_id: "u2", platform: "linkedin", external_id: ORG_ID, username: "someone-else", display_name: "Someone else" },
    ],
    account_secrets: [
      { account_id: "acc-1", access_token: lib.encryptToken("LI-ACCESS"), extra: { kind: "li_organization", urn: URN(ORG_ID), available_orgs: ALL } },
      { account_id: "acc-other", access_token: lib.encryptToken("LI-ACCESS"), extra: { kind: "li_organization", urn: URN(ORG_ID), available_orgs: ALL } },
    ],
    metrics_daily: [
      { account_id: "acc-1", platform: "linkedin", date: "2026-09-16", followers: 8421 },
      { account_id: "acc-other", platform: "linkedin", date: "2026-09-16", followers: 11 },
    ],
    content: [{ account_id: "acc-1", external_id: "share-1", views: 900 }],
    audience_snapshots: [{ account_id: "acc-1", captured_on: "2026-09-16" }],
  }, { users: { "session-token": "u1" }, ...opts });
}

async function call(db, event) {
  const mock = installLinkedInMock();
  lib.__setAdminForTests(db);
  try {
    const res = await handler({ headers: { authorization: "Bearer session-token" }, ...event });
    return { res, body: JSON.parse(res.body), calls: mock.calls };
  } finally { mock.restore(); lib.__setAdminForTests(null); }
}

const get = (db, accountId = "acc-1") =>
  call(db, { httpMethod: "GET", queryStringParameters: { account_id: accountId } });
const post = (db, urn, accountId = "acc-1") =>
  call(db, { httpMethod: "POST", body: JSON.stringify({ account_id: accountId, urn }) });

test("the picker lists every Page the member administers, and says which one is read", async () => {
  const db = newDb();
  const { res, body } = await get(db);
  assert.equal(res.statusCode, 200);
  assert.equal(body.chosen, URN(ORG_ID), "the page currently read is named");
  assert.deepEqual(body.options.map((o) => o.name).sort(), ["Drinkat", "Drinkat Amman", "Drinkat Roastery"],
    "each page is offered by its own name, not its id");
});

test("a name is looked up once and then remembered", async () => {
  const db = newDb();
  const first = await get(db);
  const orgCalls = (calls) => calls.filter((c) => c.includes("/organizations/")).length;
  assert.equal(orgCalls(first.calls), 3, "three unknown names, three calls");
  const second = await get(db);
  assert.equal(orgCalls(second.calls), 0, "development tier allows 100 calls a member a day; this costs none");
  assert.deepEqual(second.body.options.map((o) => o.name).sort(), ["Drinkat", "Drinkat Amman", "Drinkat Roastery"]);
});

test("switching repoints the account AND deletes the page it was reading", async () => {
  const db = newDb();
  const { res, body } = await post(db, URN(ORG_ID_2));
  assert.equal(res.statusCode, 200, body.message);
  assert.equal(body.switched, true);

  const acc = db._rows("social_accounts").find((r) => r.id === "acc-1");
  assert.equal(acc.external_id, ORG_ID_2, "the account reads the chosen page");
  assert.equal(acc.display_name, "Drinkat Amman");
  assert.equal(acc.last_synced_at, null, "and is due a sync, so the dashboard does not claim fresh numbers");
  assert.equal(db._rows("account_secrets").find((r) => r.account_id === "acc-1").extra.urn, URN(ORG_ID_2),
    "the sync reads the urn from the secret, so it must move too");

  for (const t of ["metrics_daily", "content", "audience_snapshots"]) {
    assert.equal(db._rows(t).filter((r) => r.account_id === "acc-1").length, 0,
      `${t}: the previous page's rows are gone, not blended into the new page's history`);
  }
  assert.equal(db._rows("metrics_daily").filter((r) => r.account_id === "acc-other").length, 1,
    "and no one else's rows were touched");
});

test("a Page the member does not administer is refused, and nothing moves", async () => {
  const db = newDb();
  const { res } = await post(db, "urn:li:organization:999999");
  assert.equal(res.statusCode, 400);
  const acc = db._rows("social_accounts").find((r) => r.id === "acc-1");
  assert.equal(acc.external_id, ORG_ID, "still the original page");
  assert.equal(db._rows("metrics_daily").filter((r) => r.account_id === "acc-1").length, 1, "and its numbers are intact");
});

test("another user's account is not switchable, and reads as absent", async () => {
  const db = newDb();
  const { res } = await post(db, URN(ORG_ID_2), "acc-other");
  assert.equal(res.statusCode, 404, "the same answer as a row that does not exist");
  assert.equal(db._rows("social_accounts").find((r) => r.id === "acc-other").external_id, ORG_ID);
  assert.equal(db._rows("metrics_daily").filter((r) => r.account_id === "acc-other").length, 1);
});

test("a refused delete stops the switch instead of leaving two pages in one account", async () => {
  const db = newDb({ failWrites: { content: 'permission denied for table "content"' } });
  const { res, body } = await post(db, URN(ORG_ID_2));
  assert.equal(res.statusCode, 500, "the caller is told, rather than the failure being swallowed");
  assert.match(body.message, /nothing was switched/i);
  const acc = db._rows("social_accounts").find((r) => r.id === "acc-1");
  assert.equal(acc.external_id, ORG_ID,
    "the account still names the page whose rows are still there: the name and the numbers agree");
  assert.equal(db._rows("account_secrets").find((r) => r.account_id === "acc-1").extra.urn, URN(ORG_ID));
});

test("a personal profile has no page to choose", async () => {
  // `_rows` hands out copies, so the seed has to carry this, not a mutation of
  // what it returns. (Mutating a copy is a test that asserts nothing, which is
  // how this one first "passed".)
  const db = newDb();
  db._seed("account_secrets", [
    { account_id: "acc-1", access_token: lib.encryptToken("LI-ACCESS"), extra: { kind: "li_member" } },
  ]);
  const { res, body } = await get(db);
  assert.equal(res.statusCode, 400, body.message);
  assert.match(body.message, /profile, not a Page/i);
});
