import { test } from "node:test";
import assert from "node:assert/strict";
import { timeAgo } from "../build-lib/format.js";

/**
 * When a figure was read.
 *
 * This is not cosmetic. A creator publishes, sees 1.5k views in the Instagram
 * app, opens this dashboard and sees something else. Both figures are correct
 * and were taken minutes apart, but without a stated time the only conclusion
 * available to them is that the product is wrong — and that conclusion is
 * permanent, because nobody re-checks a tool they have decided is broken.
 *
 * So the timestamp carries real weight, and it must never be invented.
 */

const NOW = Date.parse("2026-09-08T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

test("an unknown read time says nothing rather than guessing one", () => {
  // Rows written before migration 0013 have no stamp. Printing "just now" for
  // them would be a fabricated fact of exactly the kind this column exists to
  // prevent, and it would be wrong in the most misleading direction.
  assert.equal(timeAgo(null, NOW), null);
  assert.equal(timeAgo(undefined, NOW), null);
  assert.equal(timeAgo("", NOW), null);
  assert.equal(timeAgo("not a date", NOW), null);
});

test("a fresh read reads as just now, including a slightly future stamp", () => {
  assert.equal(timeAgo(ago(0), NOW), "just now");
  assert.equal(timeAgo(ago(20_000), NOW), "just now");
  // The server stamps it and the browser renders it; the two clocks disagree.
  // "in 3 seconds" would look like a bug in a line whose whole job is to be
  // believed.
  assert.equal(timeAgo(ago(-3_000), NOW), "just now");
});

test("minutes, hours and days are counted and pluralised", () => {
  assert.equal(timeAgo(ago(60_000), NOW), "1 minute ago");
  assert.equal(timeAgo(ago(4 * 60_000), NOW), "4 minutes ago");
  assert.equal(timeAgo(ago(60 * 60_000), NOW), "1 hour ago");
  assert.equal(timeAgo(ago(5 * 60 * 60_000), NOW), "5 hours ago");
  assert.equal(timeAgo(ago(24 * 60 * 60_000), NOW), "1 day ago");
  assert.equal(timeAgo(ago(3 * 24 * 60 * 60_000), NOW), "3 days ago");
});

test("a stale read is never rounded down into looking current", () => {
  // The failure that matters is understating age: a client told "2 minutes ago"
  // about a figure from yesterday has been actively misled, which is worse than
  // the silence this replaced.
  const day = timeAgo(ago(26 * 60 * 60_000), NOW);
  assert.ok(/day/.test(day), `26 hours must read in days, got ${day}`);
  const hour = timeAgo(ago(90 * 60_000), NOW);
  assert.ok(/hour/.test(hour), `90 minutes must read in hours, got ${hour}`);
});
