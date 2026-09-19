/**
 * Mutation check — does the suite actually detect a defect?
 *
 * The pre-launch audit measured the previous harness at 0/13: thirteen defects
 * injected into real source all survived, eleven with byte-identical output.
 * This injects defects into the COMPILED output, runs the suite, and requires
 * each one to be caught. It is the acceptance gate for the tests themselves.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

/*
 * EVERY test file, not a hand-kept list. The list missed the first three files
 * added after it was written, so mutations of the LinkedIn onboarding code ran
 * against a suite that never loaded the tests guarding it and "survived".
 */
const TEST_FILES = readdirSync("verify/tests").filter((f) => f.endsWith(".test.mjs")).sort().map((f) => `verify/tests/${f}`);

const SYNC = "verify/build/_sync.js";
const LIB = "verify/build/_lib.js";
const TOKENS = "verify/build/_tokens.js";
const DELETION = "verify/build/meta-data-deletion.js";
const INSTA = "verify/build/_instagram.js";
const LINKEDIN = "verify/build/_linkedin.js";
const TOKENS_LI = "verify/build/_tokens.js";
const INSIGHTS = "verify/build-lib/insights.js";
const FORMAT = "verify/build-lib/format.js";
const CSVREPORT = "verify/build-lib/csvReport.js";
const XLSX = "verify/build-lib/xlsx.js";
const REPORTMETA = "verify/build-lib/reportMeta.js";
const ANALYTICS = "verify/build-lib/analytics.js";
const SNAPSHOT = "verify/build-lib/snapshot.js";
const SYNC_HANDLER = "verify/build/sync.js";

const PAGE_PICK = "verify/build/linkedin-page.js";
const SHARE = "verify/build/share.js";
const REFRESH = "verify/build/refresh-post.js";
const CRON = "verify/build/sync-cron.js";
const HEALTH = "verify/build/health.js";
const AUDIT = "verify/build/_audit.js";

const mutations = [
  { name: "disconnect saying 'data deleted' after the deletes were refused", file: "verify/build/disconnect.js",
    find: "if (failed.length) {", replace: "if (false) {" },
  { name: "deauthorize reporting ok while still holding the withdrawn credential", file: "verify/build/meta-deauthorize.js",
    find: "return json(200, { ok: failedWrites === 0, accounts: stopped });", replace: "return json(200, { ok: true, accounts: stopped });" },
  { name: "a Meta deletion request that matched nobody not raised to a person", file: AUDIT,
    find: 'if (r.event === "platform.deletion_request" && r.detail?.status === "not_found")', replace: "if (false)" },
  { name: "the audit log trusting a forged state's user id", file: AUDIT,
    find: "user_id = verifyState(q.state, readCookie(event.headers?.cookie, STATE_COOKIE))?.uid ?? null;",
    replace: 'user_id = JSON.parse(Buffer.from(String(q.state).split(".")[0], "base64url").toString()).uid ?? null;' },
  { name: "security alarms not turning health red", file: HEALTH,
    find: "if (alarms)", replace: "if (false)" },
  { name: "a stopped weekly security review not noticed", file: HEALTH,
    find: "if (owed)", replace: "if (false)" },
  { name: "the audit purge deleting rows younger than 90 days", file: AUDIT,
    find: '.delete().lt("at", cutoff);', replace: '.delete().lt("at", new Date(now).toISOString());' },
  { name: "credential-looking keys written into audit rows", file: AUDIT,
    find: "if (!CREDENTIAL_KEY.test(k))", replace: "if (true)" },
  { name: "'we have been alerted' with nothing alerting anyone", file: "verify/build/account-data.js",
    find: 'await audit(db, "account.delete", "failure", { user_id: uid, detail: { reason: "sign_in_record_not_removed", code } });', replace: "" },
  { name: "health judged by turns taken, blind to a sync that never succeeds (2026-09-18)", file: HEALTH,
    find: "ago(a.last_synced_at ?? a.connected_at)", replace: "ago(a.sync_turn_at ?? a.connected_at)" },
  { name: "a stopped cron not noticed by the health check", file: HEALTH,
    find: "if (live.length && lastTurnMs > CRON_SILENT_MS)", replace: "if (false)" },
  { name: "health detail shown to anyone without the key", file: HEALTH,
    find: ": { ok: result.ok };", replace: ": { ok: result.ok, ...result.detail };" },
  { name: "a health answer the browser or a CDN may cache", file: HEALTH,
    find: '// A cached "ok" is exactly the failure this endpoint exists to prevent.\n        headers: { "content-type": "application/json", "cache-control": "no-store" },',
    replace: '// A cached "ok" is exactly the failure this endpoint exists to prevent.\n        headers: { "content-type": "application/json" },' },
  { name: "a client's expired connection turning the system health red", file: HEALTH,
    find: 'const live = rows.filter((a) => a.status === "connected");', replace: "const live = rows;" },
  { name: "any key accepted for the health detail", file: HEALTH,
    find: "return a.length === b.length && crypto.timingSafeEqual(a, b);", replace: "return true;" },
  { name: "LinkedIn pages called stale at Instagram's pace", file: HEALTH,
    find: 'const turn = platform === "linkedin"', replace: 'const turn = false' },
  { name: "two accounts per cron run, so the second hits the 50-subrequest cap", file: CRON,
    find: "if (attempted >= PER_RUN)", replace: "if (attempted >= PER_RUN + 1)" },
  { name: "the cron queue ordered by last success, so a failing account takes every slot", file: CRON,
    find: '.order("sync_turn_at", { ascending: true, nullsFirst: true })',
    replace: '.order("last_synced_at", { ascending: true, nullsFirst: true })' },
  { name: "a cron turn never recorded, so a run that dies is first in line forever", file: CRON,
    find: ".update({ sync_turn_at: new Date(now).toISOString() })", replace: ".update({})" },
  { name: "every account re-synced every minute, due or not", file: CRON,
    find: "        .or(`sync_turn_at.is.null,sync_turn_at.lt.${dueBefore}`)\n        .order(", replace: "        .order(" },
  { name: "taking an account unconditionally, so overlapping runs both sync it", file: CRON,
    find: '            .eq("id", acc.id)\n            .or(`sync_turn_at.is.null,sync_turn_at.lt.${dueBefore}`)\n            .select("id");',
    replace: '            .eq("id", acc.id)\n            .select("id");' },
  { name: "a lost claim run anyway", file: CRON,
    find: "if (!claimed?.length) {", replace: "if (false) {" },
  { name: "a cron run that could claim nothing reported as a quiet 200", file: CRON,
    find: "const healthy = ok > 0 || (attempted === 0 && unclaimable === 0);",
    replace: "const healthy = attempted === 0 || ok > 0;" },
  { name: "a LinkedIn page held back by its call limit using up the run", file: CRON,
    find: "skipped++;", replace: "skipped++; attempted++;" },
  { name: "disconnected and expired accounts queued for sync", file: CRON,
    find: '.eq("status", "connected")\n        .or(', replace: '.or(' },
  { name: "a refresh response carrying nulls that blank stored figures on screen", file: REFRESH,
    find: "? { ...known, refreshed_at: refreshedAt }\n", replace: "? { ...fresh, refreshed_at: refreshedAt }\n" },
  { name: "a story refreshed with the feed metric list, so it always fails", file: REFRESH,
    find: "if (story) {", replace: "if (false) {" },
  { name: "a refused story list failing the refresh instead of stepping down", file: REFRESH,
    find: "for (const metrics of storyLadderFrom(preferred)) {", replace: "for (const metrics of storyLadderFrom(preferred).slice(0, 1)) {" },
  { name: "an expired story re-read on every page open", file: REFRESH,
    find: "if (story && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {", replace: "if (false) {" },
  { name: "'checked just now' claimed when nothing came back", file: REFRESH,
    find: ": { refreshed_at: refreshedAt })", replace: ": { refreshed_at: refreshedAt, checked_at: refreshedAt })" },
  { name: "a dead token stepped down the story ladder instead of reported", file: REFRESH,
    find: "if (isAuthError(e) || isThrottleError(e))\n                        throw e;", replace: "if (false)\n                        throw e;" },
  { name: "any tenant's post refreshable by id", file: REFRESH,
    find: '.eq("social_accounts.user_id", uid)', replace: "" },
  { name: "an expired share link still serving a client's figures", file: SHARE,
    find: "if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {",
    replace: "if (false) {" },
  { name: "an expiry the caller asked for stored as no expiry at all", file: SHARE,
    find: "expiresAt = new Date(Date.now() + Math.round(days) * 86_400_000).toISOString();",
    replace: "expiresAt = null;" },
  { name: "a nonsense expiry accepted, so the link never ends", file: SHARE,
    find: "if (typeof days !== \"number\" || !Number.isFinite(days) || days < 1 || days > 365)",
    replace: "if (false)" },
  { name: "the expired refusal carrying the snapshot anyway", file: SHARE,
    find: 'return json(410, { message: "This link has expired.", code: "expired" });',
    replace: 'return json(410, { message: "This link has expired.", code: "expired", snapshot: data.payload });' },
  { name: "a LinkedIn Page switch that keeps the previous Page's numbers", file: PAGE_PICK,
    find: 'gone("metrics_daily", await db.from("metrics_daily").delete().eq("account_id", acc.id)),',
    replace: "true," },
  { name: "any URN the browser sends accepted as a Page to connect", file: PAGE_PICK,
    find: "if (!available.includes(urn))", replace: "if (false)" },
  { name: "a Page switch that repoints the account after a refused delete", file: PAGE_PICK,
    find: "if (failed) {", replace: "if (false) {" },
  { name: "another user's LinkedIn account switchable", file: PAGE_PICK,
    find: "if (!acc || acc.user_id !== uid || acc.platform !== \"linkedin\")", replace: "if (!acc)" },
  { name: "the sync left reading the old Page after a switch", file: PAGE_PICK,
    find: ".update({ extra: { ...extra, urn } })", replace: ".update({ extra })" },
  { name: "a switched account still claiming it was synced recently", file: PAGE_PICK,
    find: "last_synced_at: null,", replace: "last_synced_at: new Date().toISOString()," },
  { name: "page names re-fetched on every render, burning the daily call budget", file: PAGE_PICK,
    find: "const missing = urns.filter((u) => !known[u]);", replace: "const missing = urns;" },
  { name: "a later account's arrival drawn as a follower surge", file: "verify/build-lib/series.js",
    find: "if (new Set(firstDay.values()).size <= 1) {", replace: "if (true) {" },
  { name: "a newly connected account counted as follower growth", file: "verify/build-lib/series.js",
    find: "if (!start || start.date >= end.date)", replace: "if (!start)" },
  { name: "an unmeasurable follower trend presented as a measured one", file: ANALYTICS,
    find: "deltaKnown: g !== null", replace: "deltaKnown: true" },
  { name: "a stale story-metric narrowing obeyed after the ladder changed", file: SYNC,
    find: "storyMetrics = v?.v === STORY_METRIC_LADDER_VERSION && typeof v?.metrics === \"string\" ? v.metrics : null;",
    replace: "storyMetrics = typeof v?.metrics === \"string\" ? v.metrics : null;" },
  // Retargeted 2026-09-19: the ladder and the story mapping moved into
  // _instagram.ts so the sync and refresh-post share one copy. Mutating the
  // shared helper now breaks BOTH callers, which is the point of sharing it.
  { name: "the middle rung skipped, losing the four creator story metrics", file: INSTA,
    find: "return preferred && ladder.includes(preferred) ? ladder.slice(ladder.indexOf(preferred)) : [...ladder];",
    replace: "return [ladder[0], ladder[2]];" },
  { name: "no fallback when Meta refuses the full story metric list", file: SYNC,
    find: "for (const metrics of ladder) {", replace: "for (const metrics of ladder.slice(0, 1)) {" },
  { name: "a story's total_interactions requested and thrown away again", file: INSTA,
    find: "interactions: ins.total_interactions ?? null,", replace: "interactions: null," },
  { name: "the story navigation split stored under unreadable keys", file: SYNC,
    find: 'String((r.dimension_values ?? []).join("_")).toLowerCase()', replace: 'String((r.dimension_values ?? []).join("_"))' },
  { name: "a story ranked among posts, so it always comes last", file: INSIGHTS,
    find: "fmt(c) === fmt(post) && c[key] !== null", replace: "c[key] !== null" },
  { name: "a story called too early to judge for its whole life", file: INSIGHTS,
    find: '(mediaType === "Story" ? 1 : 24)', replace: "24" },
  { name: "a LinkedIn profile connection stored as a Company Page", file: "verify/build/oauth-linkedin-callback.js",
    find: 'if (state.k === "profile") {', replace: 'if (false) {' },
  { name: "a LinkedIn profile's follower count dropped", file: SYNC,
    find: "row(t).followers = total;", replace: "row(t).followers = null;" },
  { name: "a profile with no posts shown as zero impressions", file: SYNC,
    find: "date, followers: null, reach: null, impressions: null, views: null, engagements: null,",
    replace: "date, followers: null, reach: null, impressions: 0, views: null, engagements: 0," },
  { name: "a LinkedIn profile's post statistics kept past the 48-hour hold", file: SYNC,
    find: "    if (member) {", replace: "    if (false) {" },
  { name: "an incomplete token audit recorded as clean", file: INSTA,
    find: "return incomplete ? null : held;", replace: "return held;" },
  { name: "LinkedIn history dug in Instagram-sized chunks", file: SYNC,
    find: "addDays(today(), -(LI.MAX_HISTORY_DAYS - 1)), counter, today())", replace: "start, counter, window.end)" },
  { name: "LinkedIn sponsored dark posts stored as page posts", file: SYNC,
    find: "&& !p.adContext?.isDsc", replace: "" },
  { name: "LinkedIn posts that never reach the feed stored as page posts", file: SYNC,
    find: '&& p.distribution?.feedDistribution !== "NONE"', replace: "" },
  { name: "LinkedIn drafts stored as page posts", file: SYNC,
    find: '(p.lifecycleState === undefined || p.lifecycleState === "PUBLISHED")', replace: "true" },
  { name: "LinkedIn posts read from the first page only", file: SYNC,
    find: "if (reachedFloor || !hasNext)", replace: "if (true)" },
  { name: "LinkedIn posts past the six-month storage limit are stored", file: SYNC,
    find: "(p.publishedAt ?? p.createdAt ?? 0) >= postFloorMs", replace: "true" },
  { name: "LinkedIn reporting data kept past its one-year limit", file: SYNC,
    find: '.lt("date", reportingFloor)', replace: '.lt("date", "0000-00-00")' },
  { name: "LinkedIn posts kept past their six-month limit", file: SYNC,
    find: '.lt("published_at", postFloor)', replace: '.lt("published_at", "0000")' },
  { name: "LinkedIn ugcPosts asked for as shares, then recorded as zero", file: SYNC,
    find: '["ugcPost", "ugcPosts"]', replace: '["ugcPost", "shares"]' },
  { name: "a failed LinkedIn per-post call writes zeros over every post", file: SYNC,
    find: "kindOf && answered.has(kindOf)", replace: "true" },
  { name: "LinkedIn query structure percent-encoded, so Rest.li cannot parse it", file: LINKEDIN,
    find: "`${encodeURIComponent(k)}=${v}`", replace: "`${encodeURIComponent(k)}=${encodeURIComponent(v)}`" },
  { name: "the page-admin lookup reads a field name the documentation never shows", file: LINKEDIN,
    find: "urn: e.organization ?? e.organizationTarget ?? e.organizationalTarget,", replace: "urn: e.organizationalTarget," },
  { name: "development tier makes the BATCH_GET calls it forbids", file: SYNC,
    find: 'if (liTier() === "standard") {', replace: 'if (true) {' },
  { name: "a refused taxonomy lookup marks a working LinkedIn page expired", file: SYNC,
    find: "if (isAuthError(e) && e.status !== 403)", replace: "if (isAuthError(e))" },
  { name: "an unresolved taxonomy drawn as Unknown 100%", file: SYNC,
    find: 'if (f.kind !== "enum" && !resolved.has(f.kind))', replace: "if (false)" },
  { name: "a LinkedIn page synced on every cron turn, past its daily call limit", file: SYNC_HANDLER,
    find: "return Boolean(last) && now - Date.parse(last) < liMinSyncIntervalMs();", replace: "return false;" },
  { name: "an Instagram deletion request looked up as a Meta user", file: DELETION,
    find: 'return { payload: ig, provider: "instagram" };',
    replace: 'return { payload: ig, provider: "meta" };' },
  { name: "reach inflated 10x", file: SYNC,
    find: "byDate[date] = v.value;", replace: "byDate[date] = v.value * 10;" },
  { name: "every day filed 5 days late", file: SYNC,
    find: "return new Date(localNextMidnight.getTime() - 86_400_000).toISOString().slice(0, 10);",
    replace: "return new Date(localNextMidnight.getTime() + 4 * 86400000).toISOString().slice(0, 10);" },
  { name: "trailing re-fetch disabled (days freeze again)", file: SYNC,
    find: "const TRAILING_REFETCH = 7;", replace: "const TRAILING_REFETCH = 1;" },
  { name: "unknown metrics fabricated as zero", file: SYNC,
    find: "const pick = (fresh, key) => (fresh !== null ? fresh : (p?.[key] ?? null));",
    replace: "const pick = (fresh, key) => (fresh !== null ? fresh : (p?.[key] ?? 0));" },
  { name: "rows written under another tenant's account", file: SYNC,
    find: "account_id: acc.id,\n            platform: acc.platform,",
    replace: "account_id: 'SOMEONE-ELSES-ACCOUNT',\n            platform: acc.platform," },
  { name: "throttling swallowed instead of re-thrown", file: SYNC,
    find: "if (isThrottleError(e) || isAuthError(e))\n            throw e;",
    replace: "if (false)\n            throw e;" },
  { name: "OAuth state accepted without the browser cookie", file: LIB,
    find: "if (!data.n || !cookieNonce || !safeEqual(String(data.n), cookieNonce))\n            return null;",
    replace: "if (false)\n            return null;" },
  { name: "cross-tenant account attachment allowed", file: LIB,
    find: "if (owner)\n        throw new AccountOwnedByAnotherTenant(", replace: "if (false)\n        throw new AccountOwnedByAnotherTenant(" },
  { name: "tokens stored in the clear", file: LIB,
    find: "return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString(\"base64\");",
    replace: "return plain;" },
  { name: "auth errors classified by message text again", file: LIB,
    find: "return e instanceof GraphError && e.code !== undefined && AUTH_CODES.has(e.code);",
    replace: "return e instanceof GraphError && /token|expired|oauth|session/i.test(e.message);" },
  { name: "rotated refresh token discarded", file: TOKENS,
    find: "refresh_token: body.refresh_token ? encryptToken(body.refresh_token) : id.refresh_token,",
    replace: "refresh_token: id.refresh_token," },
  { name: "refresh lock removed (concurrent refresh kills the token)", file: TOKENS,
    find: "if (!(await acquireRefreshLock(db, id.id)))\n        return \"locked\";",
    replace: "if (false)\n        return \"locked\";" },
  { name: "all providers share one refresh window", file: TOKENS,
    find: "const window = id.provider === \"tiktok\" ? RENEW_WITHIN_MS_TIKTOK",
    replace: "const window = RENEW_WITHIN_MS; const _unused = id.provider === \"tiktok\" ? RENEW_WITHIN_MS_TIKTOK" },
  { name: "signed_request signature not verified", file: DELETION,
    find: "if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected))\n        return null;",
    replace: "if (false)\n        return null;" },
  { name: "deletion acknowledges without deleting", file: DELETION,
    find: "gone(\"account_secrets\", await db.from(\"account_secrets\").delete().eq(\"account_id\", a.id));",
    replace: "" },
  { name: "deploy previews allowed to touch the production database", file: LIB,
    find: "if ((context === \"deploy-preview\" || context === \"branch-deploy\") && !process.env.ALLOW_NONPROD_DB) {",
    replace: "if (false) {" },
  { name: "net follower change treats unreported churn as zero", file: INSIGHTS,
    find: "net: bothKnown ? gained - lost : null,",
    replace: "net: (gained ?? 0) - (lost ?? 0)," },
  { name: "churn rate treats unreported unfollows as zero", file: INSIGHTS,
    find: "churnRate: bothKnown && gained > 0 ? lost / gained : null,",
    replace: "churnRate: gained && gained > 0 ? (lost ?? 0) / gained : null," },
  { name: "follows_and_unfollows dimension read as audience type, not direction", file: SYNC,
    find: 'if (key.includes("NON_FOLLOWER") || key.includes("NON-FOLLOWER"))',
    replace: 'if (key.includes("UNFOLLOW"))' },
  { name: "token scope audit proves a write scope by attempting the write", file: INSTA,
    find: 'const res = await fetch(u, { signal: AbortSignal.timeout(8000) });',
    replace: 'const res = await fetch(u, { method: "POST", signal: AbortSignal.timeout(8000) });' },
  { name: "call budget removed, letting a run overrun and lose its writes", file: SYNC,
    find: "if (c.calls >= callBudget())",
    replace: "if (false)" },
  { name: "day loop walks oldest-first, so truncation loses the newest days", file: SYNC,
    find: "const date = dates[dates.length - 1 - n];",
    replace: "const date = dates[n];" },
  /*
   * Expressed against backfillTurn rather than against the branch, because at the
   * default 30-day floor a dig finishes in two runs and deleting the guard
   * changes nothing observable. It is the deep backfill the guard protects —
   * Meta allows two years — so the defect is only visible where the turn is
   * computed. Returning a constant that is never 3 is exactly "never yield".
   */
  { name: "backfill never yields, so recent days freeze for the whole dig", file: SYNC,
    find: "    return Math.floor(Math.max(0, days) / Math.max(1, budget)) % 4;",
    replace: "    return 0;" },
  /*
   * The backfill turn taken from the wall clock again.
   *
   * This is the defect that was live: every run inside the same quarter-hour
   * computed the identical window, so a client pressing Sync during onboarding
   * repeated the previous fetch each time, and the suite itself failed for
   * fifteen minutes in every hour.
   */
  { name: "backfill turn keyed on the clock, so repeated syncs repeat work", file: SYNC,
    find: "    const days = Math.round((Date.parse(earliest) - Date.parse(floor)) / 86_400_000);\n    return Math.floor(Math.max(0, days) / Math.max(1, budget)) % 4;",
    replace: "    return Math.floor(Date.now() / (15 * 60 * 1000)) % 4;" },
  { name: "trailing window stops rotating, so the far end is never refreshed", file: SYNC,
    find: "const from = (ticks % slices) * slice;",
    replace: "const from = 0;" },
  { name: "media truncated at the first page", file: SYNC,
    find: "if (!after || !body.paging?.next)",
    replace: "if (true)" },
  /*
   * Story capture, 2026-09-12. One fresh story under Meta's five-view threshold
   * used to empty the capture for every live story on the account, because the
   * list and its insights were one all-or-nothing request.
   */
  { name: "a story's existence made to depend on Meta measuring it", file: SYNC,
    find: "const list = await optional(() => get(`/${externalId}/${IG.STORIES_EDGE}`, { fields: IG.STORY_FIELDS }), { data: [] }, { ...ctx, call: \"stories\" });",
    replace: "const list = await optional(() => get(`/${externalId}/${IG.STORIES_EDGE}`, { fields: `${IG.STORY_FIELDS},insights.metric(${IG.STORY_INSIGHT_METRICS})` }), { data: [] }, { ...ctx, call: \"stories\" });" },
  { name: "a story the batch could not measure left unmeasured", file: SYNC,
    find: "            if (!st?.id || insightsById.has(st.id))\n                continue;",
    replace: "            if (true)\n                continue;" },
  { name: "a valueless insight written as a confident zero", file: INSTA,
    find: "        if (typeof v === \"number\" && Number.isFinite(v))\n            out[r.name] = v;",
    replace: "        if (true)\n            out[r.name] = v ?? 0;" },
  { name: "a refused run writing null over a story's measured figures", file: SYNC,
    find: "        const merged = await mergeContentWithStored(db, acc, posts);",
    replace: "        const merged = posts;" },
  { name: "stories not captured at all", file: SYNC,
    find: "return { days, posts: [...posts, ...stories] };",
    replace: "return { days, posts };" },
  { name: "a story's absent likes stored as zero, sinking it in every ranking", file: INSTA,
    find: "likes: null, comments: null, saves: null,",
    replace: "likes: 0, comments: 0, saves: 0," },
  { name: "an unreported post metric stored as zero instead of null", file: SYNC,
    find: "reach: ins.reach ?? null,",
    replace: "reach: ins.reach ?? 0," },
  { name: "a day with no post to derive engagement from stored as zero", file: SYNC,
    find: "engagements[d] = d in reach.byDate ? byDate[d] ?? null : null;",
    replace: "engagements[d] = d in reach.byDate ? byDate[d] ?? 0 : null;" },
  { name: "discovery rate derived from only one half of the split", file: INSIGHTS,
    find: "discoveryRate: bothKnown && attributed > 0 ? nonFollowers / attributed : null,",
    replace: "discoveryRate: attributed > 0 ? (nonFollowers ?? 0) / attributed : null," },
  { name: "Instagram Login requests a write-capable scope", file: INSTA,
    find: 'SCOPES: ["instagram_business_basic", "instagram_business_manage_insights"],',
    replace: 'SCOPES: ["instagram_business_basic", "instagram_business_manage_insights", "instagram_business_content_publish"],' },
  { name: "short-lived Instagram token stored instead of long-lived", file: INSTA,
    find: "const accessToken = long.access_token || short.access_token;",
    replace: "const accessToken = short.access_token;" },
  // The follower series is cumulative, so it is only as right as the ONE total it
  // is derived from. Both of these restore ways of getting that total wrong.
  { name: "follower series anchored on today's count for an old window", file: SYNC,
    find: "const resolved = anchor ?? (reachesToday && liveTotal !== null ? { date: end, total: liveTotal } : null);",
    replace: "const resolved = (liveTotal !== null ? { date: end, total: liveTotal } : null);" },
  { name: "backfill overlap removed (no stored day anchors the chunk)", file: SYNC,
    find: "        const end = earliest;",
    replace: "        const end = addDays(earliest, -1);" },
  // Restores the defect found on the first live call: the account's calendar day
  // taken from the platform's own bucketing. A Jordanian account came back on US
  // Pacific midnight, so every daily figure covered 10:00-10:00 Amman under a
  // label that said otherwise. Both Instagram paths, because one insights
  // reference governs both and the defect was in both.
  { name: "day boundary taken from the platform instead of the account", file: SYNC,
    find: `    const offset = accountOffsetHours(acc);
    const metaOffset = offsetFrom(reachJson, ctx);`,
    replace: `    const offset = offsetFrom(reachJson, ctx);
    const metaOffset = offset;` },
  // 0008. Both restore a way of reporting a number that looks right and is not.
  { name: "churn discarded — only the net follower change kept", file: SYNC,
    find: "    const follows = seriesFromRaw(followRaw, (j) => followDirections(j).follows);",
    replace: "    const follows = seriesFromRaw(followRaw, () => null);" },
  { name: "UNKNOWN folded into follower reach, inflating the discovery split", file: SYNC,
    find: `            if (key.includes("NON_FOLLOWER") || key.includes("NON-FOLLOWER"))
                nonFollowers = (nonFollowers ?? 0) + value;
            else if (key.includes("FOLLOWER"))
                followers = (followers ?? 0) + value;`,
    replace: `            if (key.includes("NON_FOLLOWER") || key.includes("NON-FOLLOWER"))
                nonFollowers = (nonFollowers ?? 0) + value;
            else
                followers = (followers ?? 0) + value;` },
  { name: "unset account timezone silently inherits the platform's boundary", file: SYNC,
    find: "  return (typeof m === \"number\" && Number.isFinite(m) ? m : DEFAULT_TZ_OFFSET_MINUTES) / 60;",
    replace: "  return (typeof m === \"number\" && Number.isFinite(m) ? m : 0) / 60;" },
  /*
   * An unknown read time invented as "just now".
   *
   * This is the fabricated-zero defect wearing a different hat, and it damages
   * the same way. The freshness line exists so a client comparing this dashboard
   * against the Instagram app can tell a timing gap from an error. A line that
   * claims a figure was read seconds ago when nobody knows when it was read
   * makes the product confidently wrong at precisely the moment it is being
   * checked, which is worse than saying nothing at all.
   */
  /*
   * The deep layer states conclusions, not measurements, and a client cannot
   * check a conclusion against their phone. Every mutation below turns a guarded
   * analysis into a confident one, which is the exact failure this layer risks.
   */
  { name: "a timing recommendation made on a single post", file: INSIGHTS,
    find: "lift: xs && xs.length >= TIMING_MIN_POSTS ? median(xs) : null,",
    replace: "lift: xs && xs.length >= 1 ? median(xs) : null," },
  { name: "one viral post allowed to carry a whole time slot", file: INSIGHTS,
    find: "lift: xs && xs.length >= TIMING_MIN_POSTS ? median(xs) : null,",
    replace: "lift: xs && xs.length >= TIMING_MIN_POSTS ? xs.reduce((a, v) => a + v, 0) / xs.length : null," },
  { name: "publish times read as UTC instead of the account's own", file: INSIGHTS,
    find: "const d = new Date(ms + tzOffsetMinutes * 60_000);",
    replace: "const d = new Date(ms);" },
  { name: "typical follower loss taken as the mean, hiding every spike", file: INSIGHTS,
    find: "const typical = median(losses);",
    replace: "const typical = losses.reduce((a, v) => a + v, 0) / losses.length;" },
  { name: "reach divided by a follower count from AFTER the post", file: INSIGHTS,
    find: "            if (f.date <= day)",
    replace: "            if (true)" },
  /*
   * The export is read without the interface around it, by the person the client
   * is negotiating with. Both mutations below put a number in front of a sponsor
   * that nobody measured.
   */
  { name: "unreported metrics exported as the literal string from the value", file: CSVREPORT,
    find: 'typeof v === "number" && Number.isFinite(v) ? String(v) : "";',
    replace: 'String(v);' },
  { name: "a rate invented where the denominator is unknown", file: CSVREPORT,
    find: 'typeof v === "number" && Number.isFinite(v) ? v.toFixed(dp) : "";',
    replace: 'Number(v).toFixed(dp);' },
  { name: "an unknown figure written into the workbook as a zero", file: XLSX,
    find: 'if (cell.v === null || cell.v === undefined || cell.v === "")',
    replace: 'if (false)' },
  /*
   * LinkedIn. Two defects that have already happened once on the Meta path, and
   * one that is specific to holding a write-capable scope.
   */
  { name: "LinkedIn asks for a write scope on top of reading", file: LINKEDIN,
    find: 'SCOPES: ["r_organization_social", "rw_organization_admin", "r_basicprofile", "r_member_profileAnalytics", "r_member_postAnalytics"],',
    replace: 'SCOPES: ["r_organization_social", "rw_organization_admin", "r_basicprofile", "r_member_profileAnalytics", "r_member_postAnalytics", "w_member_social"],' },
  { name: "an unreported LinkedIn figure becomes a zero", file: LINKEDIN,
    find: "export const liNum = (v) => typeof v === \"number\" && Number.isFinite(v) ? v : null;",
    replace: "export const liNum = (v) => typeof v === \"number\" && Number.isFinite(v) ? v : 0;" },
  { name: "LinkedIn history reaches past the window the API serves", file: LINKEDIN,
    find: "MAX_HISTORY_DAYS: 365,", replace: "MAX_HISTORY_DAYS: 3650," },
  /*
   * Now that a mock exists, the sync itself can be mutated. These three are the
   * defects most likely to reach a client: a post's reach invented from
   * impressions, a day filed one out because of the exclusive end, and a
   * per-page figure spread backwards across days nobody measured.
   */
  /*
   * A LinkedIn token reported as refreshed when nothing refreshed it. The cron
   * cannot renew one; claiming it did lets the connection lapse in silence and
   * the client discovers it as an empty dashboard.
   */
  { name: "a LinkedIn token claimed as refreshed when it cannot be", file: TOKENS_LI,
    find: '    return "skipped";\n}', replace: '    return "refreshed";\n}' },
  /*
   * Phase 2 — follower demographics. Four defects that all produce a plausible
   * chart, which is why they are here rather than trusted to review.
   */
  /*
   * The gender panel measuring an account nothing was reported for. This one
   * actually shipped; it was found by rendering the page, not by reading it.
   */
  /*
   * A posting window invented from a grid of zeros — the "most active Sun 12am"
   * an account with no hourly data was being given as advice.
   *
   * This one has to remove BOTH guards at once, and finding that out was worth
   * the detour: `max <= 0` returns early, and independently `score > 0` drops
   * the NaN that 0/0 produces. Mutating either alone changes nothing and the
   * mutation survives, which says the two are redundant rather than that the
   * test is weak. Injected here as the unguarded version the page actually had.
   */
  { name: "a posting window invented from a heatmap of zeros", file: INSIGHTS,
    find: "    if (max <= 0)\n        return [];",
    replace: "    if (false)\n        return [];\n    if (!(max > 0))\n        return [{ day: 0, hour: 0, score: 0, label: `Sunday · 12am` }];" },
  /*
   * A report naming accounts it says nothing about. The identity line is what a
   * sponsor reads to know whose numbers these are.
   */
  /*
   * The export prose going back to naming Instagram whatever the report is
   * about. This is the document that reaches a sponsor.
   */
  { name: "a LinkedIn export that says it came from Instagram", file: REPORTMETA,
    find: "export function reportSource(scope, platformName) {",
    replace: "export function reportSource(scope, platformName) {\n    return \"Instagram\";" },
  /*
   * The three defects that lived in analytics.ts and snapshot.ts while neither
   * could be compiled for a test. Every one was found by looking at a rendered
   * page; these are what would have found them here.
   */
  { name: "the assistant grounded on a fabricated zero", file: ANALYTICS,
    find: "            : totalReported(seriesByDay(d.metrics, d.scope, c.key));",
    replace: "            : (seriesByDay(d.metrics, d.scope, c.key).reduce((a, x) => a + x.value, 0));" },
  { name: "a metric nobody reported marked as reported", file: ANALYTICS,
    find: "reported: s.length > 0 };", replace: "reported: true };" },
  { name: "a scoped report borrowing another platform's posting times", file: SNAPSHOT,
    find: "        windows: bestTimes(dash.audience, scopedPlatforms, 3).map((w) => w.label),",
    replace: "        windows: bestTimes(dash.audience, dash.connectedPlatforms, 3).map((w) => w.label)," },
  { name: "a scoped report headed with every connected account", file: REPORTMETA,
    find: "        if (scope !== \"all\" && a.platform && a.platform !== scope)\n            continue;",
    replace: "        if (false)\n            continue;" },
  { name: "a metric nobody reported totalled as a confident zero", file: INSIGHTS,
    find: "    return series.length ? series.reduce((s, x) => s + x.value, 0) : null;",
    replace: "    return series.reduce((s, x) => s + x.value, 0);" },
  { name: "an unreported gender split rendered as 100% Other", file: INSIGHTS,
    find: "    if (!reported)\n        return { reported: false, female: 0, male: 0, other: 0 };",
    replace: "    if (false)\n        return { reported: false, female: 0, male: 0, other: 0 };" },
  { name: "paid followers counted twice in every demographic", file: LINKEDIN,
    find: "export const liDemographicCount = (fc) => liNum(fc?.organicFollowerCount);",
    replace: "export const liDemographicCount = (fc) => liNum((fc?.organicFollowerCount ?? 0) + (fc?.paidFollowerCount ?? 0));" },
  { name: "demographics asked for with a time range, which silently returns none", file: SYNC,
    find: '{ q: "organizationalEntity", organizationalEntity: liUrn(urn) }, { token });',
    replace: '{ q: "organizationalEntity", organizationalEntity: liUrn(urn), timeIntervals: `(timeRange:(start:${liTime(today())},end:${liTime(today())}),timeGranularityType:DAY)` }, { token });' },
  { name: "an unnameable URN dropped, inflating every other share", file: SYNC,
    find: '                : (b.id ? labels.get(`${f.kind}:${b.id}`) : null) ?? "Unknown";',
    replace: '                : (b.id ? labels.get(`${f.kind}:${b.id}`) : null);\n            if (!label) continue;' },
  { name: "a LinkedIn post's reach faked from its impressions", file: SYNC,
    find: "                reach: null,\n                avg_watch_seconds: null, retention_pct: null,",
    replace: "                reach: liNum(s.impressionCount),\n                avg_watch_seconds: null, retention_pct: null," },
  { name: "the exclusive end drops the last day asked for", file: SYNC,
    find: "end:${liTime(addDays(end, 1))}", replace: "end:${liTime(end)}" },
  /*
   * A write that fails without saying so.
   *
   * supabase-js resolves rather than throws on a PostgREST error, so deleting
   * the check restores exactly the original defect: the demographics are
   * fetched, refused by the database, and reported as stored. Passing `null` in
   * place of the error is what a call site that never destructured it looked
   * like — the write still happens, the failure just stops existing.
   *
   * Nothing downstream can catch this. The table is empty either way, which is
   * the same thing a platform with no demographics to give produces, so only the
   * log distinguishes them and only a test that reads the log can tell.
   */
  { name: "a refused audience write discarded, so demographics vanish silently", file: SYNC,
    find: 'writeFailed("sync.audience_write_failed", error, {',
    replace: 'writeFailed("sync.audience_write_failed", null, {' },
  { name: "a lost last_synced_at stamp discarded", file: SYNC,
    find: 'writeFailed("sync.last_synced_write_failed", stampErr, {',
    replace: 'writeFailed("sync.last_synced_write_failed", null, {' },
  /*
   * And the helper itself. Every call site above delegates its honesty to this
   * one line, so a `writeFailed` that quietly returns false makes all of them
   * silent again at once — including the ones no test drives directly.
   */
  /*
   * A deletion acknowledged as complete over data still held.
   *
   * The count of accounts reached is identical either way — the loop runs to the
   * end whether every delete succeeded or every one was refused — so this is a
   * confirmation code issued against an erasure that did not happen, which the
   * deletion tests call an App Review failure and an enforcement risk. The
   * status page is the only channel Meta leaves open for saying otherwise.
   */
  { name: "a refused deletion still recorded as completed", file: LIB,
    find: "    if (failed > 0)\n        return \"failed\";",
    replace: "    if (false)\n        return \"failed\";" },
  { name: "refused deletes not counted, so the request looks clean", file: DELETION,
    find: "{ provider, account: a.id, table }))\n                    failed++;",
    replace: "{ provider, account: a.id, table }))\n                    failed += 0;" },
  { name: "writeFailed reports every failed write as a success", file: LIB,
    find: "    if (!error)\n        return false;",
    replace: "    if (error)\n        return false;" },
  { name: "unknown read time invented as 'just now'", file: FORMAT,
    find: `    if (!iso)
        return null;`,
    replace: `    if (!iso)
        return "just now";` },
];

function runSuite() {
  try {
    execFileSync("node", ["--test", ...TEST_FILES], { stdio: "pipe" });
    return true;   // suite passed
  } catch { return false; } // suite failed
}

if (!runSuite()) {
  console.error("The suite does not pass on unmodified code — fix that before measuring mutations.");
  process.exit(2);
}

let caught = 0, missed = 0, stale = 0;
for (const m of mutations) {
  const original = readFileSync(m.file, "utf8");
  if (!original.includes(m.find)) {
    console.log(`  ?  ${m.name}  (pattern no longer matches the build — update this mutation)`);
    stale++;
    continue;
  }
  writeFileSync(m.file, original.replace(m.find, m.replace));
  const survived = runSuite();
  writeFileSync(m.file, original);
  if (survived) { console.log(`  SURVIVED  ${m.name}`); missed++; }
  else { console.log(`  caught    ${m.name}`); caught++; }
}

const scored = caught + missed;
console.log(`\nmutation score: ${caught}/${scored} caught` + (stale ? `  (${stale} stale pattern(s))` : ""));
if (missed > 0 || stale > 0) {
  console.error("\nA surviving mutation means the suite cannot detect that defect.");
  process.exit(1);
}
