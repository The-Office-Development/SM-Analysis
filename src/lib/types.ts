export type Platform = "facebook" | "instagram" | "tiktok";

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: Platform;
  external_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  status: "connected" | "expired" | "revoked";
  connected_at: string;
  last_synced_at: string | null;
}

/** One day of metrics for one account (rows come from metrics_daily). */
export interface MetricPoint {
  account_id: string;
  platform: Platform;
  date: string; // YYYY-MM-DD
  // null means the platform did not report this metric for this day. It is NOT
  // zero, and it must never be rendered or summed as if it were.
  followers: number | null;
  reach: number | null;
  impressions: number | null;
  views: number | null;
  engagements: number | null;
  /** Gross follows and unfollows. null = the platform did not report it. */
  follows?: number | null;
  unfollows?: number | null;
  /**
   * Reach split by whether the viewer already follows the account. These do NOT
   * sum to `reach` — Meta returns an UNKNOWN bucket as well.
   */
  reach_followers?: number | null;
  reach_non_followers?: number | null;
  /** The day is still settling; treat it as incomplete, not as a decline. */
  provisional?: boolean;
}

export interface ContentItem {
  id: string;
  account_id: string;
  platform: Platform;
  external_id: string;
  title: string;
  media_type: string; // Reel / Video / Photo / Post ...
  permalink: string | null;
  published_at: string;
  // null means the platform did not report the figure — NOT zero. A brand-new
  // post has nulls because Instagram has not counted it yet. See migration 0009.
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  avg_watch_seconds: number | null;
  retention_pct: number | null;
  // When these figures were last read from the platform, by the sync or by an
  // on-demand check. null for rows written before migration 0013. Shown to the
  // client so a gap against Instagram's own app reads as a timing difference
  // rather than as a wrong number.
  checked_at: string | null;
}

export interface AudienceSnapshot {
  account_id: string;
  platform: Platform;
  captured_on: string;
  age: Record<string, number>;    // "18-24" -> share 0..1
  gender: Record<string, number>; // "female"/"male"/"other" -> share
  countries: Record<string, number>;
  devices: Record<string, number>;
  active_hours: number[][];       // [7][24] activity intensity
}

export type GoalMetric = "followers" | "reach" | "views" | "engagements";
export interface Goal {
  id: string;
  user_id: string;
  metric: GoalMetric;
  scope: Scope;         // "all" or a specific platform
  target: number;
  due_date: string | null;
  created_at: string;
}

/**
 * How many days of history the dashboard is showing.
 *
 * Was a union of 7 | 30 | 90. Widened to a plain day count so a client can ask
 * for their own window — a campaign that ran for eleven days is not served by
 * being rounded up to thirty, and a sponsor report covering "the month we paid
 * for" needs to cover exactly that.
 *
 * Every consumer already reads it as a number of days (`isoDaysAgo(range)`,
 * "Last N days"), so nothing downstream had to change. `RANGE_PRESETS` keeps the
 * three common windows as buttons, and `clampRange` guards the input.
 */
export type Range = number;

/** The buttons. Everything else arrives through the custom field. */
export const RANGE_PRESETS = [7, 30, 90] as const;

/**
 * The furthest back a window may reach.
 *
 * Meta serves roughly two years of account insights, so asking for more cannot
 * return anything and only makes a slower query and a chart with a long empty
 * tail. One day is the floor because a zero-day window has no meaning.
 */
export const RANGE_MIN = 1;
export const RANGE_MAX = 730;

export function clampRange(days: number): Range {
  if (!Number.isFinite(days)) return 30;
  return Math.min(RANGE_MAX, Math.max(RANGE_MIN, Math.round(days)));
}
export type Scope = "all" | Platform;
