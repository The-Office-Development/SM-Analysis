export type Platform = "facebook" | "instagram" | "tiktok" | "linkedin";

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
  /**
   * The client must re-authorise this account from a browser.
   *
   * Distinct from `status: "expired"`, which is what an account becomes AFTER it
   * has stopped working. This is the warning before that: the connection is
   * still live and still syncing, and a single click renews it silently. Once it
   * lapses the same click becomes a full consent screen, which for a LinkedIn
   * Company Page means finding an administrator. See migration 0014.
   */
  needs_reauth?: boolean;
  /**
   * Write-capable permissions the token was OBSERVED to hold. `[]` is a complete
   * clean audit; null with no `scopes_checked_at` is "not audited", which must
   * never be shown as clean.
   */
  write_scopes?: string[] | null;
  /** How the account was connected: e.g. "linkedin_member" for a personal profile, "linkedin_organization" for a page. */
  auth_mode?: string | null;
  scopes_checked_at?: string | null;
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
  /*
   * Stories only (migration 0010). Instagram reports replies and navigation for
   * a story and nothing for likes or saves, so those stay null here — absence of
   * a figure a platform never reports, not a zero.
   */
  replies: number | null;
  navigation: number | null;
  /*
   * The rest of what Instagram reports for a story (migration 0019). Every one
   * is null on a post, which has none of them, and null on a story Instagram has
   * not measured yet. `interactions` is Meta's own total_interactions.
   */
  total_views: number | null;
  reposts: number | null;
  interactions: number | null;
  profile_visits: number | null;
  profile_activity: number | null;
  follows: number | null;
  link_clicks: number | null;
  facebook_views: number | null;
  /** The story_navigation_action_type split: tap_forward, tap_back, tap_exit, swipe_forward. */
  navigation_breakdown: Record<string, number> | null;
  /** When a story stops being retrievable: 24 hours after it was posted. */
  expires_at: string | null;
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
  /**
   * Breakdowns that are not age, gender or country, keyed by dimension name —
   * `industry`, `seniority`, `function`, `company_size`, `association`,
   * `regions`. LinkedIn reports professional facets instead of demographic
   * ones, and they do not fit the four columns above (migration 0015).
   *
   * Optional because every snapshot written before 0015 lacks it.
   */
  dimensions?: Record<string, Record<string, number>>;
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
