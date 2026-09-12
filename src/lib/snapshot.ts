import type { useDash } from "../context/DashboardContext";
import { seriesByDay, followersByDay, sum, latest, engagementRate } from "./api";
import { periodCompare, bestTimes, anomalies } from "./analytics";
import {
  publishTiming, followerCost, reachMultiples, reachConcentration, totalReported,
} from "./insights";
import { PLATFORMS } from "./platforms";
import { accountLabel } from "./reportMeta";
import type { Platform } from "./types";

type Dash = ReturnType<typeof useDash>;

/**
 * A fully self-contained, serialisable report. Everything the sheet needs is
 * pre-computed here so a shared copy renders with no database access and never
 * carries a raw metric row (or a token).
 */
export interface ReportSnapshot {
  v: 1;
  generatedAt: string;         // ISO
  /** Whose account this describes. A report that cannot say is not usable evidence. */
  account?: string;
  scopeLabel: string;
  range: number;
  headline: { label: string; total: number | null; deltaPct: number | null }[];
  engagementRate: number;
  /*
   * reach / views / engagements are nullable: a platform that does not report a
   * figure has no total, and a zero here is read by the AI assistant and printed
   * in a sponsor's report as if it were measured. `followers` stays a number —
   * every platform reports a follower count.
   */
  platforms: { name: string; followers: number; reach: number | null; views: number | null; engagements: number | null }[];
  top: { title: string; platform: string; views: number | null; likes: number | null; comments: number | null }[];
  windows: string[];
  alerts: { label: string; kind: "spike" | "drop"; deltaPct: number; date: string }[];
  /*
   * The analysis Instagram does not do.
   *
   * Carried in the snapshot rather than recomputed by the sheet, because the
   * same object is what a SHARED report is rendered from — with no database, no
   * session and no metric rows. Leaving these out of it would mean the version a
   * sponsor opens is the thin one, which is precisely backwards: the sponsor is
   * the reader these figures were written for.
   *
   * `analysis` is optional so a link shared before this existed still renders.
   */
  analysis?: {
    /** Days ranked by how this account's own posts performed. Empty when too few. */
    timing: { label: string; lift: number; posts: number }[];
    timingMeasured: number;
    /** False when the platform has never reported unfollows; then costDays means nothing. */
    costReported: boolean;
    costTypical: number | null;
    costDays: { date: string; unfollows: number; typical: number; posts: string[] }[];
    multiples: { title: string; date: string; reach: number; followers: number; times: number }[];
    concentration: { posts: number; postsForHalf: number; topSharePct: number } | null;
  };
}

export function buildSnapshot(dash: Dash): ReportSnapshot {
  const scopeLabel = dash.scope === "all" ? "All platforms" : PLATFORMS[dash.scope as Platform].name;
  const cmp = periodCompare(dash.metrics, dash.scope);

  const headline = cmp.map((c) => ({
    label: c.label,
    total: c.key === "followers"
      ? latest(followersByDay(dash.metrics, dash.scope))
      : totalReported(seriesByDay(dash.metrics, dash.scope, c.key)),
    /*
     * No total, no trend. periodCompare returns deltaPct 0 for a metric with no
     * days to compare, and the report printed "n/a  0%" beside each other — a
     * movement reported for a figure that does not exist. `delta()` already
     * renders null as n/a; it was simply never given one.
     */
    deltaPct: c.reported ? c.deltaPct : null,
  }));

  const scopedPlatforms: Platform[] =
    dash.scope === "all" ? dash.connectedPlatforms : [dash.scope as Platform];

  const platforms = dash.connectedPlatforms.map((p) => ({
    name: PLATFORMS[p].name,
    followers: latest(followersByDay(dash.metrics, p)),
    reach: totalReported(seriesByDay(dash.metrics, p, "reach")),
    views: totalReported(seriesByDay(dash.metrics, p, "views")),
    engagements: totalReported(seriesByDay(dash.metrics, p, "engagements")),
  }));

  const top = [...dash.content]
    .filter((c) => dash.scope === "all" || c.platform === dash.scope)
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1))
    .slice(0, 10)
    .map((c) => ({
      title: c.title || "Untitled",
      platform: PLATFORMS[c.platform as Platform].name,
      views: c.views, likes: c.likes, comments: c.comments,
    }));

  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    account: accountLabel(dash.accounts),
    scopeLabel,
    range: dash.range,
    headline,
    engagementRate: engagementRate(dash.metrics, dash.scope),
    platforms,
    top,
    /*
     * SCOPED, not every connected platform.
     *
     * This passed dash.connectedPlatforms, so a report scoped to LinkedIn —
     * which reports no hourly activity whatever — printed "Best times to post:
     * Saturday 7pm, Sunday 8pm" derived from the INSTAGRAM audience. A sponsor-
     * facing document recommending posting times for the wrong account is the
     * worst version of this defect, because the report is the artefact that
     * leaves the building.
     */
    windows: bestTimes(dash.audience, scopedPlatforms, 3).map((w) => w.label),
    alerts: anomalies(dash.metrics, dash.scope).slice(0, 6)
      .map((a) => ({ label: a.label, kind: a.kind, deltaPct: a.deltaPct, date: a.date })),
    analysis: buildAnalysis(dash),
  };
}

/**
 * The deep layer, reduced to what a printed page and a shared link can show.
 *
 * The guards travel with it. A timing ranking below the threshold arrives as an
 * EMPTY list, not as a weak one, so a sheet cannot accidentally print a
 * recommendation the interface refused to make.
 */
function buildAnalysis(dash: Dash): ReportSnapshot["analysis"] {
  const content = dash.content.filter((c) => dash.scope === "all" || c.platform === dash.scope);

  const timing = publishTiming(content);
  const cost = followerCost(dash.metrics, content, dash.scope);
  const multiples = reachMultiples(content, dash.metrics, dash.scope);
  const conc = reachConcentration(content);

  return {
    timing: timing.enough
      ? timing.byDay
          .filter((b): b is typeof b & { lift: number } => b.lift !== null)
          .slice(0, 4)
          .map((b) => ({ label: b.label, lift: b.lift, posts: b.posts }))
      : [],
    timingMeasured: timing.measured,
    costReported: cost.reported,
    costTypical: cost.typical,
    costDays: cost.days.slice(0, 4).map((d) => ({
      date: d.date, unfollows: d.unfollows, typical: d.typical,
      posts: d.posts.map((p) => p.title),
    })),
    multiples: multiples.slice(0, 5).map((m) => ({
      title: m.title, date: m.date, reach: m.reach, followers: m.followers, times: m.times,
    })),
    concentration: conc.postsForHalf !== null && conc.topShare !== null
      ? { posts: conc.posts, postsForHalf: conc.postsForHalf, topSharePct: conc.topShare * 100 }
      : null,
  };
}
