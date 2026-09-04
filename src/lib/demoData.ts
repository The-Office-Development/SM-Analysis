import type {
  SocialAccount, MetricPoint, ContentItem, AudienceSnapshot, Goal, GoalMetric, Platform, Range, Scope,
} from "./types";

/* ===========================================================================
   Preview / demo mode
   A fully clickable dashboard with clearly-labelled SAMPLE data and no login,
   so the UI can be shown to a client before any backend is provisioned.
   Toggled via sessionStorage so the data-layer (api.ts) can serve sample data.
   =========================================================================== */

const KEY = "pb-demo";
export const isDemoMode = () => {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
};
export const enterDemo = () => { try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ } };
export const exitDemo = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

/* --------------------------- deterministic RNG --------------------------- */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = 90;
function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const nowIso = () => new Date().toISOString();

/* ------------------------------- accounts -------------------------------- */
const ACCOUNTS: { platform: Platform; id: string; username: string; base: number; reachMul: number; er: number; viewMul: number }[] = [
  { platform: "facebook", id: "demo-fb", username: "northwind.co", base: 48200, reachMul: 2.4, er: 3.1, viewMul: 1.2 },
  { platform: "instagram", id: "demo-ig", username: "northwind", base: 71400, reachMul: 2.0, er: 4.7, viewMul: 2.2 },
  { platform: "tiktok", id: "demo-tt", username: "northwind", base: 126800, reachMul: 3.9, er: 6.9, viewMul: 5.2 },
];

export const demoAccounts: SocialAccount[] = ACCOUNTS.map((a, i) => ({
  id: a.id,
  user_id: "demo",
  platform: a.platform,
  external_id: a.id,
  username: a.username,
  display_name: "Northwind & Co.",
  avatar_url: null,
  status: "connected",
  connected_at: isoDay(-DAYS + 1) + "T09:00:00Z",
  last_synced_at: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
}));

/* ------------------------------- metrics --------------------------------- */
export const demoMetrics: MetricPoint[] = (() => {
  const rows: MetricPoint[] = [];
  for (const a of ACCOUNTS) {
    const r = mulberry32(hash(a.id));
    const growth = 0.0018 + r() * 0.004;
    let followers = a.base / Math.pow(1 + growth, DAYS);
    for (let i = DAYS - 1; i >= 0; i--) {
      const date = isoDay(-i);
      const dow = new Date(date + "T00:00:00Z").getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 1.12 : 1;
      const wobble = 1 + (r() - 0.5) * 0.16;
      const spike = r() > 0.94 ? 1.5 + r() : 1;
      followers *= 1 + growth * (0.6 + r() * 0.9);
      const reach = Math.round(followers * a.reachMul * weekend * wobble * spike);
      const impressions = Math.round(reach * (1.25 + r() * 0.25));
      const views = Math.round(followers * a.viewMul * weekend * wobble * spike);
      const engagements = Math.round((reach * a.er) / 100 * (0.85 + r() * 0.3));

      // The breakdowns the sponsor-facing panels read. Modelled, not copied from
      // anyone's real account: a healthy-but-not-flawless mix, so the demo shows
      // what the panels do rather than an implausibly perfect one.
      // The two reach halves deliberately fall short of `reach` — the platform
      // returns an UNKNOWN bucket, and a demo that summed exactly would teach
      // the wrong expectation.
      const discoveryShare = 0.55 + (r() - 0.5) * 0.18;
      const attributed = Math.round(reach * (0.88 + r() * 0.07));
      const reach_non_followers = Math.round(attributed * discoveryShare);
      const reach_followers = attributed - reach_non_followers;
      const follows = Math.round(followers * growth * (1.6 + r() * 0.7)) + 3;
      const unfollows = Math.round(follows * (0.45 + r() * 0.3));

      rows.push({
        account_id: a.id, platform: a.platform, date,
        followers: Math.round(followers), reach, impressions, views, engagements,
        follows, unfollows, reach_followers, reach_non_followers,
      });
    }
  }
  return rows;
})();

export function demoMetricsInRange(range: Range): MetricPoint[] {
  const from = isoDay(-(range - 1));
  return demoMetrics.filter((m) => m.date >= from);
}

/* ------------------------------- content --------------------------------- */
const TITLES: Record<Platform, string[]> = {
  facebook: ["Behind the scenes of our new launch", "Community Q&A: your questions answered", "5 things we learned this quarter", "Customer spotlight: Sara's story", "Live event recap", "New feature walkthrough", "Weekend giveaway announcement", "How we build in public"],
  instagram: ["Golden hour photo dump", "Reel: 3 quick styling tips", "Carousel: before and after", "Studio tour in 60 seconds", "This or that? Drop your pick", "Monday motivation reel", "Product close-up shots", "Trend remix"],
  tiktok: ["POV: your first day here", "This trend but make it real", "Tutorial in 15 seconds", "Duet with our biggest fan", "Day in the life", "Rating your suggestions", "Green screen explainer", "Satisfying process clip"],
};

export const demoContent: ContentItem[] = (() => {
  const items: ContentItem[] = [];
  for (const a of ACCOUNTS) {
    const r = mulberry32(hash(a.id + "content"));
    const last = demoMetrics.filter((m) => m.account_id === a.id).at(-1)!;
    TITLES[a.platform].forEach((title, i) => {
      const viral = r() > 0.8 ? 2.2 + r() * 3 : 0.5 + r() * 1.1;
      const views = Math.round((last.reach ?? 0) * viral * (a.platform === "tiktok" ? 1.6 : 1));
      const er = a.er * (0.5 + r() * 1.6);
      const eng = Math.round((views * er) / 100);
      const isVideo = a.platform !== "facebook" && r() > 0.35;
      items.push({
        id: `${a.id}-c${i}`,
        account_id: a.id,
        platform: a.platform,
        external_id: `${a.id}-c${i}`,
        title,
        media_type: a.platform === "facebook" ? "Post" : isVideo ? (a.platform === "instagram" ? "Reel" : "Video") : "Photo",
        permalink: null,
        published_at: isoDay(-Math.floor(r() * 80)) + "T12:00:00Z",
        views,
        likes: Math.round(eng * 0.72),
        comments: Math.round(eng * 0.09),
        shares: Math.round(eng * 0.1),
        saves: Math.round(eng * 0.09),
        reach: Math.round(views * (0.8 + r() * 0.3)),
        avg_watch_seconds: isVideo ? Math.round(6 + r() * 30) : null,
        retention_pct: isVideo ? Math.round(28 + r() * 52) : null,
      });
    });
  }
  return items.sort((x, y) => y.views - x.views);
})();

/* ------------------------------ audience --------------------------------- */
function heat(seed: number): number[][] {
  const r = mulberry32(seed);
  const grid: number[][] = [];
  for (let d = 0; d < 7; d++) {
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      let v = Math.exp(-Math.pow(h - 19, 2) / 26) + 0.5 * Math.exp(-Math.pow(h - 12, 2) / 16) + 0.15;
      if (d === 0 || d === 6) v *= 1.15;
      row.push(v * (0.7 + r() * 0.6));
    }
    grid.push(row);
  }
  return grid;
}
export const demoAudience: AudienceSnapshot[] = [
  {
    account_id: "demo-ig", platform: "instagram", captured_on: isoDay(0),
    age: { "13-17": 0.06, "18-24": 0.33, "25-34": 0.34, "35-44": 0.16, "45-54": 0.07, "55+": 0.04 },
    gender: { female: 0.58, male: 0.4, other: 0.02 },
    countries: { "United States": 0.31, Brazil: 0.14, "United Kingdom": 0.11, Germany: 0.09, India: 0.08, France: 0.06 },
    devices: {}, active_hours: heat(11),
  },
  {
    account_id: "demo-fb", platform: "facebook", captured_on: isoDay(0),
    age: { "18-24": 0.16, "25-34": 0.3, "35-44": 0.26, "45-54": 0.16, "55+": 0.12 },
    gender: { female: 0.47, male: 0.52, other: 0.01 },
    countries: { "United States": 0.36, "United Kingdom": 0.13, Canada: 0.1, Australia: 0.08, Germany: 0.07, France: 0.05 },
    devices: {}, active_hours: heat(22),
  },
];

/* -------------------------------- goals ---------------------------------- */
let demoGoals: Goal[] = [
  { id: "demo-g1", user_id: "demo", metric: "followers", scope: "all", target: 260000, due_date: isoDay(45), created_at: nowIso() },
  { id: "demo-g2", user_id: "demo", metric: "views", scope: "tiktok", target: 5_000_000, due_date: null, created_at: nowIso() },
];
export const getDemoGoals = (): Goal[] => [...demoGoals];
export function createDemoGoal(g: Pick<Goal, "metric" | "scope" | "target" | "due_date">): Goal {
  const goal: Goal = {
    id: "demo-" + Math.random().toString(36).slice(2, 9),
    user_id: "demo", metric: g.metric as GoalMetric, scope: g.scope as Scope,
    target: g.target, due_date: g.due_date, created_at: nowIso(),
  };
  demoGoals = [...demoGoals, goal];
  return goal;
}
export function deleteDemoGoal(id: string) {
  demoGoals = demoGoals.filter((g) => g.id !== id);
}

function hash(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return h >>> 0;
}
