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
