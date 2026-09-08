import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publishTiming, followerCost, reachMultiples, reachConcentration,
  TIMING_MIN_POSTS, TIMING_MIN_TOTAL,
} from "../build-lib/insights.js";

/**
 * The deep layer computes things Instagram does not compute at all, which is
 * exactly why it needs harder tests than the rest.
 *
 * A metric can be checked by a client against their phone. An ANALYSIS cannot.
 * If this says Tuesday is their best day, nobody can contradict it, and they
 * will reorganise a publishing schedule around it. The cost of being wrong here
 * is paid quietly, by the client, over months.
 */

const post = (i, extra) => ({
  id: `p${i}`, account_id: "a", platform: "instagram", external_id: `x${i}`,
  title: `Post ${i}`, media_type: "Reel", permalink: null,
  published_at: "2026-08-04T09:00:00Z",
  views: null, likes: null, comments: null, shares: null, saves: null,
  reach: 1000, avg_watch_seconds: null, retention_pct: null, checked_at: null, ...extra,
});

const day = (d, extra) => ({
  account_id: "a", platform: "instagram", date: `2026-08-${String(d).padStart(2, "0")}`,
  followers: 1000, reach: 500, impressions: null, views: 0, engagements: 0,
  follows: null, unfollows: null, reach_followers: null, reach_non_followers: null,
  provisional: false, ...extra,
});

/* ---- publish timing ------------------------------------------------------ */

test("a bucket with too few posts reports its sample and refuses a result", () => {
  // Two posts on one day. Two posts is not a finding, however good they were.
  const content = [
    post(1, { published_at: "2026-08-04T09:00:00Z", reach: 9000 }),
    post(2, { published_at: "2026-08-11T09:00:00Z", reach: 9000 }),
    ...Array.from({ length: 10 }, (_, i) =>
      post(100 + i, { published_at: "2026-08-05T09:00:00Z", reach: 1000 })),
  ];
  const t = publishTiming(content);
  const tuesday = t.byDay.find((b) => b.label === "Tuesday");
  assert.equal(tuesday.posts, 2, "the count is still reported");
  assert.equal(tuesday.lift, null, `${TIMING_MIN_POSTS} posts are required before a lift is stated`);
});

test("a whole analysis stays silent until enough posts back it", () => {
  const few = publishTiming(Array.from({ length: TIMING_MIN_TOTAL - 1 }, (_, i) => post(i)));
  assert.equal(few.enough, false);
  const plenty = publishTiming(Array.from({ length: TIMING_MIN_TOTAL }, (_, i) => post(i)));
  assert.equal(plenty.enough, true);
});

test("a bucket cannot be carried by one viral post", () => {
  // Three Wednesday posts: one enormous, two poor. The MEAN would rank Wednesday
  // far above everything; the median must not, because two of the three posts
  // published then did badly and that is what the creator would repeat.
  const content = [
    post(1, { published_at: "2026-08-05T09:00:00Z", reach: 500_000 }),
    post(2, { published_at: "2026-08-05T09:00:00Z", reach: 200 }),
    post(3, { published_at: "2026-08-05T09:00:00Z", reach: 200 }),
    ...Array.from({ length: 9 }, (_, i) =>
      post(10 + i, { published_at: "2026-08-06T09:00:00Z", reach: 1000 })),
  ];
  const t = publishTiming(content);
  const wed = t.byDay.find((b) => b.label === "Wednesday");
  const thu = t.byDay.find((b) => b.label === "Thursday");
  assert.ok(wed.lift < thu.lift,
    `one viral post must not make Wednesday the recommendation (wed ${wed.lift}, thu ${thu.lift})`);
});

test("posts are scored against their own format, not against each other", () => {
  // Reels reach ten times what photos reach on this account, and every reel went
  // out on Monday. Without per-format normalisation Monday wins purely because
  // reels landed there, and the advice becomes "post on Monday" when the real
  // finding is "post reels".
  const reels = Array.from({ length: 6 }, (_, i) =>
    post(i, { media_type: "Reel", reach: 10_000, published_at: "2026-08-03T09:00:00Z" }));
  const photos = Array.from({ length: 6 }, (_, i) =>
    post(50 + i, { media_type: "Photo", reach: 1_000, published_at: "2026-08-04T09:00:00Z" }));
  const t = publishTiming([...reels, ...photos]);
  const mon = t.byDay.find((b) => b.label === "Monday");
  const tue = t.byDay.find((b) => b.label === "Tuesday");
  assert.equal(mon.lift, 1, "a format at its own median is typical, not exceptional");
  assert.equal(tue.lift, 1);
});

test("times are the account's own, not UTC", () => {
  // 22:00 UTC on a Monday is 01:00 TUESDAY in Amman. Filing it under Monday
  // night would recommend a slot the creator has never actually posted in.
  const content = Array.from({ length: 12 }, (_, i) =>
    post(i, { published_at: "2026-08-03T22:00:00Z", reach: 1000 }));
  const t = publishTiming(content, 180);
  const tue = t.byDay.find((b) => b.label === "Tuesday");
  assert.equal(tue.posts, 12, "22:00 UTC Monday is Tuesday in Amman");
  const late = t.byBlock.find((b) => /Late night/.test(b.label));
  assert.equal(late.posts, 12, "and it falls in the small hours, not the evening");
});

test("an unreported reach is skipped, never scored as zero", () => {
  const content = [
    ...Array.from({ length: 12 }, (_, i) => post(i, { reach: 1000 })),
    ...Array.from({ length: 5 }, (_, i) => post(50 + i, { reach: null })),
  ];
  const t = publishTiming(content);
  assert.equal(t.measured, 12, "posts with no reach figure are not measured");
});

/* ---- follower cost ------------------------------------------------------- */

test("no unfollow data means no findings, not zero findings", () => {
  // The distinction matters: an empty list with reported:true says "no bad days",
  // which is a claim. reported:false says we cannot see, which is the truth.
  const r = followerCost([day(1), day(2), day(3)], [post(1)], "all");
  assert.equal(r.reported, false);
  assert.equal(r.typical, null);
  assert.deepEqual(r.days, []);
});

test("a spike day is found, and the day's posts are named beside it", () => {
  const metrics = [
    ...Array.from({ length: 9 }, (_, i) => day(i + 1, { unfollows: 2 })),
    day(10, { unfollows: 40 }),
  ];
  const content = [post(1, { published_at: "2026-08-10T12:00:00Z", title: "The one" })];
  const r = followerCost(metrics, content, "all");
  assert.equal(r.reported, true);
  assert.equal(r.typical, 2);
  assert.equal(r.days.length, 1);
  assert.equal(r.days[0].date, "2026-08-10");
  assert.equal(r.days[0].excess, 38);
  assert.deepEqual(r.days[0].posts.map((p) => p.title), ["The one"]);
});

test("typical is the median, so spikes cannot raise the bar that detects them", () => {
  // Three catastrophic days among nine. A MEAN typical would be ~34 and every
  // one of them would sit below 1.5x it, hiding all three. The median is 2.
  const metrics = [
    ...Array.from({ length: 6 }, (_, i) => day(i + 1, { unfollows: 2 })),
    day(7, { unfollows: 100 }), day(8, { unfollows: 100 }), day(9, { unfollows: 100 }),
  ];
  const content = [7, 8, 9].map((d) =>
    post(d, { id: `p${d}`, published_at: `2026-08-0${d}T12:00:00Z` }));
  const r = followerCost(metrics, content, "all");
  assert.equal(r.typical, 2);
  assert.equal(r.days.length, 3, "a mean would have hidden every one of these");
});

test("a quiet day is never blamed on a post that does not exist", () => {
  const metrics = [
    ...Array.from({ length: 9 }, (_, i) => day(i + 1, { unfollows: 2 })),
    day(10, { unfollows: 40 }),
  ];
  // The spike day published nothing.
  const r = followerCost(metrics, [post(1, { published_at: "2026-08-02T12:00:00Z" })], "all");
  assert.deepEqual(r.days, [], "with nothing published there is nothing to point at");
});

test("ordinary variation is not reported as a finding", () => {
  const metrics = Array.from({ length: 10 }, (_, i) => day(i + 1, { unfollows: i % 2 ? 2 : 3 }));
  const content = Array.from({ length: 10 }, (_, i) =>
    post(i, { published_at: `2026-08-${String(i + 1).padStart(2, "0")}T12:00:00Z` }));
  const r = followerCost(metrics, content, "all");
  assert.deepEqual(r.days, [], "3 against a typical 2 is noise, not a story");
});

/* ---- reach multiples ----------------------------------------------------- */

test("reach is divided by the following the post actually had", () => {
  // The account tripled after this post. Dividing by today's 3000 would report
  // 3.3x for a post that reached ten times the audience it was published to.
  const metrics = [
    day(1, { followers: 1000 }),
    day(20, { followers: 3000 }),
  ];
  const content = [post(1, { published_at: "2026-08-02T12:00:00Z", reach: 10_000 })];
  const r = reachMultiples(content, metrics, "all");
  assert.equal(r.length, 1);
  assert.equal(r[0].followers, 1000);
  assert.equal(r[0].times, 10);
});

test("a post with no follower count before it is skipped, not divided by a guess", () => {
  const metrics = [day(20, { followers: 3000 })];
  const content = [post(1, { published_at: "2026-08-02T12:00:00Z", reach: 10_000 })];
  assert.deepEqual(reachMultiples(content, metrics, "all"), [],
    "the only known count comes AFTER the post; using it would be inventing history");
});

/* ---- concentration ------------------------------------------------------- */

test("concentration counts how few posts carry half the reach", () => {
  const content = [
    post(1, { reach: 500 }), post(2, { reach: 300 }),
    post(3, { reach: 100 }), post(4, { reach: 100 }),
  ];
  const c = reachConcentration(content);
  assert.equal(c.totalReach, 1000);
  assert.equal(c.postsForHalf, 1, "the top post alone is half of everything");
  assert.equal(c.topShare, 0.5);
});

test("an even spread needs many posts to reach half", () => {
  const content = Array.from({ length: 10 }, (_, i) => post(i, { reach: 100 }));
  const c = reachConcentration(content);
  assert.equal(c.postsForHalf, 5);
  assert.equal(c.topShare, 0.1);
});

test("nothing reported yields nulls rather than a reassuring shape", () => {
  const c = reachConcentration([post(1, { reach: null }), post(2, { reach: null })]);
  assert.equal(c.totalReach, 0);
  assert.equal(c.postsForHalf, null);
  assert.equal(c.topShare, null);
});
