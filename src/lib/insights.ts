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
  return {
    followers, nonFollowers,
    discoveryRate: attributed > 0 ? (nonFollowers ?? 0) / attributed : null,
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
  return {
    gained, lost,
    net: (gained ?? 0) - (lost ?? 0),
    churnRate: gained && gained > 0 ? (lost ?? 0) / gained : null,
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
    const reaches = items.map((i) => i.reach).filter((r) => r > 0);
    const reach = items.reduce((a, i) => a + i.reach, 0);
    const saves = items.reduce((a, i) => a + i.saves, 0);
    const shares = items.reduce((a, i) => a + i.shares, 0);
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
