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
    .select("account_id,platform,date,followers,reach,impressions,views,engagements,follows,unfollows,reach_followers,reach_non_followers,provisional")
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
    /*
     * NOT filtered by the selected range.
     *
     * The range is a window on DAILY METRICS — what happened in the last 30
     * days. Posts are not daily metrics: a post published last year is still
     * this account's best post, and its numbers are still true. Filtering the
     * list by publication date hid eleven of twelve stored posts behind a 90-day
     * selector, including a reel with 4.8M views and 183,686 likes, and left the
     * Content page reading "1 post" for an account with a year of output.
     *
     * It also broke the comparison the per-post page is built on: a median over
     * one post is not a baseline.
     *
     * The sync stores up to 100 posts per account (it follows Meta's cursor to
     * MEDIA_TARGET), so "everything stored" is small and bounded — there is
     * nothing to page through and nothing to protect against here.
     */
    .order("views", { ascending: false, nullsFirst: false })
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
export async function startOAuth(provider: "meta" | "tiktok" | "instagram" | "linkedin"): Promise<string> {
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

/** Download everything we hold about the signed-in user (portability). */
export async function exportMyData(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch("/api/account-data", { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) throw new Error("Could not build your export.");
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `pulseboard-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

/** Erase the account and everything associated with it. */
export async function deleteMyAccount(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch("/api/account-data", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "Could not delete your account.");
  return body.confirmation_code as string;
}

/** Kicks off a server-side sync (the deployed function) for the signed-in user. */
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

/*
 * The pure selectors moved to `series.ts` so they can be tested without dragging
 * the Supabase client in with them. Re-exported here because every caller in the
 * app imports them from `api`, and a rename would touch two dozen files to no
 * benefit.
 */
export {
  seriesByDay, followersByDay, perPlatformSeries, perPlatformFollowers,
  momentum, stockDelta, sum, latest, engagementRate,
} from "./series";
export type { MetricKey } from "./series";


/**
 * Refresh one post's numbers from the platform, now.
 *
 * Separate from the sync on purpose: the sync costs about five calls per day of
 * history and can never be live, while a single post is one call. The question
 * this serves has a deadline measured in hours.
 */
export async function refreshPost(id: string): Promise<Partial<ContentItem> & { refreshed_at: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in.");
  const res = await fetch("/api/refresh-post", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? "Could not refresh that post.");
  return body;
}
