import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LI, liDayKey, liTime, liNum } from "../build/_linkedin.js";

/**
 * LinkedIn, tested where it can be tested.
 *
 * None of this proves the integration works. Nothing has been called against a
 * live LinkedIn response, and the Instagram pass is the reason that warning is
 * repeated everywhere: three of four daily metrics were wrong AFTER the
 * documentation agreed with the code.
 *
 * What is testable now is the part that has burned this project before — the
 * conversions and the invariants. A day boundary read with the wrong convention,
 * a write scope creeping into a read-only integration, an unreported figure
 * becoming a zero. Those are checkable without a network, and each one below
 * corresponds to a defect that has actually happened here.
 */

/* ---- the read-only invariant -------------------------------------------- */

test("no write-capable endpoint is reachable through the API block", () => {
  /*
   * `rw_organization_admin` is unavoidable — LinkedIn publishes no read-only
   * scope for page reporting — so the token CAN post as the client's page. The
   * only thing standing between that and a client's feed is that this code never
   * calls a mutation, which makes it worth asserting rather than trusting.
   */
  // The API block itself: its only fetch must be a plain GET. A `method:` on it
  // would mean somebody added a mutation to the one helper every LinkedIn call
  // goes through.
  const block = readFileSync("netlify/functions/_linkedin.ts", "utf8");
  assert.equal((block.match(/fetch\(/g) ?? []).length, 1, "one request path, so one place to audit");
  assert.ok(!/method:\s*["'`](POST|PUT|DELETE|PATCH)/.test(block),
    "liGet must remain a GET");
  assert.ok(!block.includes("X-RestLi-Method"),
    "the RestLi method header is only needed to write or batch-write");

  // And the sync's LinkedIn function must reach LinkedIn only through it.
  const sync = readFileSync("netlify/functions/_sync.ts", "utf8");
  const from = sync.indexOf("async function syncLinkedIn");
  const to = sync.indexOf("function sumIfAny", from);
  assert.ok(from > 0 && to > from, "syncLinkedIn should be findable between its neighbours");
  const body = sync.slice(from, to);
  assert.ok(!body.includes("fetch("), "syncLinkedIn must not open its own request");
  // Calls read `liGet<{...}>(`, so match the name rather than the paren.
  assert.ok(/\bliGet\s*[<(]/.test(body), "and must go through the audited helper");
  assert.deepEqual(LI.WRITE_ENDPOINTS, ["/posts", "/comments", "/reactions"],
    "the list of endpoints we must never call should stay explicit");
});

test("the requested scopes are the two that are actually needed", () => {
  // Not more. Every extra scope is something a client grants and cannot see us
  // decline to use, and this is the integration where one of them is write.
  assert.deepEqual(LI.SCOPES, ["r_organization_social", "rw_organization_admin"]);
  assert.ok(!LI.SCOPES.includes("w_organization_social"),
    "posting on behalf of a page is never requested");
  assert.ok(!LI.SCOPES.includes("r_member_social"),
    "the member path is not implemented; requesting its scope would be theatre");
});

/* ---- the day boundary ---------------------------------------------------- */

test("a LinkedIn day is read back as the same calendar day", () => {
  /*
   * The defect this prevents has happened here once already, on Instagram, where
   * slicing a UTC date off `end_time` filed every figure one day late for the
   * whole of the Americas.
   *
   * LinkedIn is a different convention again: timeRange.start is milliseconds at
   * the START of the day, and the range END is EXCLUSIVE. Reading start as the
   * day is correct; reading end as the day would be off by one.
   */
  assert.equal(liDayKey(Date.parse("2026-08-24T00:00:00Z")), "2026-08-24");
  assert.equal(liDayKey(liTime("2026-01-01")), "2026-01-01");
  assert.equal(liDayKey(liTime("2026-12-31")), "2026-12-31");
});

test("a window asks for the last day it means to include", () => {
  // LinkedIn's end is exclusive. Asking end = the last wanted day silently drops
  // that day, which is the kind of gap that looks like the platform reported
  // nothing rather than like an off-by-one in our query.
  const start = liTime("2026-08-01");
  const endExclusive = liTime("2026-08-08");
  const daysCovered = Math.round((endExclusive - start) / 86_400_000);
  assert.equal(daysCovered, 7, "1st to 7th inclusive is seven days, asked for as end=8th");
});

test("an unparseable timestamp yields null rather than a wrong day", () => {
  assert.equal(liDayKey(NaN), null);
  assert.equal(liDayKey(Number.POSITIVE_INFINITY), null);
});

/* ---- unknown is not zero ------------------------------------------------- */

test("a figure LinkedIn did not report stays unknown", () => {
  assert.equal(liNum(undefined), null);
  assert.equal(liNum(null), null);
  assert.equal(liNum("12"), null, "a string is not a measurement");
  assert.equal(liNum(NaN), null);
  assert.equal(liNum(0), 0, "a reported zero is a real zero and must survive");
});

test("a negative like count is kept, because LinkedIn means it", () => {
  /*
   * LinkedIn documents this: likeCount "can become negative when members who
   * liked a sponsored share later unlike it. The like is not counted since it's
   * not organic, but the unlike is counted as organic."
   *
   * Clamping it to zero would be inventing a figure. The charts clamp their
   * geometry instead, exactly as they do for Meta's negative total_interactions.
   */
  assert.equal(liNum(-3), -3);
});

/* ---- the limits that shape the sync -------------------------------------- */

test("history is clamped to the window LinkedIn actually serves", () => {
  // "returns share data only within the past 12 months, using a rolling
  // 12-month window". Asking for more is not an error, it just returns nothing,
  // and an empty response must not be read as a page with no activity.
  assert.equal(LI.MAX_HISTORY_DAYS, 365);
});

test("the API version is pinned in exactly one place", () => {
  // LinkedIn sunsets a version roughly annually. Pinned here so the migration is
  // one edit rather than a hunt through call sites.
  assert.match(LI.VERSION, /^\d{6}$/, "a LinkedIn version is YYYYMM");
  const src = readFileSync("netlify/functions/_sync.ts", "utf8");
  assert.ok(!/LinkedIn-Version/i.test(src),
    "the version header belongs to the API block, not to the sync");
});
