import type { useDash } from "../context/DashboardContext";
import { seriesByDay, followersByDay, sum, latest, engagementRate } from "./api";
import { periodCompare, bestTimes, anomalies } from "./analytics";
import { PLATFORMS } from "./platforms";
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
  scopeLabel: string;
  range: number;
  headline: { label: string; total: number; deltaPct: number | null }[];
  engagementRate: number;
  platforms: { name: string; followers: number; reach: number; views: number; engagements: number }[];
  top: { title: string; platform: string; views: number | null; likes: number | null; comments: number | null }[];
  windows: string[];
  alerts: { label: string; kind: "spike" | "drop"; deltaPct: number; date: string }[];
}

export function buildSnapshot(dash: Dash): ReportSnapshot {
  const scopeLabel = dash.scope === "all" ? "All platforms" : PLATFORMS[dash.scope as Platform].name;
  const cmp = periodCompare(dash.metrics, dash.scope);

  const headline = cmp.map((c) => ({
    label: c.label,
    total: c.key === "followers"
      ? latest(followersByDay(dash.metrics, dash.scope))
      : sum(seriesByDay(dash.metrics, dash.scope, c.key)),
    deltaPct: c.deltaPct,
  }));

  const platforms = dash.connectedPlatforms.map((p) => ({
    name: PLATFORMS[p].name,
    followers: latest(followersByDay(dash.metrics, p)),
    reach: sum(seriesByDay(dash.metrics, p, "reach")),
    views: sum(seriesByDay(dash.metrics, p, "views")),
    engagements: sum(seriesByDay(dash.metrics, p, "engagements")),
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
    scopeLabel,
    range: dash.range,
    headline,
    engagementRate: engagementRate(dash.metrics, dash.scope),
    platforms,
    top,
    windows: bestTimes(dash.audience, dash.connectedPlatforms, 3).map((w) => w.label),
    alerts: anomalies(dash.metrics, dash.scope).slice(0, 6)
      .map((a) => ({ label: a.label, kind: a.kind, deltaPct: a.deltaPct, date: a.date })),
  };
}
