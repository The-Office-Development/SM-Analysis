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
/**
 * `reports` is what the PLATFORM makes available, not what we chose to show.
 *
 * The demo is the last thing a client sees before they believe the product, so
 * it must not promise a panel the platform cannot fill. LinkedIn is the case
 * that forced this to be explicit: a Company Page reports no follower churn, no
 * discovery split and no page "views", and a demo that generated all three
 * would sell a report nobody can ever deliver — then leave the operator
 * explaining the absence to a paying client. Each `false` below matches a
 * documented absence and a null in `syncLinkedIn`.
 */
interface DemoAccount {
  platform: Platform; id: string; username: string;
  base: number; reachMul: number; er: number; viewMul: number;
  reports: {
    /** A page-level "views" figure distinct from impressions. */
    views: boolean;
    /** Gross follows and unfollows per day. */
    churn: boolean;
    /** Reach split by follower / non-follower. */
    discovery: boolean;
    /** Per-post reach, as opposed to per-post impressions. */
    postReach: boolean;
    /** Saves, and video watch-through. */
    saves: boolean;
    watch: boolean;
  };
}
const FULL = { views: true, churn: true, discovery: true, postReach: true, saves: true, watch: true };
const ACCOUNTS: DemoAccount[] = [
  { platform: "facebook", id: "demo-fb", username: "northwind.co", base: 48200, reachMul: 2.4, er: 3.1, viewMul: 1.2, reports: FULL },
  { platform: "instagram", id: "demo-ig", username: "northwind", base: 71400, reachMul: 2.0, er: 4.7, viewMul: 2.2, reports: FULL },
  { platform: "tiktok", id: "demo-tt", username: "northwind", base: 126800, reachMul: 3.9, er: 6.9, viewMul: 5.2, reports: FULL },
  /*
   * A Company Page, and deliberately the smallest account here. A LinkedIn page
   * with 126k followers would be remarkable; 9.4k is what a Jordanian company
   * page looks like, and the demo is more persuasive for being plausible.
   */
  { platform: "linkedin", id: "demo-li", username: "northwind-co", base: 9400, reachMul: 1.3, er: 2.4, viewMul: 0,
    reports: { views: false, churn: false, discovery: false, postReach: false, saves: false, watch: false } },
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
        followers: Math.round(followers), reach, impressions, engagements,
        /*
         * null where the platform does not report it, exactly as the sync
         * writes it. A demo that filled these in would be teaching a client to
         * expect a churn panel and a discovery split from a LinkedIn page, and
         * the first thing they would do on connecting is ask where they went.
         */
        views: a.reports.views ? views : null,
        follows: a.reports.churn ? follows : null,
        unfollows: a.reports.churn ? unfollows : null,
        reach_followers: a.reports.discovery ? reach_followers : null,
        reach_non_followers: a.reports.discovery ? reach_non_followers : null,
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
  // Company Page posts read differently from creator content: longer, and
  // written for a professional audience. The demo should look like the platform
  // it claims to be rather than the same captions in a different colour.
  linkedin: ["We're hiring: two roles on the delivery team", "What we learned shipping in Ramadan", "Case study: cutting onboarding from 3 weeks to 4 days", "Our take on the new regulation", "Meet the team: engineering", "Quarterly update from the founders", "Why we moved our stack", "Partnering with a Jordanian supplier"],
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
      const isVideo = a.platform !== "facebook" && a.platform !== "linkedin" && r() > 0.35;
      /*
       * LinkedIn's own format vocabulary, which is not the others'. The sync
       * derives these from the post's content union (`linkedInFormat`), so a
       * demo showing "Reel" or "Photo" on a Company Page would be showing a
       * value the product can never produce.
       */
      const liFormat = ["Post", "Article", "Images", "Document", "Video", "Poll"][i % 6];
      items.push({
        id: `${a.id}-c${i}`,
        account_id: a.id,
        platform: a.platform,
        external_id: `${a.id}-c${i}`,
        title,
        media_type: a.platform === "linkedin" ? liFormat
          : a.platform === "facebook" ? "Post"
          : isVideo ? (a.platform === "instagram" ? "Reel" : "Video") : "Photo",
        permalink: null,
        published_at: isoDay(-Math.floor(r() * 80)) + "T12:00:00Z",
        views,
        likes: Math.round(eng * 0.72),
        comments: Math.round(eng * 0.09),
        shares: Math.round(eng * 0.1),
        saves: a.reports.saves ? Math.round(eng * 0.09) : null,
        /*
         * A LinkedIn post has no reach. `uniqueImpressionsCount` exists on the
         * page's daily aggregate but NOT in the per-share response, so the sync
         * stores null rather than copying impressions across — see the comment
         * on `reach` in syncLinkedIn. The demo has to show the same gap, since
         * it is the gap a client will ask about.
         */
        reach: a.reports.postReach ? Math.round(views * (0.8 + r() * 0.3)) : null,
        avg_watch_seconds: isVideo && a.reports.watch ? Math.round(6 + r() * 30) : null,
        retention_pct: isVideo && a.reports.watch ? Math.round(28 + r() * 52) : null,
        // A few minutes ago, as a real sync would leave it. The demo has to show
        // the freshness line too, since that line is half of what stops a client
        // reading a difference against Instagram as an error.
        checked_at: new Date(Date.now() - Math.round(r() * 12 + 1) * 60_000).toISOString(),
      });
    });
  }
  return items.sort((x, y) => (y.views ?? 0) - (x.views ?? 0));
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
/** A page that reports no hourly activity at all — LinkedIn does not. */
const emptyHeat = (): number[][] => Array.from({ length: 7 }, () => Array(24).fill(0));

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
  /*
   * The Company Page. Age and gender are EMPTY on purpose — LinkedIn reports
   * neither, and the Audience page says so in words rather than drawing a bar.
   * What it reports instead is professional, and richer than Instagram's:
   * industry, seniority, job function, company size and market area.
   *
   * "Unknown" is in the industry mix deliberately. LinkedIn caps each facet at
   * its top 100 values and can only classify the followers it has data for, so
   * a real page has a remainder. A demo without one would set an expectation
   * that the first real page breaks.
   */
  {
    account_id: "demo-li", platform: "linkedin", captured_on: isoDay(0),
    age: {}, gender: {},
    countries: { Jordan: 0.44, "United Arab Emirates": 0.17, "Saudi Arabia": 0.12, "United States": 0.11, Egypt: 0.09, Germany: 0.07 },
    devices: {}, active_hours: emptyHeat(),
    dimensions: {
      industry: {
        "Software Development": 0.26, "Advertising Services": 0.16, "Retail Groceries": 0.12,
        "Food and Beverage Manufacturing": 0.1, Banking: 0.08, "Higher Education": 0.07, Unknown: 0.21,
      },
      seniority: { Senior: 0.26, Entry: 0.24, Manager: 0.19, Director: 0.12, Owner: 0.08, Partner: 0.06, Training: 0.05 },
      function: {
        Engineering: 0.21, Marketing: 0.18, "Business Development": 0.14, Operations: 0.12,
        Sales: 0.11, Finance: 0.09, "Quality Assurance": 0.08, Purchasing: 0.07,
      },
      company_size: {
        "2–10 employees": 0.29, "11–50 employees": 0.26, "51–200 employees": 0.18,
        "201–500 employees": 0.12, "1 employee": 0.09, "1001+ employees": 0.06,
      },
      regions: {
        "Amman Governorate, Jordan": 0.38, "Dubai, United Arab Emirates": 0.15,
        "Riyadh, Saudi Arabia": 0.11, "Greater London": 0.08, "Cairo, Egypt": 0.07,
      },
    },
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
