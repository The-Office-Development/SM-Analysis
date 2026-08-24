import type { MetricPoint, AudienceSnapshot, ContentItem, Platform, Range, Scope } from "./types";
import { seriesByDay, followersByDay, sum, latest, engagementRate, type MetricKey } from "./api";
import { PLATFORMS } from "./platforms";

export const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtHour(h: number): string {
  const ap = h < 12 ? "am" : "pm";
  const hh = (h % 12) || 12;
  return `${hh}${ap}`;
}

/** Sum the audience active-hours [7][24] grids across the scoped snapshots. */
export function activeGrid(audience: AudienceSnapshot[], platforms: Platform[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const a of audience) {
    if (!platforms.includes(a.platform)) continue;
    const h = a.active_hours;
    if (!Array.isArray(h)) continue;
    for (let d = 0; d < 7 && d < h.length; d++)
      for (let hr = 0; hr < 24; hr++) grid[d][hr] += Number(h[d]?.[hr] ?? 0);
  }
  return grid;
}

export interface BestWindow { day: number; hour: number; score: number; label: string; }

/**
 * Which timezone the posting-window hours are expressed in is set by the
 * platform, not by us, and has not been confirmed for Instagram. Until it is,
 * every recommendation must be shown with this caveat rather than implying the
 * viewer's local time — a "best time" that is silently hours out is advice a
 * client will act on.
 */
export const BEST_TIME_NOTE =
  "Hours are as the platform reports them and may not match your local timezone. Confirm against your own Instagram insights before scheduling.";

/** Rank the strongest posting windows from the audience heatmap. */
export function bestTimes(audience: AudienceSnapshot[], platforms: Platform[], top = 5): BestWindow[] {
  const grid = activeGrid(audience, platforms);
  const max = Math.max(...grid.flat());
  if (max <= 0) return [];
  const cells: BestWindow[] = [];
  for (let d = 0; d < 7; d++)
    for (let hr = 0; hr < 24; hr++)
      cells.push({ day: d, hour: hr, score: grid[d][hr] / max, label: `${DOW[d]} · ${fmtHour(hr)}` });
  return cells.filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, top);
}

export type AnomalyKind = "spike" | "drop";
export interface Anomaly {
  metric: MetricKey; label: string; date: string;
  value: number; expected: number; deltaPct: number; kind: AnomalyKind;
}
const METRIC_LABEL: Record<string, string> = {
  reach: "Reach", views: "Video views", engagements: "Engagements", impressions: "Impressions", followers: "Followers",
};

/** Flag days where a flow metric deviates strongly from its trailing 5-day mean. */
export function anomalies(metrics: MetricPoint[], scope: Scope): Anomaly[] {
  const keys: MetricKey[] = ["reach", "views", "engagements"];
  const out: Anomaly[] = [];
  // Provisional days are still settling and are always short. Alerting on them
  // produced a standing "reach dropped" every day, which the AI assistant then
  // repeated back to the client as fact.
  const settled = metrics.filter((m) => !m.provisional);
  for (const key of keys) {
    const s = seriesByDay(settled, scope, key);
    if (s.length < 6) continue;
    for (let i = 4; i < s.length; i++) {
      const window = s.slice(i - 4, i).map((x) => x.value);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      if (mean <= 10) continue;
      const v = s[i].value;
      const deltaPct = ((v - mean) / mean) * 100;
      if (Math.abs(deltaPct) >= 45) {
        out.push({
          metric: key, label: METRIC_LABEL[key] ?? key, date: s[i].date,
          value: v, expected: Math.round(mean), deltaPct, kind: deltaPct > 0 ? "spike" : "drop",
        });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
}

export interface Compare { key: MetricKey | "followers"; label: string; current: number; previous: number; deltaPct: number; }

/** This half of the window vs the prior half (matches the app's momentum proxy). */
export function periodCompare(metrics: MetricPoint[], scope: Scope): Compare[] {
  const defs: { key: MetricKey | "followers"; label: string }[] = [
    { key: "followers", label: "Followers" },
    { key: "reach", label: "Reach" },
    { key: "views", label: "Video views" },
    { key: "engagements", label: "Engagements" },
  ];
  return defs.map(({ key, label }) => {
    const s = key === "followers" ? followersByDay(metrics, scope) : seriesByDay(metrics, scope, key);
    if (s.length < 4) return { key, label, current: 0, previous: 0, deltaPct: 0 };
    const half = Math.floor(s.length / 2);
    if (key === "followers") {
      const previous = s[half - 1]?.value ?? 0;
      const current = s[s.length - 1]?.value ?? 0;
      return { key, label, current, previous, deltaPct: previous ? ((current - previous) / previous) * 100 : 0 };
    }
    const previous = s.slice(0, half).reduce((a, x) => a + x.value, 0);
    const current = s.slice(s.length - half).reduce((a, x) => a + x.value, 0);
    return { key, label, current, previous, deltaPct: previous ? ((current - previous) / previous) * 100 : 0 };
  });
}

/* ------------------------------------------------------------------ *
 * Compact, grounded summary of the whole account for the AI assistant.
 * Kept small (numbers only, no raw rows) so it fits comfortably in the
 * prompt and can't leak private tokens.
 * ------------------------------------------------------------------ */
export interface AISummaryInput {
  range: Range; scope: Scope; connectedPlatforms: Platform[];
  metrics: MetricPoint[]; content: ContentItem[]; audience: AudienceSnapshot[];
}

function pct(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? "+" : ""}${r}%`;
}

export function summarizeForAI(d: AISummaryInput): string {
  const scopeName = d.scope === "all" ? "all connected platforms" : PLATFORMS[d.scope as Platform].name;
  const lines: string[] = [];
  lines.push(`Window: last ${d.range} days. Scope: ${scopeName}.`);
  lines.push(`Connected: ${d.connectedPlatforms.map((p) => PLATFORMS[p].name).join(", ") || "none"}.`);

  const cmp = periodCompare(d.metrics, d.scope);
  lines.push("Totals over the window (with trend vs the previous half):");
  for (const c of cmp) {
    const total = c.key === "followers" ? latest(followersByDay(d.metrics, d.scope)) : sum(seriesByDay(d.metrics, d.scope, c.key as MetricKey));
    lines.push(`- ${c.label}: ${total.toLocaleString()} (${pct(c.deltaPct)})`);
  }
  lines.push(`- Engagement rate: ${engagementRate(d.metrics, d.scope).toFixed(1)}%`);

  const top = [...d.content]
    .filter((c) => d.scope === "all" || c.platform === d.scope)
    .sort((a, b) => b.views - a.views).slice(0, 5);
  if (top.length) {
    lines.push("Top posts by views:");
    for (const c of top)
      lines.push(`- "${(c.title || "Untitled").slice(0, 60)}" (${PLATFORMS[c.platform as Platform].name}, ${c.media_type}) — ${c.views.toLocaleString()} views, ${c.likes.toLocaleString()} likes, ${c.comments.toLocaleString()} comments`);
  }

  const windows = bestTimes(d.audience, d.connectedPlatforms, 3);
  if (windows.length) lines.push(`Best posting windows: ${windows.map((w) => w.label).join("; ")}.`);

  const al = anomalies(d.metrics, d.scope);
  if (al.length) {
    lines.push("Recent anomalies:");
    for (const a of al.slice(0, 5))
      lines.push(`- ${a.label} ${a.kind === "drop" ? "dropped" : "spiked"} ${pct(a.deltaPct)} on ${a.date} (${a.value.toLocaleString()} vs typical ${a.expected.toLocaleString()})`);
  }
  return lines.join("\n");
}
