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
/**
 * The follower lines to DRAW for one platform.
 *
 * One summed line when the platform's accounts all start on the same day, which
 * is the ordinary case. One line per account when they do not: a summed line
 * adds a later account's whole following on the day it connected, and draws that
 * as a vertical surge. A LinkedIn page with a founder's profile connected a week
 * later did exactly that. Separate lines keep every point true.
 *
 * `account_id` is null for the summed line, so the caller knows whether to label
 * a line by platform or by account.
 */
export function followerLines(
  rows: MetricPoint[], platform: Platform,
): { account_id: string | null; points: { date: string; value: number }[] }[] {
  const firstDay = new Map<string, string>();
  for (const r of rows) {
    if (r.platform !== platform || r.followers === null || r.followers === undefined) continue;
    const seen = firstDay.get(r.account_id);
    if (!seen || r.date < seen) firstDay.set(r.account_id, r.date);
  }
  if (new Set(firstDay.values()).size <= 1) {
    return [{ account_id: null, points: followersByDay(rows, platform) }];
  }
  return [...firstDay.keys()].sort().map((id) => ({
    account_id: id,
    points: followersByDay(rows.filter((r) => r.account_id === id), platform),
  }));
}

/**
 * Follower growth in percent, measured PER ACCOUNT and only across accounts that
 * were measured at both ends. Null when no account was.
 *
 * The combined follower line adds up whichever accounts reported on each day, so
 * an account that starts reporting mid-window lifts the end of the line without
 * being in its start. Taking first-vs-last of that line reported the arrival of
 * an account as follower growth. Every LinkedIn page and profile starts that way:
 * LinkedIn gives no follower history, only today's total, so connecting one
 * showed its entire following as gained followers on the Overview, the
 * Platforms tile, the assistant and the sponsor report.
 *
 * `fromDate` narrows the start: an account counts only if it has a value on or
 * before that date (periodCompare's midpoint). Absent, each account's own first
 * reported day is its start.
 */
export function followerGrowth(
  rows: MetricPoint[], scope: Scope, fromDate?: string,
): { pct: number; from: number; to: number } | null {
  const byAccount = new Map<string, { date: string; value: number }[]>();
  for (const r of scoped(rows, scope)) {
    if (r.followers === null || r.followers === undefined) continue;
    const list = byAccount.get(r.account_id) ?? [];
    list.push({ date: r.date, value: r.followers });
    byAccount.set(r.account_id, list);
  }
  let from = 0, to = 0, counted = 0;
  for (const list of byAccount.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const start = fromDate
      ? [...list].reverse().find((p) => p.date <= fromDate)
      : list[0];
    const end = list[list.length - 1];
    // One measurement is a level, not a change.
    if (!start || start.date >= end.date) continue;
    from += start.value; to += end.value; counted++;
  }
  if (!counted || from <= 0) return null;
  return { pct: ((to - from) / from) * 100, from, to };
}

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
