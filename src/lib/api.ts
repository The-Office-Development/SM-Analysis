import { supabase } from "./supabase";
import type {
  SocialAccount, MetricPoint, ContentItem, AudienceSnapshot, Platform, Range, Scope, Goal,
} from "./types";
import {
  isDemoMode, demoAccounts, demoMetricsInRange, demoContent, demoAudience,
  getDemoGoals, createDemoGoal, deleteDemoGoal,
} from "./demoData";

/** ISO date (YYYY-MM-DD) `days` before today, UTC. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function fetchAccounts(): Promise<SocialAccount[]> {
  if (isDemoMode()) return demoAccounts;
  const { data, error } = await supabase
    .from("social_accounts")
    .select("*")
    .order("connected_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SocialAccount[];
}

export async function fetchMetrics(range: Range): Promise<MetricPoint[]> {
  if (isDemoMode()) return demoMetricsInRange(range);
  // Ordered DESC with an explicit limit: PostgREST caps a limitless query at
  // 1000 rows, and ascending order meant the cap silently discarded the NEWEST
  // days — a multi-account dashboard simply stopped a week short.
  const { data, error } = await supabase
    .from("metrics_daily")
    .select("account_id,platform,date,followers,reach,impressions,views,engagements,provisional")
    .gte("date", isoDaysAgo(range))
    .order("date", { ascending: false })
    .limit(20000);
  if (error) throw error;
  return ((data ?? []) as MetricPoint[]).slice().reverse();
}

/**
 * Content published inside the selected window.
 *
 * This used to take the top 200 posts of ALL TIME with no date predicate, so a
 * report headed "last 7 days" could be led by a post from last year — in the
 * dashboard, the CSV, the shared report and the AI summary alike.
 */
export async function fetchContent(range: Range): Promise<ContentItem[]> {
  if (isDemoMode()) return demoContent;
  const { data, error } = await supabase
    .from("content")
    .select("*")
    .gte("published_at", isoDaysAgo(range))
    .order("views", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as ContentItem[];
}

export async function fetchAudience(): Promise<AudienceSnapshot[]> {
  if (isDemoMode()) return demoAudience;
  // Only the most recent snapshot per account is meaningful; summing a year of
  // daily snapshots inflates the heatmap without changing its shape.
  const { data, error } = await supabase
    .from("audience_snapshots")
    .select("*")
    .order("captured_on", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AudienceSnapshot[];
}

/* -------------------------------- goals ---------------------------------- */

export async function fetchGoals(): Promise<Goal[]> {
  if (isDemoMode()) return getDemoGoals();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Goal[];
}

export async function createGoal(g: Pick<Goal, "metric" | "scope" | "target" | "due_date">): Promise<Goal> {
  if (isDemoMode()) return createDemoGoal(g);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data, error } = await supabase
    .from("goals")
    .insert({ ...g, user_id: user.id })
    .select("*")
    .single();
  if (error) throw error;
  return data as Goal;
}

export async function deleteGoal(id: string): Promise<void> {
  if (isDemoMode()) { deleteDemoGoal(id); return; }
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) throw error;
}

/* ----------------------------- share links ------------------------------ */

/** Persist a report snapshot server-side and get a public read-only URL. */
export async function createShare(snapshot: unknown): Promise<{ slug: string; url: string }> {
  if (isDemoMode()) throw new Error("Share links are disabled in the preview. They work once you sign in with real data.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ snapshot }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "Could not create a share link.");
  return body as { slug: string; url: string };
}

/** Fetch a shared snapshot by slug — no auth (served via service role). */
export async function fetchShare(slug: string): Promise<unknown> {
  const res = await fetch(`/api/share?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error("This report link is invalid or has been removed.");
  const body = await res.json();
  return body.snapshot;
}

/** Begin a platform OAuth flow. The session token is POSTed, never put in a URL. */
export async function startOAuth(provider: "meta" | "tiktok"): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch(`/api/oauth-${provider}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: session.access_token }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.message || "Could not start the connection.");
  return body.url as string;
}

/** Revoke at the platform, delete the stored token, and purge the account's data. */
export async function disconnectAccount(accountId: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch("/api/disconnect", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ account_id: accountId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "Could not disconnect.");
  return body.message as string;
}

/** Kicks off a server-side sync (Netlify function) for the signed-in user. */
export async function triggerSync(): Promise<{ ok: boolean; message: string }> {
  if (isDemoMode()) return { ok: false, message: "Preview mode: connect a real account after setup to sync live data." };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, message: "Not signed in." };
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, message: body.message ?? (res.ok ? "Sync started." : "Sync failed.") };
}

/** Ask the grounded AI assistant a question about the (real) dashboard data. */
export async function askAI(
  summary: string,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  if (isDemoMode()) {
    await new Promise((r) => setTimeout(r, 500));
    return "This is preview mode, so I'm running on sample data rather than a live account. In the real product I read your synced numbers and answer questions like why reach moved, what to post next, and your best posting windows. Connect an account and I'll ground every answer in your actual metrics.";
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ summary, messages }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "The assistant is unavailable.");
  return body.answer as string;
}

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
