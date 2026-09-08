import type { MetricPoint, ContentItem, Scope } from "./types";

/* ===========================================================================
 * The interpretation layer.
 *
 * These are the figures the product is actually sold on. PROJECT-STATE.md §1 is
 * explicit that a client is buying the work — a sponsor-ready number and an
 * answer to "why did reach move" — not a login. A chart of reach is available in
 * any $20 tool; the split below is not.
 *
 * Every function here returns null rather than a zero or a guess when the
 * platform did not report the underlying figure. A confident wrong number is the
 * failure mode this product cannot survive, and a "0% discovery" badge on a post
 * that actually reached 40,000 strangers is exactly that.
 * ======================================================================== */

const inScope = (m: MetricPoint, scope: Scope) => scope === "all" || m.platform === scope;

/** Sum a nullable column, returning null when NOTHING was ever reported. */
function sumKnown(rows: MetricPoint[], key: keyof MetricPoint): number | null {
  let total = 0, seen = false;
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number") { total += v; seen = true; }
  }
  return seen ? total : null;
}

export interface Discovery {
  followers: number | null;
  nonFollowers: number | null;
  /** Share of attributed reach that went to non-followers, 0..1. */
  discoveryRate: number | null;
  /**
   * True when some reach could not be attributed to either side. Meta returns an
   * UNKNOWN bucket, so the two halves rarely account for all of `reach`, and a
   * UI claiming otherwise would be overstating its own precision.
   */
  partial: boolean;
}

/**
 * How much of the account's reach was people who do not already follow it.
 *
 * This is the number a sponsor is buying. "You have 40,000 followers" says what
 * an account HAS; "63% of last month's reach was non-followers" says what a post
 * will DO for a brand, which is the thing being paid for.
 */
export function discovery(metrics: MetricPoint[], scope: Scope): Discovery {
  const rows = metrics.filter((m) => inScope(m, scope) && !m.provisional);
  const followers = sumKnown(rows, "reach_followers");
  const nonFollowers = sumKnown(rows, "reach_non_followers");
  if (followers === null && nonFollowers === null) {
    return { followers: null, nonFollowers: null, discoveryRate: null, partial: false };
  }
  const attributed = (followers ?? 0) + (nonFollowers ?? 0);
  const totalReach = sumKnown(rows, "reach");
  /*
   * A SPLIT NEEDS BOTH HALVES. Deriving the rate when only one side is known
   * turns "not reported" into a number, and the number is always a lie at one
   * extreme: a missing non-follower half reads as 0% discovery, a missing
   * follower half as 100%.
   *
   * The 0% case is not hypothetical — reach_non_followers has been null on 31
   * of 32 days for one live account, and the panel showed "0% of reach was
   * people who don't follow you · New people 0" to describe a metric Instagram
   * had simply never returned. This is the figure the panel tells a sponsor
   * they are buying, so a false zero here is the most expensive one in the
   * product.
   *
   * A genuine reported 0 still shows as 0. Only null is withheld.
   */
  const bothKnown = followers !== null && nonFollowers !== null;
  return {
    followers, nonFollowers,
    discoveryRate: bothKnown && attributed > 0 ? nonFollowers / attributed : null,
    partial: totalReach !== null && totalReach > attributed,
  };
}

export interface Churn {
  gained: number | null;
  lost: number | null;
  net: number | null;
  /**
   * Followers lost per follower gained, 0..1+. 0.9 means nine leave for every
   * ten who arrive — a treadmill that a net figure of "+40" completely conceals.
   */
  churnRate: number | null;
}

/**
 * Growth with the losses left in.
 *
 * Consumer tools almost universally show net follower change, which is the one
 * number that cannot distinguish a healthy account from one bleeding its
 * audience as fast as it wins it. Both directions come from the same API call.
 */
export function churn(metrics: MetricPoint[], scope: Scope): Churn {
  const rows = metrics.filter((m) => inScope(m, scope) && !m.provisional);
  const gained = sumKnown(rows, "follows");
  const lost = sumKnown(rows, "unfollows");
  if (gained === null && lost === null) return { gained: null, lost: null, net: null, churnRate: null };
  /*
   * Both derived figures need BOTH directions. Treating an unreported side as 0
   * is what the whole panel exists to argue against: `net` would overstate
   * growth by exactly the churn it could not see, and `churnRate` would render
   * the sentence "0 people left for every 100 who arrived" — a claim, stated in
   * words, about a number the platform never sent.
   *
   * unfollows has been null on every day ever stored across two live accounts
   * while follows is populated, so this is the normal case rather than an edge
   * one. A reported 0 is still 0; only null is withheld.
   */
  const bothKnown = gained !== null && lost !== null;
  return {
    gained, lost,
    net: bothKnown ? gained - lost : null,
    churnRate: bothKnown && gained > 0 ? lost / gained : null,
  };
}

export interface FormatRow {
  format: string;
  posts: number;
  reach: number;
  /** Median, not mean: one viral post should not redefine what a format "does". */
  medianReach: number;
  saveRate: number | null;
  shareRate: number | null;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * What each content format actually returns, per post.
 *
 * Totals by format answer the wrong question: an account that posts forty feed
 * images and four Reels will show feed winning on total reach while losing
 * badly per post. The per-post median is the number that changes what someone
 * publishes next week.
 *
 * Save and share rates are separated from likes deliberately — they are the
 * strongest distribution signals on Instagram and the ones a like count hides.
 */
export function formatPerformance(content: ContentItem[]): FormatRow[] {
  const groups = new Map<string, ContentItem[]>();
  for (const c of content) {
    const k = c.media_type || "Post";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const out: FormatRow[] = [];
  for (const [format, items] of groups) {
    // Sum only what was actually reported. Treating an unreported metric as 0
    // does not merely lose information here — it drags a format's median and its
    // save/share rates toward zero, which reads as "this format performs badly"
    // rather than "we have no data on it yet".
    const known = (k: "reach" | "saves" | "shares") =>
      items.map((i) => i[k]).filter((v): v is number => v !== null);
    const reaches = known("reach").filter((r) => r > 0);
    const reach = known("reach").reduce((a, v) => a + v, 0);
    const saves = known("saves").reduce((a, v) => a + v, 0);
    const shares = known("shares").reduce((a, v) => a + v, 0);
    out.push({
      format,
      posts: items.length,
      reach,
      medianReach: median(reaches),
      // Rates need a denominator that actually exists; reach of 0 across a
      // format means unreported, not "nobody saved it".
      saveRate: reach > 0 ? saves / reach : null,
      shareRate: reach > 0 ? shares / reach : null,
    });
  }
  return out.sort((a, b) => b.medianReach - a.medianReach);
}

export interface ReachDriver { label: string; effect: number; detail: string; }

/**
 * Why reach moved between two equal windows.
 *
 * "Reach fell 22%" is where most tools stop, and it is the point at which a
 * client asks the question this product is paid to answer. Reach is decomposed
 * multiplicatively into how much was published and how far each post travelled,
 * so the two effects sum to the observed change:
 *
 *     reach ≈ posts × reach-per-post
 *
 * Returns an empty list rather than a guess when either window is empty; an
 * explanation of a change that cannot be measured is the worst thing this
 * function could produce.
 */
export function reachDrivers(
  current: ContentItem[], previous: ContentItem[],
  currentReach: number | null, previousReach: number | null,
): ReachDriver[] {
  if (!currentReach || !previousReach || previousReach <= 0) return [];
  if (!current.length || !previous.length) return [];

  const perPostNow = currentReach / current.length;
  const perPostBefore = previousReach / previous.length;
  if (perPostBefore <= 0) return [];

  // Volume effect: what reach would have done on the old per-post average.
  const volumeEffect = (current.length - previous.length) * perPostBefore;
  // Efficiency effect: the rest, i.e. each post travelling further or less far.
  const efficiencyEffect = (currentReach - previousReach) - volumeEffect;

  const pct = (n: number) => `${n >= 0 ? "+" : ""}${Math.round((n / previousReach) * 100)}%`;
  return [
    {
      label: "How much you posted",
      effect: volumeEffect,
      detail: `${previous.length} → ${current.length} posts (${pct(volumeEffect)})`,
    },
    {
      label: "How far each post travelled",
      effect: efficiencyEffect,
      detail: `${Math.round(perPostBefore).toLocaleString()} → ${Math.round(perPostNow).toLocaleString()} reach per post (${pct(efficiencyEffect)})`,
    },
  ].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

export interface PostContext {
  /** Median of this metric across other posts of the SAME format, or null. */
  median: number | null;
  /** Ratio to that median. 1.4 means 40% above. Null when either side is unknown. */
  vsMedian: number | null;
  /** How many comparable posts the median rests on. One post is not a baseline. */
  sample: number;
}

/**
 * Put one post's number in context.
 *
 * A figure alone cannot answer "should I keep this?" — 800 reach is excellent
 * for one account and a failure for another, and it means different things for a
 * Reel than for a carousel. The comparison is the product; the number is only
 * the input.
 *
 * Compared against the MEDIAN of the same format, never the mean: one viral post
 * drags a mean so far that every other post looks like a failure. This account
 * has a reel at 4.8M views against a typical few thousand — a mean would make
 * its entire normal output look broken.
 *
 * `sample` is returned rather than hidden because a median over two posts is not
 * a baseline, and the UI must be able to say so instead of implying authority it
 * does not have.
 */
export function postContext(
  post: ContentItem,
  all: ContentItem[],
  key: "views" | "reach" | "likes" | "comments" | "shares" | "saves",
): PostContext {
  const peers = all
    .filter((c) => c.id !== post.id && c.platform === post.platform && (c.media_type || "Post") === (post.media_type || "Post"))
    .map((c) => c[key])
    .filter((v): v is number => v !== null);

  if (!peers.length) return { median: null, vsMedian: null, sample: 0 };
  const med = median(peers);
  const own = post[key];
  return {
    median: med,
    // A median of 0 gives no ratio worth showing rather than an infinity.
    vsMedian: own !== null && med > 0 ? own / med : null,
    sample: peers.length,
  };
}

/** Hours since publication. Negative values (clock skew) clamp to 0. */
export function ageHours(publishedAt: string): number {
  return Math.max(0, (Date.now() - Date.parse(publishedAt)) / 3_600_000);
}

/**
 * Is this post too young for its numbers to mean anything?
 *
 * Instagram reports nothing for the first minutes and keeps counting for days.
 * Judging a post at two hours is judging noise, and the product should say so
 * rather than let someone delete a post that was doing fine.
 */
export function tooEarly(publishedAt: string): boolean {
  return ageHours(publishedAt) < 24;
}

export interface PostRank {
  /** 1 = best. Null when this post's value is unreported. */
  rank: number | null;
  /** How many posts had a reported value for this metric. */
  of: number;
  /** Highest reported value among them — the scale a bar should be drawn against. */
  best: number | null;
}

/**
 * Where this post sits among the account's own posts.
 *
 * Ranked against every post on the same platform, NOT just the same format.
 * Format is the right comparison for "is this good for a carousel"; rank is the
 * right one for "is this one of my best", and a creator asks both.
 *
 * Posts with an unreported value are excluded from the ranking rather than
 * treated as zero — otherwise every pre-conversion post would crowd the bottom
 * and make a mediocre recent post look like a triumph.
 */
export function postRank(
  post: ContentItem,
  all: ContentItem[],
  key: "views" | "reach" | "likes" | "comments" | "shares" | "saves",
): PostRank {
  const pool = all.filter((c) => c.platform === post.platform && c[key] !== null);
  const values = pool.map((c) => c[key] as number).sort((a, b) => b - a);
  const own = post[key];
  return {
    rank: own === null ? null : values.indexOf(own) + 1,
    of: values.length,
    best: values.length ? values[0] : null,
  };
}

export interface EngagementSplit {
  parts: { key: string; label: string; value: number }[];
  total: number | null;
}

/**
 * What KIND of engagement a post earned.
 *
 * The composition says more than the total. Saves and shares are intent —
 * someone kept it or passed it on — while likes are the cheapest possible
 * signal. Two posts with identical engagement counts can mean entirely
 * different things, and a sponsor cares about the difference.
 *
 * Only reported components appear. An unreported one is omitted rather than
 * drawn as an empty slice, which would read as "nobody saved this".
 */
export function engagementSplit(post: ContentItem): EngagementSplit {
  const parts: { key: string; label: string; value: number }[] = [];
  for (const [key, label] of [
    ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["saves", "Saves"],
  ] as const) {
    const v = post[key];
    if (v !== null) parts.push({ key, label, value: v });
  }
  return { parts, total: parts.length ? parts.reduce((a, p) => a + p.value, 0) : null };
}

/* ===========================================================================
 * The deep layer.
 *
 * Everything above re-presents figures Instagram also shows, arranged to answer
 * a question. Everything below computes something Instagram does not compute at
 * all, from data only a tool that KEEPS history can hold.
 *
 * The same rule governs it: a bucket with too few posts behind it reports its
 * sample and refuses to state a result. An analysis is easier to fabricate than
 * a metric, because nobody can check it against their phone.
 * ======================================================================== */

/** Local calendar parts of an ISO timestamp at a fixed UTC offset. */
function localParts(iso: string, tzOffsetMinutes: number): { day: number; hour: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + tzOffsetMinutes * 60_000);
  return { day: d.getUTCDay(), hour: d.getUTCHours() };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BLOCKS = [
  { from: 0, to: 6, label: "Late night, midnight to 6am" },
  { from: 6, to: 10, label: "Morning, 6am to 10am" },
  { from: 10, to: 14, label: "Midday, 10am to 2pm" },
  { from: 14, to: 18, label: "Afternoon, 2pm to 6pm" },
  { from: 18, to: 21, label: "Evening, 6pm to 9pm" },
  { from: 21, to: 24, label: "Night, 9pm to midnight" },
];

/** A day or a part of the day, with how this account's posts did in it. */
export interface TimingBucket {
  key: string;
  label: string;
  /** Posts published in this bucket that had a reach figure to measure. */
  posts: number;
  /**
   * How this bucket compares with this account's own normal. 1 is typical, 1.4
   * is 40% better than typical. Null when too few posts landed here to say.
   */
  lift: number | null;
}

export interface Timing {
  byDay: TimingBucket[];
  byBlock: TimingBucket[];
  /** Posts that could be measured at all. */
  measured: number;
  /** Whether the whole analysis rests on enough posts to be worth reading. */
  enough: boolean;
}

/** A bucket needs this many posts before it is allowed to state a result. */
export const TIMING_MIN_POSTS = 3;
/** And the account needs this many overall before any of it is shown. */
export const TIMING_MIN_TOTAL = 12;

/**
 * When this account's posts ACTUALLY did well.
 *
 * Instagram shows when followers are online. That is a different question, and
 * the gap between them is the entire point: being online is not the same as
 * watching, and a creator who posts into a busy hour and gets nothing has been
 * told the truth about their audience and nothing about their results.
 *
 * This reads the outcome instead. Every post is scored against the MEDIAN OF ITS
 * OWN FORMAT, so a bucket does not win merely because reels happened to land in
 * it, and the buckets are then compared on the median of those ratios so a
 * single viral post cannot carry an hour on its own.
 *
 * Days and parts-of-day are reported SEPARATELY, not as a grid. Seven days by
 * six blocks is forty-two cells, and a hundred posts spread over forty-two cells
 * is one or two per cell: a grid would look far more precise than the evidence
 * behind it, and it would recommend "Tuesday at 7pm" on the strength of a single
 * post. Two coarse rankings are less impressive and considerably more honest.
 *
 * Times are the account's own local time, defaulting to Amman.
 */
export function publishTiming(content: ContentItem[], tzOffsetMinutes = 180): Timing {
  // Score each post against the typical post OF ITS FORMAT. Reach of 0 is
  // excluded rather than scored: it is unreported far more often than it is a
  // real zero, and a fabricated 0.0 ratio would drag a whole bucket down.
  const byFormat = new Map<string, number[]>();
  for (const c of content) {
    if (typeof c.reach !== "number" || c.reach <= 0) continue;
    const k = c.media_type || "Post";
    if (!byFormat.has(k)) byFormat.set(k, []);
    byFormat.get(k)!.push(c.reach);
  }
  const formatMedian = new Map<string, number>();
  for (const [k, xs] of byFormat) formatMedian.set(k, median(xs));

  const dayRatios = new Map<number, number[]>();
  const blockRatios = new Map<number, number[]>();
  let measured = 0;

  for (const c of content) {
    if (typeof c.reach !== "number" || c.reach <= 0) continue;
    const base = formatMedian.get(c.media_type || "Post");
    if (!base || base <= 0) continue;
    const at = localParts(c.published_at, tzOffsetMinutes);
    if (!at) continue;

    const ratio = c.reach / base;
    measured++;

    if (!dayRatios.has(at.day)) dayRatios.set(at.day, []);
    dayRatios.get(at.day)!.push(ratio);

    const bi = BLOCKS.findIndex((b) => at.hour >= b.from && at.hour < b.to);
    if (bi >= 0) {
      if (!blockRatios.has(bi)) blockRatios.set(bi, []);
      blockRatios.get(bi)!.push(ratio);
    }
  }

  const bucket = (key: string, label: string, xs: number[] | undefined): TimingBucket => ({
    key, label,
    posts: xs?.length ?? 0,
    // Below the threshold the count is still reported and the result is not.
    // "We have two posts on a Friday" is useful; "Fridays are 60% better" on the
    // strength of those two posts is a guess wearing a number's clothes.
    lift: xs && xs.length >= TIMING_MIN_POSTS ? median(xs) : null,
  });

  const byDay = DAY_NAMES.map((label, i) => bucket(String(i), label, dayRatios.get(i)))
    .sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1));
  const byBlock = BLOCKS.map((b, i) => bucket(String(i), b.label, blockRatios.get(i)))
    .sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1));

  return { byDay, byBlock, measured, enough: measured >= TIMING_MIN_TOTAL };
}

/* ---- what a post cost ---------------------------------------------------- */

export interface FollowerCostDay {
  date: string;
  unfollows: number;
  /** This account's typical daily loss, for comparison. */
  typical: number;
  /** How far above typical this day ran. */
  excess: number;
  posts: { id: string; title: string }[];
}

export interface FollowerCost {
  /** False when the platform has never reported unfollows; then nothing below means anything. */
  reported: boolean;
  typical: number | null;
  days: FollowerCostDay[];
}

/**
 * The days that cost followers, and what went out on them.
 *
 * Instagram reports follower losses as a total and never says which day, let
 * alone which post. A creator therefore learns that something is driving people
 * away and has no way to find out what. This is the question they ask most and
 * the one no native tool answers.
 *
 * It is a CORRELATION and the interface must say so. A post published on a bad
 * day did not necessarily cause the losses: an account can shed followers
 * because of a story, a comment, a collaboration, a purge of inactive accounts,
 * or nothing at all. What this does is narrow the search from a month to a day
 * and put the day's output beside the number, which is as far as the data can
 * honestly go.
 *
 * "Typical" is the MEDIAN daily loss, not the mean. Means are dragged by exactly
 * the spike days being looked for, so a mean would raise the bar in proportion
 * to the thing it is supposed to detect and hide the worst days.
 */
export function followerCost(
  metrics: MetricPoint[], content: ContentItem[], scope: Scope,
): FollowerCost {
  const rows = metrics.filter((m) => inScope(m, scope));
  const losses = rows.map((r) => r.unfollows).filter((v): v is number => typeof v === "number");
  if (!losses.length) return { reported: false, typical: null, days: [] };

  const typical = median(losses);

  const postsByDay = new Map<string, { id: string; title: string }[]>();
  for (const c of content) {
    const day = c.published_at.slice(0, 10);
    if (!postsByDay.has(day)) postsByDay.set(day, []);
    postsByDay.get(day)!.push({ id: c.id, title: c.title || "Untitled" });
  }

  const days: FollowerCostDay[] = [];
  for (const r of rows) {
    if (typeof r.unfollows !== "number") continue;
    const posts = postsByDay.get(r.date);
    if (!posts?.length) continue;   // nothing published, nothing to point at
    const excess = r.unfollows - typical;
    // Half again above normal AND at least two people. On a small account a
    // ratio alone fires on the difference between one leaver and two, which is
    // noise dressed as a finding.
    if (r.unfollows >= typical * 1.5 && excess >= 2) {
      days.push({ date: r.date, unfollows: r.unfollows, typical, excess, posts });
    }
  }

  days.sort((a, b) => b.excess - a.excess);
  return { reported: true, typical, days };
}

/* ---- reach against the size of the account ------------------------------- */

export interface ReachMultiple {
  id: string;
  title: string;
  date: string;
  reach: number;
  followers: number;
  /** Reach divided by the follower count on the day it went out. */
  times: number;
}

/**
 * How far past the account's own following a post travelled.
 *
 * 40,000 reach means nothing on its own. Against 4,000 followers it means the
 * post escaped the audience entirely and found ten times as many strangers,
 * which is the single most useful sentence a creator can put in front of a
 * sponsor. Instagram shows the reach and never divides.
 *
 * The denominator is the follower count ON THE DAY, not today's. An account that
 * has since tripled would otherwise have its best old post quietly demoted, and
 * the number would drift every time the account grew.
 */
export function reachMultiples(
  content: ContentItem[], metrics: MetricPoint[], scope: Scope,
): ReachMultiple[] {
  const followerDays = metrics
    .filter((m) => inScope(m, scope) && typeof m.followers === "number" && m.followers > 0)
    .map((m) => ({ date: m.date, followers: m.followers as number }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!followerDays.length) return [];

  const out: ReachMultiple[] = [];
  for (const c of content) {
    if (typeof c.reach !== "number" || c.reach <= 0) continue;
    const day = c.published_at.slice(0, 10);
    // The most recent known count on or before the publish day. Falling forward
    // to a LATER count would divide by an audience the post never had.
    let followers: number | null = null;
    for (const f of followerDays) {
      if (f.date <= day) followers = f.followers;
      else break;
    }
    if (followers === null || followers <= 0) continue;
    out.push({
      id: c.id, title: c.title || "Untitled", date: day,
      reach: c.reach, followers, times: c.reach / followers,
    });
  }
  return out.sort((a, b) => b.times - a.times);
}

/* ---- how much of the account rests on how little ------------------------- */

export interface Concentration {
  posts: number;
  totalReach: number;
  /** How many posts it takes to account for half of all reach. */
  postsForHalf: number | null;
  /** The best post's share of all reach. */
  topShare: number | null;
}

/**
 * How concentrated the account's reach is.
 *
 * Two accounts with the same monthly reach are different businesses if one got
 * it from twenty posts and the other from one. The second is a lucky month, not
 * a channel, and it will look like a collapse next month through no fault of
 * anyone's.
 *
 * A sponsor buying on last month's total is buying the first case and being sold
 * the second, so this is a number that protects the client's credibility as much
 * as it informs them. Nothing native computes it.
 */
export function reachConcentration(content: ContentItem[]): Concentration {
  const reaches = content
    .map((c) => c.reach)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => b - a);

  const totalReach = reaches.reduce((a, v) => a + v, 0);
  if (!reaches.length || totalReach <= 0) {
    return { posts: reaches.length, totalReach: 0, postsForHalf: null, topShare: null };
  }

  let running = 0, postsForHalf = reaches.length;
  for (let i = 0; i < reaches.length; i++) {
    running += reaches[i];
    if (running >= totalReach / 2) { postsForHalf = i + 1; break; }
  }

  return {
    posts: reaches.length,
    totalReach,
    postsForHalf,
    topShare: reaches[0] / totalReach,
  };
}
