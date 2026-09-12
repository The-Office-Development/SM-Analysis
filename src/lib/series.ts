/**
 * Pure selectors over stored metric rows.
 *
 * These were inside `api.ts`, next to the Supabase client, and that is the whole
 * reason this file exists. Anything importing a selector also imported the
 * network layer, so `analytics.ts` and `snapshot.ts` — which do nothing but
 * arithmetic on rows — could not be compiled for a test. Three defects hid there
 * and were found by looking at rendered pages rather than by the suite:
 *
 *   - a posting window invented from a grid of zeros ("most active Sun 12am")
 *   - a LinkedIn report recommending Instagram's posting times
 *   - the AI assistant grounded on "Video views: 0" for a platform that reports
 *     no views at all
 *
 * Nothing here touches the network, the browser or React. `api.ts` re-exports
 * every name so existing callers are unchanged.
 */
import type { MetricPoint, Platform, Scope } from "./types";

/* ----------------------------- aggregation ------------------------------- */

export type MetricKey = "followers" | "reach" | "impressions" | "views" | "engagements";

function scoped(rows: MetricPoint[], scope: Scope): MetricPoint[] {
  return scope === "all" ? rows : rows.filter((r) => r.platform === scope);
}

/**
 * Sum a flow metric per day across the scoped platforms -> [{date, value}].
 * Days where no scoped account reported the metric are omitted entirely rather
 * than emitted as zero, so an unreported day is not drawn as a crash.
 */
export function seriesByDay(
  rows: MetricPoint[], scope: Scope, key: MetricKey
): { date: string; value: number }[] {
  const map = new Map<string, number>();
  for (const r of scoped(rows, scope)) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    map.set(r.date, (map.get(r.date) ?? 0) + v);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
}

/** Followers is a stock, not a flow: sum the latest value per account per day. */
export function followersByDay(
  rows: MetricPoint[], scope: Scope
): { date: string; value: number }[] {
  const byDate = new Map<string, Map<string, number>>();
  for (const r of scoped(rows, scope)) {
    if (r.followers === null || r.followers === undefined) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    byDate.get(r.date)!.set(r.account_id, r.followers);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, m]) => ({ date, value: [...m.values()].reduce((s, v) => s + v, 0) }));
}

export function perPlatformSeries(
  rows: MetricPoint[], platforms: Platform[], key: MetricKey
): { platform: Platform; points: { date: string; value: number }[] }[] {
  return platforms.map((p) => ({ platform: p, points: seriesByDay(rows, p, key) }));
}

export function perPlatformFollowers(
  rows: MetricPoint[], platforms: Platform[]
): { platform: Platform; points: { date: string; value: number }[] }[] {
  return platforms.map((p) => ({ platform: p, points: followersByDay(rows, p) }));
}

/** Percentage change of the second half of a window vs the first half. */
export function momentum(series: { value: number }[]): number {
  if (series.length < 4) return 0;
  const half = Math.floor(series.length / 2);
  const prev = series.slice(0, half).reduce((s, x) => s + x.value, 0);
  const cur = series.slice(series.length - half).reduce((s, x) => s + x.value, 0);
  return prev > 0 ? ((cur - prev) / prev) * 100 : 0;
}

/** Growth of a stock series (last vs first). */
export function stockDelta(series: { value: number }[]): number {
  if (series.length < 2) return 0;
  const first = series[0].value, last = series[series.length - 1].value;
  // A zero or negative base makes the percentage meaningless, not just imprecise.
  return first > 0 ? ((last - first) / first) * 100 : 0;
}

export function sum(series: { value: number }[]): number {
  return series.reduce((s, x) => s + x.value, 0);
}
export function latest(series: { value: number }[]): number {
  return series.length ? series[series.length - 1].value : 0;
}

/** Weighted engagement rate = engagements / reach over the window. */
export function engagementRate(rows: MetricPoint[], scope: Scope): number {
  // Only days that reported BOTH sides count, so the ratio never divides an
  // engagement total by a reach total measured over a different set of days.
  const s = scoped(rows, scope).filter((r) => r.engagements !== null && r.reach !== null);
  const eng = s.reduce((a, r) => a + (r.engagements ?? 0), 0);
  const reach = s.reduce((a, r) => a + (r.reach ?? 0), 0);
  return reach ? (eng / reach) * 100 : 0;
}
