import type { MetricPoint, AudienceSnapshot, ContentItem, Platform, Range, Scope } from "./types";
/*
 * From `series` and `platformNames`, not `api` and `platforms`.
 *
 * Both of those drag in the Supabase client and the React tree, which is what
 * made this module impossible to compile for a test — and three defects lived
 * here undetected because of it. Nothing below touches the network or the DOM.
 */
import { seriesByDay, followersByDay, sum, latest, engagementRate, type MetricKey } from "./series";
import { platformName } from "./platformNames";
import {
  publishTiming, followerCost, reachMultiples, reachConcentration, bestTimes, totalReported,
} from "./insights";

export const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/*
 * The posting-window interpretation moved to `insights.ts` so the test suite can
 * reach it. This module imports `api.ts` and `platforms.tsx`, so it drags in the
 * Supabase client and the React tree and cannot be compiled for a test — which
 * is why a defect in `bestTimes` went unnoticed. Re-exported here so existing
 * callers are unchanged.
 */
export {
  DOW_SHORT, fmtHour, activeGrid, bestTimes, BEST_TIME_NOTE,
} from "./insights";
export type { BestWindow } from "./insights";

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

export interface Compare {
  key: MetricKey | "followers"; label: string; current: number; previous: number; deltaPct: number;
  /**
   * False when the platform never reported this metric over the window.
   *
   * `current` is 0 in that case because the series was empty, and a 0 here is
   * read by the AI assistant and printed in a sponsor's report as a measurement.
   * A LinkedIn Company Page reports no page-level views at all.
   */
  reported: boolean;
}

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
    if (s.length < 4) return { key, label, current: 0, previous: 0, deltaPct: 0, reported: s.length > 0 };
    const half = Math.floor(s.length / 2);
    if (key === "followers") {
      const previous = s[half - 1]?.value ?? 0;
      const current = s[s.length - 1]?.value ?? 0;
      return { key, label, current, previous, deltaPct: previous ? ((current - previous) / previous) * 100 : 0, reported: true };
    }
    const previous = s.slice(0, half).reduce((a, x) => a + x.value, 0);
    const current = s.slice(s.length - half).reduce((a, x) => a + x.value, 0);
    return { key, label, current, previous, deltaPct: previous ? ((current - previous) / previous) * 100 : 0, reported: true };
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
  const scopeName = d.scope === "all" ? "all connected platforms" : platformName(d.scope as Platform);
  const lines: string[] = [];
  lines.push(`Window: last ${d.range} days. Scope: ${scopeName}.`);
  lines.push(`Connected: ${d.connectedPlatforms.map((p) => platformName(p)).join(", ") || "none"}.`);

  const cmp = periodCompare(d.metrics, d.scope);
  lines.push("Totals over the window (with trend vs the previous half):");
  for (const c of cmp) {
    /*
     * "not reported", never 0.
     *
     * This line used sum(), which is 0 for a metric the platform never reports —
     * so a LinkedIn Company Page, which has no page-level views at all, told the
     * assistant "Video views: 0 (+0.0%)" and the assistant repeated it to the
     * client as a measurement. The rule was already written down thirty lines
     * below, for per-post figures: a fabricated 0 is one the model states
     * confidently. It just was not applied here.
     */
    const total = c.key === "followers"
      ? latest(followersByDay(d.metrics, d.scope))
      : totalReported(seriesByDay(d.metrics, d.scope, c.key as MetricKey));
    lines.push(total === null
      ? `- ${c.label}: not reported by this platform`
      : `- ${c.label}: ${total.toLocaleString()} (${pct(c.deltaPct)})`);
  }
  lines.push(`- Engagement rate: ${engagementRate(d.metrics, d.scope).toFixed(1)}%`);

  const top = [...d.content]
    .filter((c) => d.scope === "all" || c.platform === d.scope)
    // A post with unreported views is not a zero-view post, so it sorts last
    // rather than being ranked as the worst performer.
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 5);
  if (top.length) {
    lines.push("Top posts by views:");
    for (const c of top)
      {
      // This text goes into the AI assistant's context. "not reported" is a fact
      // it can reason about; a fabricated 0 is one it would confidently repeat.
      const n = (v: number | null) => (v === null ? "not reported" : v.toLocaleString());
      lines.push(`- "${(c.title || "Untitled").slice(0, 60)}" (${platformName(c.platform as Platform)}, ${c.media_type}): ${n(c.views)} views, ${n(c.likes)} likes, ${n(c.comments)} comments`);
    }
  }

  /*
   * Scoped, for the same reason buildSnapshot is: handing the assistant
   * Instagram's posting windows while the client is asking about their LinkedIn
   * page produces advice about a different audience, stated with full confidence.
   */
  const windows = bestTimes(d.audience, d.scope === "all" ? d.connectedPlatforms : [d.scope as Platform], 3);
  if (windows.length) lines.push(`Best posting windows: ${windows.map((w) => w.label).join("; ")}.`);

  const al = anomalies(d.metrics, d.scope);
  if (al.length) {
    lines.push("Recent anomalies:");
    for (const a of al.slice(0, 5))
      lines.push(`- ${a.label} ${a.kind === "drop" ? "dropped" : "spiked"} ${pct(a.deltaPct)} on ${a.date} (${a.value.toLocaleString()} vs typical ${a.expected.toLocaleString()})`);
  }

  /*
   * The analysis the platform does not do.
   *
   * The assistant is asked "when should I post?" and "why did I lose followers?"
   * more than anything else, and until now it could only answer the first from
   * when followers are ONLINE, which is a different question from what worked.
   *
   * The guards are carried into the text, not stripped from it. A model handed a
   * bare ranking will state it as advice; handed the sample size and the caveat,
   * it repeats them. Where there is too little data the line says so explicitly
   * rather than being omitted, because an absent line reads as "no pattern" and
   * an explicit one reads as "not enough evidence".
   */
  const content = d.content.filter((c) => d.scope === "all" || c.platform === d.scope);
  const timing = publishTiming(content);
  lines.push("When this account's posts ACTUALLY performed (measured on results, not on when followers are online; 1.00 = typical post of the same format):");
  if (!timing.enough) {
    lines.push(`- Not enough measurable posts yet (${timing.measured}). Do not offer a best day or time from this; say the evidence is not there.`);
  } else {
    for (const b of timing.byDay.filter((x) => x.lift !== null).slice(0, 3))
      lines.push(`- ${b.label}: ${(b.lift as number).toFixed(2)} across ${b.posts} posts`);
    for (const b of timing.byBlock.filter((x) => x.lift !== null).slice(0, 3))
      lines.push(`- ${b.label}: ${(b.lift as number).toFixed(2)} across ${b.posts} posts`);
  }

  const cost = followerCost(d.metrics, content, d.scope);
  if (!cost.reported) {
    /*
     * Named from the scope. This said "Instagram has never reported unfollows"
     * whatever the client was actually asking about, and the assistant repeats
     * its grounding as fact — so a LinkedIn client got told something about
     * Instagram, in an answer they would read. For LinkedIn it is also a
     * PLATFORM-WIDE absence rather than a gap on their account, and saying so
     * is the difference between "your data is missing" and "this cannot be
     * measured here".
     */
    lines.push(d.scope === "linkedin"
      ? "Follower losses: LinkedIn does not report unfollows for a Company Page at all. Say this cannot be seen on LinkedIn rather than that nobody left."
      : `Follower losses: ${d.scope === "all" ? "the platform has" : platformName(d.scope as Platform) + " has"} never reported unfollows for this account. Say this cannot be seen rather than that nobody left.`);
  } else if (cost.days.length) {
    lines.push(`Days that lost unusually many followers (usual is ${cost.typical} a day). CORRELATION ONLY: posts listed went out that day, which is not evidence they caused it.`);
    for (const day of cost.days.slice(0, 3))
      lines.push(`- ${day.date}: lost ${day.unfollows}, published ${day.posts.map((x) => `"${x.title.slice(0, 40)}"`).join(", ")}`);
  }

  const multiples = reachMultiples(content, d.metrics, d.scope);
  if (multiples.length) {
    lines.push("Reach against the following the post actually had:");
    for (const m of multiples.slice(0, 3))
      lines.push(`- "${m.title.slice(0, 40)}": ${m.times.toFixed(1)}x (${m.reach.toLocaleString()} reach against ${m.followers.toLocaleString()} followers on ${m.date})`);
  }

  const conc = reachConcentration(content);
  if (conc.postsForHalf !== null && conc.topShare !== null) {
    lines.push(`Concentration: ${conc.postsForHalf} of ${conc.posts} posts carry half of all reach; the best single post is ${Math.round(conc.topShare * 100)}% of it.`);
  }

  return lines.join("\n");
}
