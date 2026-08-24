import { type Db, graphGet, decryptToken, isAuthError, isThrottleError, log } from "./_lib";

export const today = () => new Date().toISOString().slice(0, 10);

/** How many days of history to pull on the first sync of an account. */
const MAX_BACKFILL = 30;
/**
 * How many recent days to re-fetch on EVERY sync.
 *
 * Previously the sync fetched only days after the newest stored row, so each day
 * was written once — at 06:00 UTC by the cron, holding a few hours of activity —
 * and never revisited. Platform insight values keep settling for a day or more
 * afterwards, so those numbers stayed permanently short. Upserts overwrite, so
 * re-fetching a trailing window is cheap and self-healing.
 */
const TRAILING_REFETCH = 7;
/** Days younger than this are still settling and are flagged provisional. */
const SETTLING_DAYS = 2;

export interface AccountRow {
  id: string; platform: string; external_id: string; username: string;
}
export interface SyncResult { calls: number; rowsWritten: number; }

/** A metric the platform did not report is null — never zero. */
type Metric = number | null;
interface DayRow {
  date: string;
  followers: Metric; reach: Metric; impressions: Metric;
  views: Metric; engagements: Metric;
  provisional: boolean;
}
interface Post {
  external_id: string; title: string; media_type: string; permalink: string | null;
  published_at: string; views: number; likes: number; comments: number; shares: number;
  saves: number; reach: number; avg_watch_seconds: number | null; retention_pct: number | null;
}
interface Audience {
  age: Record<string, number>;
  gender: Record<string, number>;
  countries: Record<string, number>;
  devices: Record<string, number>;
  active_hours: number[][]; // [7][24]
}

/** A daily series, and whether the platform made it available at all. */
interface Series { available: boolean; byDate: Record<string, number>; }
const UNAVAILABLE: Series = { available: false, byDate: {} };

/**
 * Runs a call that is allowed to be unavailable (permission-gated, or a metric
 * this account does not expose). Throttling and auth failures are RE-THROWN:
 * swallowing them is what caused a rate-limited sync to write zeros over good
 * data and then mark the day complete.
 */
async function optional<T>(fn: () => Promise<T>, fallback: T, ctx: Record<string, unknown>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (isThrottleError(e) || isAuthError(e)) throw e;
    log("sync.metric_unavailable", { ...ctx, detail: e instanceof Error ? e.message : String(e) });
    return fallback;
  }
}

/** Sync one account: fetch from the platform API and upsert into Supabase. */
export async function syncAccount(db: Db, acc: AccountRow): Promise<SyncResult> {
  const { data: secretRow } = await db.from("account_secrets").select("access_token,extra").eq("account_id", acc.id).single();
  const stored = secretRow?.access_token as string | undefined;
  if (!stored) throw new Error("missing token");
  const token = decryptToken(stored);

  const { data: latest } = await db
    .from("metrics_daily").select("date").eq("account_id", acc.id)
    .order("date", { ascending: false }).limit(1).maybeSingle();
  const start = syncStart((latest?.date as string | undefined) ?? null);

  const counter = { calls: 0 };
  let days: DayRow[] = [];
  let posts: Post[] = [];
  if (acc.platform === "instagram") ({ days, posts } = await syncInstagram(acc, token, start, counter));
  else if (acc.platform === "facebook") ({ days, posts } = await syncFacebook(acc, token, start, counter));
  else if (acc.platform === "tiktok") ({ days, posts } = await syncTiktok(acc, token, counter));

  let rowsWritten = 0;
  if (days.length) {
    const merged = await mergeWithStored(db, acc, days);
    if (merged.length) {
      const { error } = await db.from("metrics_daily").upsert(merged, { onConflict: "account_id,date" });
      if (error) throw error;
      rowsWritten = merged.length;
    }
  }
  if (posts.length) {
    const { error } = await db.from("content").upsert(
      posts.map((p) => ({ account_id: acc.id, platform: acc.platform, ...p })),
      { onConflict: "account_id,external_id" }
    );
    if (error) throw error;
  }

  // Audience demographics — best effort, IG + FB expose them (TikTok basic API does not).
  try {
    const snap = acc.platform === "instagram" ? await audienceInstagram(acc, token, counter)
      : acc.platform === "facebook" ? await audienceFacebook(acc, token, counter) : null;
    if (snap && hasAudience(snap)) {
      await db.from("audience_snapshots").upsert(
        { account_id: acc.id, platform: acc.platform, captured_on: today(), ...snap },
        { onConflict: "account_id,captured_on" }
      );
    }
  } catch (e) {
    if (isThrottleError(e) || isAuthError(e)) throw e;
    /* audience insights are optional and permission-gated */
  }

  await db.from("social_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", acc.id);
  return { calls: counter.calls, rowsWritten };
}

/**
 * Merge freshly fetched days over what is already stored. A null means "the
 * platform did not report this", and null NEVER overwrites a stored value.
 */
async function mergeWithStored(db: Db, acc: AccountRow, days: DayRow[]) {
  const dates = days.map((d) => d.date).sort();
  const { data: existing } = await db
    .from("metrics_daily")
    .select("date,followers,reach,impressions,views,engagements")
    .eq("account_id", acc.id)
    .gte("date", dates[0])
    .lte("date", dates[dates.length - 1]);

  const prior = new Map<string, any>();
  for (const r of existing ?? []) prior.set(r.date as string, r);

  const out: any[] = [];
  for (const d of days) {
    const p = prior.get(d.date);
    const pick = (fresh: Metric, key: string): Metric => (fresh !== null ? fresh : (p?.[key] ?? null));
    const row = {
      account_id: acc.id,
      platform: acc.platform,
      date: d.date,
      followers: pick(d.followers, "followers"),
      reach: pick(d.reach, "reach"),
      impressions: pick(d.impressions, "impressions"),
      views: pick(d.views, "views"),
      engagements: pick(d.engagements, "engagements"),
      provisional: d.provisional,
      updated_at: new Date().toISOString(),
    };
    // Nothing known and nothing stored: do not create a row of nulls.
    const known = [row.followers, row.reach, row.impressions, row.views, row.engagements].some((v) => v !== null);
    if (known) out.push(row);
  }
  return out;
}

/* ------------------------------ Instagram -------------------------------- */
async function syncInstagram(acc: AccountRow, token: string, start: string, c: { calls: number }): Promise<{ days: DayRow[]; posts: Post[] }> {
  const get = (path: string, params: Record<string, string>) => { c.calls++; return graphGet(path, params, token); };
  const prof = await get(`/${acc.external_id}`, { fields: "followers_count,media_count" });
  const now = today();
  const since = String(unixSec(start)), until = String(unixSec(addDays(now, 1)));

  // Each metric is requested SEPARATELY. Bundling them meant one removed metric
  // errored the whole request, and the empty result was then written as zeros.
  // `impressions` and `plays` were removed by Meta in April 2025; `views` is the
  // consolidated replacement.
  const reach = await optional(() => get(`/${acc.external_id}/insights`, { metric: "reach", period: "day", since, until }).then((j) => seriesFrom(j, "reach")), UNAVAILABLE, { metric: "reach", account: acc.id });
  const views = await optional(() => get(`/${acc.external_id}/insights`, { metric: "views", period: "day", since, until }).then((j) => seriesFrom(j, "views")), UNAVAILABLE, { metric: "views", account: acc.id });
  const inter = await optional(() => get(`/${acc.external_id}/insights`, { metric: "total_interactions", period: "day", since, until }).then((j) => seriesFrom(j, "total_interactions")), UNAVAILABLE, { metric: "total_interactions", account: acc.id });
  const delta = await optional(() => get(`/${acc.external_id}/insights`, { metric: "follower_count", period: "day", since, until }).then((j) => seriesFrom(j, "follower_count")), UNAVAILABLE, { metric: "follower_count", account: acc.id });

  const media = await optional(() => get(`/${acc.external_id}/media`, {
    fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,views)",
    limit: "25",
  }), { data: [] as any[] }, { call: "media", account: acc.id });

  const posts: Post[] = (media.data ?? []).map((m: any) => {
    const ins = normInsights(m.insights?.data ?? []);
    return {
      external_id: m.id,
      title: (m.caption ?? "Instagram post").slice(0, 120),
      media_type: m.media_type === "VIDEO" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Photo",
      permalink: safePermalink(m.permalink),
      published_at: m.timestamp ?? new Date().toISOString(),
      views: ins.views ?? ins.reach ?? 0,
      likes: m.like_count ?? 0,
      comments: m.comments_count ?? 0,
      shares: ins.shares ?? 0,
      saves: ins.saved ?? 0,
      reach: ins.reach ?? 0,
      avg_watch_seconds: null,
      retention_pct: null,
    };
  });

  const dates = enumerateDays(start, now);
  const followers = delta.available
    ? reconstructFollowers(dates, prof.followers_count ?? 0, delta.byDate)
    : flatFollowers(dates, prof.followers_count ?? null);

  // Account-level interactions are permission-gated on many accounts. Only fall
  // back to per-post engagement on days the platform also reported reach, so the
  // engagement-rate numerator and denominator span the same days.
  let engagements: Record<string, number | null> = {};
  if (inter.available) {
    for (const d of dates) engagements[d] = d in inter.byDate ? inter.byDate[d] : null;
  } else if (reach.available) {
    const byDate: Record<string, number> = {};
    for (const p of posts) {
      const d = (p.published_at ?? "").slice(0, 10);
      if (d) byDate[d] = (byDate[d] ?? 0) + p.likes + p.comments + p.shares + p.saves;
    }
    for (const d of dates) engagements[d] = d in reach.byDate ? byDate[d] ?? 0 : null;
  } else {
    for (const d of dates) engagements[d] = null;
  }

  const days: DayRow[] = dates.map((date) => ({
    date,
    followers: followers[date] ?? null,
    reach: pickDay(reach, date),
    impressions: null,           // Meta removed IG impressions; `views` replaces it.
    views: pickDay(views, date),
    engagements: engagements[date] ?? null,
    provisional: isProvisional(date, now),
  }));
  return { days, posts };
}

async function audienceInstagram(acc: AccountRow, token: string, c: { calls: number }): Promise<Audience> {
  const get = (params: Record<string, string>) => { c.calls++; return graphGet(`/${acc.external_id}/insights`, params, token); };
  const demo = (breakdown: string) =>
    optional(() => get({
      metric: "follower_demographics", period: "lifetime", timeframe: "this_month",
      breakdown, metric_type: "total_value",
    }).then(parseDemographics), {} as Record<string, number>, { metric: "follower_demographics", breakdown });

  const [ageRaw, genderRaw, countryRaw] = await Promise.all([demo("age"), demo("gender"), demo("country")]);
  const online = await optional(
    () => get({ metric: "online_followers", period: "lifetime" }).then((j) => bucketOnline(j.data?.[0]?.values ?? [])),
    emptyHeat(), { metric: "online_followers" });

  return {
    age: toShares(ageRaw),
    gender: normalizeGender(genderRaw),
    countries: toShares(mapCountryNames(countryRaw)),
    devices: {},
    active_hours: online,
  };
}

/* ------------------------------ Facebook --------------------------------- */
async function syncFacebook(acc: AccountRow, token: string, start: string, c: { calls: number }): Promise<{ days: DayRow[]; posts: Post[] }> {
  const get = (path: string, params: Record<string, string>) => { c.calls++; return graphGet(path, params, token); };
  const prof = await get(`/${acc.external_id}`, { fields: "followers_count" });
  const now = today();
  const since = String(unixSec(start)), until = String(unixSec(addDays(now, 1)));

  // page_impressions / page_fans / post_impressions were removed in Nov 2025.
  const views = await optional(() => get(`/${acc.external_id}/insights`, { metric: "page_media_view", period: "day", since, until }).then((j) => seriesFrom(j, "page_media_view")), UNAVAILABLE, { metric: "page_media_view" });
  const eng = await optional(() => get(`/${acc.external_id}/insights`, { metric: "page_post_engagements", period: "day", since, until }).then((j) => seriesFrom(j, "page_post_engagements")), UNAVAILABLE, { metric: "page_post_engagements" });
  const fans = await optional(() => get(`/${acc.external_id}/insights`, { metric: "page_follows", period: "day", since, until }).then((j) => seriesFrom(j, "page_follows")), UNAVAILABLE, { metric: "page_follows" });

  const feed = await optional(() => get(`/${acc.external_id}/posts`, {
    fields: "id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true),insights.metric(post_media_view)",
    limit: "25",
  }), { data: [] as any[] }, { call: "posts" });

  const posts: Post[] = (feed.data ?? []).map((m: any) => ({
    external_id: m.id,
    title: (m.message ?? "Facebook post").slice(0, 120),
    media_type: "Post",
    permalink: safePermalink(m.permalink_url),
    published_at: m.created_time ?? new Date().toISOString(),
    views: pickInsight(m.insights ?? {}, "post_media_view"),
    likes: m.likes?.summary?.total_count ?? 0,
    comments: m.comments?.summary?.total_count ?? 0,
    shares: m.shares?.count ?? 0,
    saves: 0,
    reach: 0,
    avg_watch_seconds: null,
    retention_pct: null,
  }));

  const dates = enumerateDays(start, now);
  const followers = fans.available
    ? Object.fromEntries(dates.map((d) => [d, fans.byDate[d] ?? null]))
    : flatFollowers(dates, prof.followers_count ?? null);

  const days: DayRow[] = dates.map((date) => ({
    date,
    followers: followers[date] ?? null,
    reach: null,                 // Page reach is not available on the current metric set.
    impressions: null,
    views: pickDay(views, date),
    engagements: pickDay(eng, date),
    provisional: isProvisional(date, now),
  }));
  return { days, posts };
}

async function audienceFacebook(acc: AccountRow, token: string, c: { calls: number }): Promise<Audience> {
  // page_fans_online was removed in Sep 2024, and page_fans_gender_age /
  // page_fans_country are unavailable for Pages connected after 14 Mar 2024,
  // so this returns empty for any newly connected Page. That is Meta's limit.
  c.calls++;
  const j = await optional(
    () => graphGet(`/${acc.external_id}/insights`, { metric: "page_fans_gender_age,page_fans_country", period: "lifetime" }, token),
    { data: [] as any[] }, { metric: "page_fans_*" });
  const rows = j.data ?? [];
  const genderAge = latestValue(rows, "page_fans_gender_age") ?? {};
  const country = latestValue(rows, "page_fans_country") ?? {};

  const age: Record<string, number> = {};
  const gender: Record<string, number> = {};
  for (const key of Object.keys(genderAge)) {
    const [g, a] = key.split("."); // e.g. "F.25-34"
    if (a) age[a] = (age[a] ?? 0) + genderAge[key];
    const gk = g === "F" ? "female" : g === "M" ? "male" : "other";
    gender[gk] = (gender[gk] ?? 0) + genderAge[key];
  }
  return {
    age: toShares(age), gender: toShares(gender),
    countries: toShares(mapCountryNames(country)),
    devices: {}, active_hours: emptyHeat(),
  };
}

/* ------------------------------- TikTok ---------------------------------- */
async function syncTiktok(acc: AccountRow, token: string, c: { calls: number }): Promise<{ days: DayRow[]; posts: Post[] }> {
  c.calls++;
  const info = await tiktokJson("https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count", token);
  const user = info.data?.user ?? {};
  c.calls++;
  const listRes = await tiktokPost(
    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,view_count,like_count,comment_count,share_count,create_time,share_url,duration",
    token, { max_count: 20 }
  ).catch(() => ({ data: { videos: [] } }));
  const videos = listRes.data?.videos ?? [];
  const posts: Post[] = videos.map((v: any) => ({
    external_id: String(v.id),
    title: (v.title || "TikTok video").slice(0, 120),
    media_type: "Video",
    permalink: safePermalink(v.share_url),
    published_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : new Date().toISOString(),
    views: v.view_count ?? 0,
    likes: v.like_count ?? 0,
    comments: v.comment_count ?? 0,
    shares: v.share_count ?? 0,
    saves: 0,
    reach: v.view_count ?? 0,
    avg_watch_seconds: null,   // video duration is not average watch time.
    retention_pct: null,
  }));
  // TikTok exposes no daily history, so only the follower count is a real daily
  // figure. Lifetime video views are NOT a day's reach and are no longer written
  // as one.
  const days: DayRow[] = [{
    date: today(), followers: user.follower_count ?? null,
    reach: null, impressions: null, views: null, engagements: null,
    provisional: true,
  }];
  return { days, posts };
}

/**
 * TikTok v2 returns `error: {code: "ok"}` on SUCCESS. Treating any `error` key
 * as a failure — the Meta convention — made every successful TikTok response
 * throw, so no TikTok metric was ever stored.
 */
function tiktokFailed(j: any): boolean {
  return Boolean(j?.error && j.error.code && j.error.code !== "ok");
}
async function tiktokJson(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  const j = await res.json();
  if (tiktokFailed(j)) throw new Error(j.error.message || `tiktok_error:${j.error.code}`);
  if (!res.ok) throw new Error(`tiktok HTTP ${res.status}`);
  return j;
}
async function tiktokPost(url: string, token: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (tiktokFailed(j)) throw new Error(j.error.message || "tiktok_error");
  return j;
}

/* ------------------------------ date helpers ----------------------------- */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function unixSec(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / 1000);
}
export function enumerateDays(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let d = startIso;
  for (let i = 0; i < 400 && d <= endIso; i++) { out.push(d); d = addDays(d, 1); }
  return out;
}

/** First day to fetch: always covers a trailing window, plus any gap, capped. */
export function syncStart(latest: string | null): string {
  const t = today();
  const earliest = addDays(t, -(MAX_BACKFILL - 1));
  const trailing = addDays(t, -(TRAILING_REFETCH - 1));
  let start = latest ? addDays(latest, 1) : earliest;
  if (start > trailing) start = trailing;   // re-fetch recent days so they settle
  if (start < earliest) start = earliest;
  if (start > t) start = t;
  return start;
}

function isProvisional(date: string, now: string): boolean {
  return date > addDays(now, -SETTLING_DAYS);
}

/**
 * Resolve an insight value's calendar day.
 *
 * Meta's `end_time` is the END of the period: local midnight at the start of the
 * FOLLOWING day, expressed in UTC. Slicing the UTC date off it therefore filed
 * every day one day late for any account at a UTC offset <= 0 — the whole of the
 * Americas. The UTC time-of-day encodes the account's offset, so the correct
 * calendar day can be recovered without knowing the account's timezone.
 */
export function dayKeyFromEndTime(endTime: string): string | null {
  const normalized = endTime.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  let offset = -(d.getUTCHours() + d.getUTCMinutes() / 60);
  if (offset <= -12) offset += 24;                       // normalise into (-12, +14]
  const localNextMidnight = new Date(ms + offset * 3600_000);
  return new Date(localNextMidnight.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** insight json -> { 'YYYY-MM-DD': value }, keyed by the account's own day. */
export function seriesFrom(json: any, name: string): Series {
  const row = (json.data ?? []).find((d: any) => d.name === name);
  if (!row) return UNAVAILABLE;
  const byDate: Record<string, number> = {};
  for (const v of row.values ?? []) {
    const date = typeof v.end_time === "string" ? dayKeyFromEndTime(v.end_time) : null;
    if (date && typeof v.value === "number") byDate[date] = v.value;
  }
  return { available: true, byDate };
}

function pickDay(s: Series, date: string): Metric {
  if (!s.available) return null;
  return date in s.byDate ? s.byDate[date] : null;
}

function flatFollowers(dates: string[], total: number | null): Record<string, Metric> {
  // A single current total is only true for today; do not paint it across history
  // as if it were a measured series.
  const out: Record<string, Metric> = {};
  for (const d of dates) out[d] = null;
  if (total !== null && dates.length) out[dates[dates.length - 1]] = total;
  return out;
}

/** Rebuild a cumulative followers series from the current total + daily deltas. */
export function reconstructFollowers(datesAsc: string[], currentTotal: number, deltaByDate: Record<string, number>): Record<string, Metric> {
  const out: Record<string, Metric> = {};
  let running = Math.max(0, currentTotal); // total at end of the most recent day
  for (let i = datesAsc.length - 1; i >= 0; i--) {
    const d = datesAsc[i];
    out[d] = running;
    // `follower_count` reports gross new follows, not net change, so on an account
    // with unfollows the deltas can exceed the current total. Never step below zero.
    running = Math.max(0, running - (deltaByDate[d] ?? 0));
  }
  return out;
}

/* ------------------------------ api helpers ------------------------------ */
/** Drop anything that is not a plain http(s) link before it reaches the UI. */
function safePermalink(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : null;
  } catch { return null; }
}
function pickInsight(insights: any, name: string): number {
  const row = (insights.data ?? []).find((d: any) => d.name === name);
  const v = row?.values?.[0]?.value ?? row?.total_value?.value ?? 0;
  return typeof v === "number" ? v : 0;
}
function normInsights(rows: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.name] = r.values?.[0]?.value ?? r.total_value?.value ?? 0;
  return out;
}
/** Newer IG follower_demographics: data[0].total_value.breakdowns[0].results[]. */
function parseDemographics(j: any): Record<string, number> {
  const out: Record<string, number> = {};
  const breakdowns = j.data?.[0]?.total_value?.breakdowns ?? [];
  for (const b of breakdowns) {
    for (const r of b.results ?? []) {
      const key = (r.dimension_values ?? []).join(" · ");
      if (key) out[key] = (out[key] ?? 0) + (r.value ?? 0);
    }
  }
  return out;
}
function latestValue(rows: any[], name: string): Record<string, number> | null {
  const row = rows.find((r) => r.name === name);
  const values = row?.values ?? [];
  return values.length ? values[values.length - 1].value : null;
}
/**
 * Bucket hourly online-followers values into a [7][24] weekday x hour grid.
 *
 * NOTE: the weekday is derived from the value's own end_time, consistent with
 * dayKeyFromEndTime. The HOUR keys are passed through as the platform reports
 * them, and which timezone those hours are expressed in is NOT yet confirmed for
 * Instagram. Until it is, the Planner must label its recommendations with the
 * timezone it is using rather than implying the viewer's local time.
 */
export function bucketOnline(values: any[]): number[][] {
  const heat = emptyHeat();
  for (const entry of values) {
    const map = entry?.value;
    if (!map || typeof map !== "object") continue;
    const day = entry.end_time ? dayKeyFromEndTime(entry.end_time) : null;
    const wd = day ? new Date(day + "T12:00:00Z").getUTCDay() : 0;
    for (let h = 0; h < 24; h++) heat[wd][h] += Number(map[h] ?? map[String(h)] ?? 0);
  }
  return heat;
}
function emptyHeat(): number[][] {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}
function toShares(obj: Record<string, number>): Record<string, number> {
  const total = Object.values(obj).reduce((s, v) => s + v, 0);
  if (!total) return {};
  const out: Record<string, number> = {};
  for (const k of Object.keys(obj)) out[k] = obj[k] / total;
  return out;
}
function normalizeGender(raw: Record<string, number>): Record<string, number> {
  const mapped: Record<string, number> = {};
  for (const k of Object.keys(raw)) {
    const key = /^f/i.test(k) ? "female" : /^m/i.test(k) ? "male" : "other";
    mapped[key] = (mapped[key] ?? 0) + raw[k];
  }
  return toShares(mapped);
}
const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", BR: "Brazil", DE: "Germany", FR: "France",
  IN: "India", ID: "Indonesia", EG: "Egypt", SA: "Saudi Arabia", AE: "UAE", CA: "Canada",
  AU: "Australia", ES: "Spain", IT: "Italy", MX: "Mexico", NG: "Nigeria", TR: "Türkiye",
  JP: "Japan", PH: "Philippines", PK: "Pakistan", NL: "Netherlands", RU: "Russia",
  JO: "Jordan", KW: "Kuwait", QA: "Qatar", LB: "Lebanon", IQ: "Iraq", MA: "Morocco",
};
function mapCountryNames(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(raw)) out[COUNTRY_NAMES[k] ?? k] = raw[k];
  return out;
}
function hasAudience(a: Audience): boolean {
  return Object.keys(a.age).length > 0 || Object.keys(a.gender).length > 0 ||
    Object.keys(a.countries).length > 0 || a.active_hours.some((r) => r.some((v) => v > 0));
}
