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
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
  avg_watch_seconds: number | null;
  retention_pct: number | null;
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

export type Range = 7 | 30 | 90;
export type Scope = "all" | Platform;
