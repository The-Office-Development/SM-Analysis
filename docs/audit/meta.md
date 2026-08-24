# R2 — Meta platform correctness & compliance audit (PulseBoard)

Branch `claude/analysis-35bck4`. Date of audit: 2026-08-23. Domain: Meta (Facebook Graph +
Instagram) API correctness, platform policy, review readiness, rate limits, account safety.

Extends `docs/LAUNCH-AUDIT.md` (L-numbers) and `docs/DATA-INTEGRITY.md` (D-numbers). Findings
are numbered **M1..Mn**. Where I contradict or narrow an earlier finding I say so explicitly.

Severity: P0 blocks launch · P1 before any real creator account · P2 before scale · P3 hardening.
Confidence: CONFIRMED (read in code / stated by ≥2 independent sources) · LIKELY · UNVERIFIED.

> **NETWORK CAVEAT.** `developers.facebook.com` was unreachable from this environment. Every
> API/policy claim below is sourced from secondary documentation (vendor docs, changelog
> mirrors, community threads) and is marked with the verification burden. **Every row of the
> migration table in §1/§2 must be re-checked against the official Graph API changelog and
> reference pages before code is changed.** Treat this as the checklist, not the proof.

---

## §1 — Complete inventory of Meta API calls

15 distinct Meta HTTP calls exist in the codebase. All pinned to **v19.0**.

### 1a. OAuth / connect path

| # | Site | Method + endpoint | Params / fields | Permission | Response shape assumed by code |
|---|---|---|---|---|---|
| O1 | `oauth-meta.ts:25` | `GET https://www.facebook.com/v19.0/dialog/oauth` | `client_id`, `redirect_uri`, `state`, `scope`, `response_type=code` | n/a (dialog) | browser redirect w/ `?code=` |
| O2 | `oauth-meta.ts:15-23` | scope string | `public_profile, pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights, business_management` | — | — |
| O3 | `oauth-meta-callback.ts:53` | `GET {GRAPH}/oauth/access_token` | `client_id, client_secret, redirect_uri, code` | n/a | `{access_token, token_type, expires_in}` — code reads only `.access_token` |
| O4 | `oauth-meta-callback.ts:60` | `GET {GRAPH}/oauth/access_token` | `grant_type=fb_exchange_token, client_id, client_secret, fb_exchange_token` | n/a | `{access_token, expires_in}` → `expires_at` computed at :66 |
| O5 | `oauth-meta-callback.ts:69` | `GET {GRAPH}/me/accounts` | `fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}` | `pages_show_list` (+`instagram_basic` for the IG edge) | `{data:[{id,name,access_token,instagram_business_account:{...}}]}` — **`paging` ignored** (:73-79) |

### 1b. Instagram sync (`syncInstagram`, 6 call sites → 9 HTTP calls/sync)

| # | Site | Endpoint | Fields / metrics | Params | Permission | Assumed response shape |
|---|---|---|---|---|---|---|
| I1 | `_sync.ts:77` | `GET /{ig-user-id}` | `fields=followers_count,media_count` | — | `instagram_basic` + `pages_read_engagement` | `{followers_count, media_count}` |
| I2 | `_sync.ts:82` | `GET /{ig-user-id}/insights` | `metric=reach,impressions` | `period=day`, `since`, `until` | `instagram_manage_insights` | `{data:[{name,values:[{value,end_time}]}]}` via `seriesFromInsight` (:288) |
| I3 | `_sync.ts:85` | `GET /{ig-user-id}/insights` | `metric=total_interactions` | `period=day`, `since`, `until` | `instagram_manage_insights` | same `values[]` shape |
| I4 | `_sync.ts:87` | `GET /{ig-user-id}/insights` | `metric=follower_count` | `period=day`, `since`, `until` | `instagram_manage_insights` | same `values[]` shape |
| I5 | `_sync.ts:93` | `GET /{ig-user-id}/media` | `fields=id,caption,media_type,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,plays)` | `limit=25` | `instagram_basic` (+ `instagram_manage_insights` for the nested insights) | `{data:[{...,insights:{data:[{name,values:[{value}]}]}}]}` via `normInsights` (:329) |
| I6a-c | `_sync.ts:141` ×3 | `GET /{ig-user-id}/insights` | `metric=follower_demographics` | `period=lifetime`, `timeframe=this_month`, `breakdown=age\|gender\|country`, `metric_type=total` | `instagram_manage_insights` | `data[0].total_value.breakdowns[0].results[].{dimension_values,value}` (:335) |
| I7 | `_sync.ts:145` | `GET /{ig-user-id}/insights` | `metric=online_followers` | `period=lifetime` **(no `since`/`until`)** | `instagram_manage_insights` | `data[0].values[] = [{end_time, value:{"0".."23": n}}]` → `bucketOnline` (:352) |

### 1c. Facebook Page sync (`syncFacebook`, 4 HTTP calls/sync)

| # | Site | Endpoint | Fields / metrics | Params | Permission | Assumed response shape |
|---|---|---|---|---|---|---|
| F1 | `_sync.ts:159` | `GET /{page-id}` | `fields=fan_count,followers_count` | — | `pages_read_engagement` | `{fan_count, followers_count}` |
| F2 | `_sync.ts:164` | `GET /{page-id}/insights` | `metric=page_impressions,page_post_engagements,page_fans` | `period=day`, `since`, `until` | `read_insights` | `{data:[{name,values:[{value,end_time}]}]}` |
| F3 | `_sync.ts:169` | `GET /{page-id}/posts` | `fields=id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true),insights.metric(post_impressions)` | `limit=25` | `pages_read_engagement` + `read_insights` | `{data:[{shares:{count}, likes:{summary:{total_count}}, comments:{summary:{total_count}}, insights:{data:[...]}}]}`; `pickInsight` (:324) accepts **either** `values[0].value` **or** `total_value.value` |
| F4 | `_sync.ts:207` | `GET /{page-id}/insights` | `metric=page_fans_gender_age,page_fans_country,page_fans_online` | `period=lifetime` | `read_insights` | `data[].values[last].value` = object map (:346); `page_fans_online` → `values[].value{hour:n}` (:352) |

**Calls per sync:** IG account = **9**; FB Page = **4**. A creator with 1 Page + 1 linked IG =
**13 Graph calls per sync**, plus 3 more (O3/O4/O5) at connect time. Used in §4.

---

## §2 — Migration checklist: every call against v25.0 (Feb 2026)

Legend: ✅ works · ⚠️ works but wrong/fragile · ❌ errors today.

### M1. STRUCTURAL: one dead metric in a comma list kills the whole request, and `.catch()` turns it into a fabricated zero. **P0, CONFIRMED (code) / LIKELY (API behaviour).**

Every Insights call in `_sync.ts` bundles several metrics into one `metric=` list and is wrapped in
`.catch(() => ({ data: [] }))` (`_sync.ts:82,85,87,93,164,169,207`). Meta returns a single
`(#100) invalid metric` error for the *whole* request when any one metric in the list is
deprecated — the valid metrics in the same call return nothing.

Then `seriesFromInsight` yields `{}`, and `days` is built with `?? 0`
(`_sync.ts:115-119`, `191-195`), so **API errors are written to the database as real zeros.**
`hasAudience()`/`try{}catch{}` (`:61-70`) does the same for demographics.

Consequences with today's API (see M2–M12): the IG daily call (I2) fails on `impressions`, so
`reach` is lost too and 30 rows of `reach=0, impressions=0, views=0` are persisted; the IG media
call (I5) fails on `plays`, so `posts=[]` *and* the engagement fallback at `:125-135` produces
`engagements=0`; the FB daily call (F2) fails on `page_impressions` **and** `page_fans`, so
`page_post_engagements` is lost too and the Page gets an all-zero chart with followers carried
flat from `prof.followers_count`.

This directly falsifies the README's headline promise ("**No mock data.** Every number comes from
a connected, synced account"): a total API failure renders as a confident chart of zeros, and
`docs/DATA-INTEGRITY.md` D1's anomaly detector then reports it to the client as a reach collapse.

**Fix (do this before any metric migration):**
1. Split every insights call to one metric per request, or at minimum catch the error and
   *retry per-metric* to isolate the failure.
2. `getJson` (`_sync.ts:312`) must check `res.ok` and surface `body.error.code` /
   `error_subcode` / `error_user_title`; never `.catch(() => ({data:[]}))` a Graph error.
3. Never write `?? 0`. Make `metrics_daily` columns nullable and write `null` for "not
   returned", so the UI can render a gap instead of a zero.
4. Add a per-sync `sync_log` row recording which metrics errored, so a deprecation is visible
   within 24h instead of after a client complains.

### M2. IG account `impressions` — REMOVED. **P0, CONFIRMED.**
`_sync.ts:82` `GET /{ig}/insights?metric=reach,impressions&period=day`.
`impressions` was deprecated for IG media *and* user insights on **21 Apr 2025** and is not
requestable on v22.0+. Requests error rather than omit.
**Replacement:** `views`. Split into two calls:
`.../insights?metric=reach&period=day&since=..&until=..` and
`.../insights?metric=views&period=day&metric_type=total_value&since=..&until=..`.
⚠️ **VERIFY:** whether account-level `views` returns a per-day `values[]` series or only a single
`total_value` for the window. If it is `total_value`-only, a daily views series is *not obtainable*
at account level and the product must say so rather than invent one.
Sources: [Emplifi](https://docs.emplifi.io/platform/latest/home/instagram-insights-metrics-deprecation-april-2025),
[Brandwatch](https://social-media-management-help.brandwatch.com/en/articles/12767947-deprecation-of-instagram-impressions-plays-and-video-views),
[Metricool](https://help.metricool.com/en/article/instagram-replaces-impressions-with-views-what-you-need-to-know-ustr2f/).

### M3. IG account `total_interactions` returns `total_value`, not `values[]` — the parser reads the wrong field. **P1, LIKELY.**
`_sync.ts:85` requests `metric=total_interactions&period=day` with **no `metric_type`**.
`total_interactions` is one of the metrics that only supports `metric_type=total_value`; the
response carries `data[0].total_value.value` and **no `values[]` array**. `seriesFromInsight`
(`:288-296`) reads `row.values` only → always `{}` → `engByDate` is always empty → the code
**always** takes the "fallback" branch at `:125`, attributing the *lifetime* engagement of the
25 most recent posts to their publish dates.
So the documented primary path for IG engagement has never executed, and IG "engagements" is in
fact a lifetime-to-date post metric filed under publish date — it keeps changing retroactively as
old posts accrue likes, and the upsert overwrites history each sync.
**Fix:** either accept that `total_interactions` is window-total-only (and stop drawing a daily
engagement line for IG), or request it with `metric_type=total_value` and a 1-day window per day.
Also handle `total_value` in `seriesFromInsight`, which today silently ignores it — note
`pickInsight` (`:324`) *does* handle both shapes, so the codebase is internally inconsistent.

### M4. IG media `plays` — REMOVED; and the metric set is invalid for non-video media anyway. **P0, CONFIRMED / LIKELY.**
`_sync.ts:93` `...&fields=...,insights.metric(reach,saved,shares,plays)&limit=25`.
`plays` was removed in the same 21 Apr 2025 change. Additionally `plays`/`shares` are not valid
for every `media_type`, so even after replacing `plays` a single request spanning images, carousels
and reels can error per-object.
**Replacement:** `insights.metric(views,reach,saved,shares,total_interactions)`, and branch by
`media_product_type` (`REELS`|`FEED`|`STORY`) rather than sending one metric list for all media.
Add `media_product_type` to `fields` — the current mapping `media_type === "VIDEO" ? "Reel"`
(`_sync.ts:99`) mislabels ordinary feed videos as Reels. **P2, CONFIRMED.**
Also `views: ins.plays ?? ins.reach ?? 0` (`:102`) silently reports **reach as views** whenever the
video metric is missing — same defect the earlier audit flagged at `:118`, but on the content table,
and it is not mentioned in `LAUNCH-AUDIT.md`.

### M5. IG `follower_demographics` — wrong `metric_type` value. **P0, LIKELY.**
`_sync.ts:141` sends `metric_type=total` but `parseDemographics` (`:335`) parses
`data[0].total_value.breakdowns[0].results[]` — the shape returned by `metric_type=**total_value**`.
The request parameter and the parser disagree; `total` is not the documented enum value for
demographic breakdown metrics.
**Fix:** `metric_type=total_value`. Keep `period=lifetime`, keep `timeframe=this_month`
(valid values are `last_14_days|last_30_days|last_90_days|prev_month|this_month|this_week`),
keep `breakdown=age|city|country|gender`.
Additional constraints the code does not handle:
- **Minimum 100 followers.** Meta returns no follower demographics below 100 followers. Caught and
  discarded at `:70` — the user sees an empty Audience tab with no explanation. **P2.**
- **Three separate HTTP calls** for age/gender/country (`:144`) where `breakdown=age,gender`
  can be combined — 3× the rate-limit cost of the demographics fetch (see §4). But note
  `parseDemographics` joins `dimension_values` with `" · "`, and `normalizeGender` (`:372`) then
  regex-matches `/^f/i` against `"25-34 · F"` → everything lands in `other`. **So combining the
  breakdowns without fixing the parser would corrupt the gender split.** **P2, CONFIRMED (code).**
- Demographics are a **point-in-time snapshot with no history** regardless of `timeframe`, yet
  `audience_snapshots` is keyed `captured_on` and the UI presents it as a dated observation.
Sources: [Phyllo](https://www.getphyllo.com/post/instagram-audience-demographics-for-influencer-marketing-platforms),
[Metricool](https://help.metricool.com/en/article/instagram-metrics-12vpkyb/).

### M6. `online_followers`: the hour keys are almost certainly NOT in the account's timezone — this changes the fix prescribed by DATA-INTEGRITY D2/D3. **P0, LIKELY — HIGHEST VERIFICATION PRIORITY.**
`_sync.ts:145` `GET /{ig}/insights?metric=online_followers&period=lifetime` (no `since`/`until`);
`bucketOnline` (`:352-361`) then does `new Date(entry.end_time).getUTCDay()` for the weekday and
uses the map keys `0..23` **verbatim** as local hours.

Three separate errors stack here:
1. **Weekday** is taken with `getUTCDay()` from `end_time`, which is the *end* of the period —
   exactly the D2 off-by-one, so for any account whose day boundary is at a non-positive UTC
   offset the whole row is filed one weekday late.
2. **Hour keys.** Multiple independent secondary sources state that Meta's Insights *API* reports
   in **Pacific time (UTC-8/-7)** while the Instagram app shows the viewer's local timezone. If
   that holds for `online_followers`, the hour keys are PT hours, and the app is presenting PT
   hours as if they were the creator's local hours — a **7–8 hour** error on top of the day error.
   `docs/DATA-INTEGRITY.md` D3 prescribes "convert `end_time` to the account timezone"; if the
   series is fixed-PT that fix is *wrong* and would leave the hours off by (account offset − PT).
3. **Window.** `online_followers` data exists only for the **last 30 days** and the call sends no
   `since`/`until`, so what is actually returned (one day? the whole 30?) is unspecified by the
   code's expectations; `bucketOnline` sums whatever it gets into a 7×24 grid with no
   normalisation by the number of observed days per weekday — a weekday that appears 5 times in
   the window outweighs one that appears 4 times purely by count.

**Fix:** (a) pin the timezone empirically — request `online_followers` for one known account and
compare the peak hour against the Instagram app's Most Active Times for the same account; (b)
store the raw hourly map plus the timezone it is expressed in, and convert once at render time;
(c) label every "best time" recommendation with that timezone in the UI; (d) pass explicit
`since`/`until` within 30 days and divide each weekday bucket by the number of days observed.
⚠️ Also verify `online_followers` still exists at all in v25.0 — it survived the Jan-2025 and
Apr-2025 IG deprecation rounds in the sources I could reach, but it is a legacy metric and the
equivalent Facebook metric (`page_fans_online`) was already removed.
Sources: [Power My Analytics — FB/IG Insights timezone mismatch](https://support.powermyanalytics.com/portal/en/kb/articles/instagram-insights-time-zone-mismatch),
[eDigital](https://www.edigitalagency.com.au/instagram/time-zone-instagram-insights-use/),
[Supermetrics — good to know about IG Insights](https://docs.supermetrics.com/docs/good-to-know-about-instagram-insights).

### M7. CHALLENGE to DATA-INTEGRITY D2: the day boundary differs between IG and FB, so one fix cannot serve both. **P1, LIKELY.**
D2 prescribes a single remedy: read the account timezone and convert `end_time`. That is right for
**Facebook Page** insights, whose day boundary follows the Page's own configured timezone
(`timezone` / `timezone_id` on the Page node). It appears to be **wrong for Instagram**, where the
Insights API day boundary is reported to be fixed Pacific time regardless of the account's
setting. If PulseBoard applies the account-timezone conversion uniformly, IG rows for non-PT
creators become *newly* wrong by (account offset − PT) instead of correct.
**Fix:** determine the boundary per platform, empirically, before changing `seriesFromInsight`;
store `reporting_timezone` on `metrics_daily` (or on `social_accounts`) so the two platforms can
disagree and the UI can say which basis a chart uses. Do not ship D2's fix as written for IG.

### M8. IG `follower_count` window constraints. **P2, LIKELY.**
`_sync.ts:87` requests `follower_count&period=day&since=..&until=addDays(today,1)`.
`follower_count` supports only the **last 30 days and excludes the current day**, and Meta rejects
insight ranges longer than 30 days. `backfillStart` (`:279`) starts at `today-29` and `until` is
`today+1` → a **31-day span** on the first sync of every account. If that trips the range check,
the call errors → caught → `deltaByDate = {}` → `reconstructFollowers` (`:298`) returns the
*current* total for all 30 days → a perfectly flat, entirely fictional followers curve on day one.
**Fix:** `since = today-30`, `until = today` (exclusive), and clamp the span to 30 days.

### M9. FB `page_impressions` and `page_fans` — BOTH REMOVED 15 Nov 2025. **P0, CONFIRMED.**
`_sync.ts:164` requests `page_impressions,page_post_engagements,page_fans` in one call. Two of the
three are gone; per M1 the third dies with them.
**Replacements:** `page_impressions` → **`page_media_view`** (profile-level "Media views");
`page_fans` → **`page_follows`**. Verify `page_post_engagements` is still live — it is not named in
the Nov-2025 removal list I could reach, but it was in earlier removal rounds for some Page types.
Note also that `views` ≠ `impressions` semantically (views count media consumption incl. replays;
impressions counted feed appearances), so **backfilled history will not be comparable to new
rows** — a step change in the chart on the migration date that must be labelled, not hidden.
Sources: [Meta for Developers blog, 15 Aug 2025](https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/) (must be read directly — I could not fetch it),
[Sprout Social](https://support.sproutsocial.com/hc/en-us/articles/39899335524493-Facebook-Metric-Deprecation-November-2025),
[Yext](https://www.yext.com/blog/facebook-is-deprecating-metrics-what-to-know).

### M10. FB `post_impressions` — REMOVED; and it is written into BOTH `views` and `reach`. **P0, CONFIRMED.**
`_sync.ts:169` requests `insights.metric(post_impressions)`; `:176` and `:181` assign the same
number to `views` and to `reach`. Impressions are neither views nor reach. Even once the metric is
migrated, the Content page will report identical views and reach for every Facebook post, which is
obviously wrong to any client who opens Meta Business Suite alongside.
**Replacement:** `post_media_view` for views; there is no post-level reach in this field set —
either request the surviving unique/reach metric explicitly or leave `reach` NULL rather than
duplicating. `LAUNCH-AUDIT.md` flags the IG reach→views conflation but not this one.

### M11. FB audience: every metric in `audienceFacebook` is dead or restricted for newly connected Pages. **P0, LIKELY.**
`_sync.ts:207` requests `page_fans_gender_age,page_fans_country,page_fans_online&period=lifetime`.
- `page_fans_online` was removed in the Sep-2024 Page Insights round.
- `page_fans_gender_age` / `page_fans_country`: Meta **removed age/gender/country audience data for
  Pages connected after 14 Mar 2024**. Every creator connecting to PulseBoard today is "connected
  after" that date.
- `page_fans_*` as a family is additionally implicated in the Nov-2025 "page fans" deprecation.
Result: the call errors, is caught at `:70`, and **Facebook Audience is silently and permanently
empty** — while the README advertises "Audience (age/gender/country + weekday×hour best-time
heatmap) syncs from IG `follower_demographics` and FB `page_fans_*`". That claim is not deliverable.
**Fix:** delete the FB audience path, state in the UI that Facebook audience demographics are no
longer available via the API for newly connected Pages, and correct the README.
Sources: [Rival IQ](https://help.rivaliq.com/en/articles/9114638-facebook-insights-metrics-deprecation-march-2024),
[Slidebeast](https://help.slidebeast.com/en/articles/9127856-update-on-deprecated-facebook-metrics-for-facebook-reports).

### M12. `fan_count` on the Page node. **P2, UNVERIFIED.**
`_sync.ts:159` requests `fields=fan_count,followers_count`. With Meta removing "likes" from Pages
and from the Insights API, `fan_count` is likely to follow. `followers_count` is the survivor and is
already the code's first choice (`:187`), but `fan_count` sits in the same `fields` list, and an
invalid field errors the **whole** node request — which would take `followers_count` down with it
and leave `currentFollowers = 0`. **Fix:** request `followers_count` only.

### M13. Graph version pin. **P0, CONFIRMED — extends LAUNCH-AUDIT #1.**
`_sync.ts:3`, `oauth-meta-callback.ts:37`, `oauth-meta.ts:25` pin `v19.0`, expired 21 May 2026.
The earlier audit says move to v25.0. One addition it misses: the **login dialog** URL
(`oauth-meta.ts:25`, `https://www.facebook.com/v19.0/dialog/oauth`) is a *separate* pin on a
*different host* and is easy to miss when bumping `GRAPH`. Both must move, plus the same constant
must be used by any new webhook/deletion endpoints. Put it in `_lib.ts` as
`export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v25.0"`.
---

## §3 — OAuth, tokens, pagination, and which Instagram product this is

### M14. `/me/accounts` is read without pagination — Pages beyond the first page are silently never connected. **P1, CONFIRMED (code).**
`oauth-meta-callback.ts:69-79` requests `/me/accounts` with **no `limit`** and iterates
`pages.data` only; `pages.paging.next` is discarded. The Graph API paginates edges (commonly 25
items by default) and returns a `paging.cursors`/`next`. A creator or agency user who administers
more than one page of Pages connects only the first slice — with **no error and no UI signal**;
`backToApp("connected", ...)` reports success (`:96`).
For the target user (managers of multiple high-value accounts) this is a silent data-loss bug at
the exact moment of onboarding.
**Fix:** `fields=...&limit=100` and loop `paging.next` until absent (cap the loop, e.g. 10 pages),
or use `/me/accounts?fields=...&after=<cursor>`. Report the count connected back to the UI.
Source: [Graph API pagination](https://reintech.io/blog/facebook-graph-api-pagination-techniques).

### M15. The long-lived **user** token is discarded — so refresh AND revocation are impossible with what is stored. **P1, CONFIRMED (code). This invalidates LAUNCH-AUDIT #4's proposed fix.**
`oauth-meta-callback.ts:65` computes `userToken`, uses it for `/me/accounts`, and never persists it.
Only **Page** tokens are stored (`:82`, `:89`). Consequences the earlier audit did not draw out:
- `DELETE /{user-id}/permissions` — the revoke call LAUNCH-AUDIT #4 prescribes — **requires the
  user token**, which no longer exists. As written, that fix cannot be implemented. Either store
  the user token (encrypted) or accept that PulseBoard can never revoke its own grant.
- Re-running `/me/accounts` later to pick up newly created Pages, or to detect Pages the user has
  since lost admin rights on, is impossible without sending the user through OAuth again.
- Refreshing (`fb_exchange_token` on a long-lived token) is impossible.

### M16. Token expiry semantics are recorded wrongly. **P2, CONFIRMED (code) / LIKELY (API).**
`oauth-meta-callback.ts:66` derives `expiresAt` from the **long-lived user token's** `expires_in`
(~60 days) and stores it against **Page** tokens (`:82`, `:89`). A Page token obtained via
`/me/accounts` using a *long-lived* user token is itself long-lived/non-expiring — it does not
die on that date. So `account_secrets.expires_at` is neither the Page token's expiry nor the user
token's (the user token isn't stored). It is a misleading value, and any future refresh logic keyed
on it will fire on the wrong schedule.
What actually kills a Page token: the user changes their password, removes the app, revokes a
permission, Meta invalidates the session, the user loses admin rights on the Page, or Meta expires
it for inactivity. **None of these are detectable from `expires_at`** — they surface only as Graph
error code 190 with a subcode. This refines LAUNCH-AUDIT #3, which frames Meta's failure as a
60-day clock; the real requirement is *event*-driven (webhook + error-code handling), not
timer-driven.
⚠️ VERIFY the non-expiring-Page-token claim against Meta's Access Token docs before relying on it.

### M17. Declined permissions are not detected; the user is told "connected" regardless. **P1, CONFIRMED (code).**
Facebook's login dialog lets the user deselect individual Pages and individual permissions. The
callback never calls `GET /me/permissions`, never checks for `denied` entries, and never uses
`auth_type=rerequest` to ask again. A user who declines `instagram_manage_insights` (or simply
does not tick the Instagram box) still lands on a green "Instagram connected" toast
(`Connections.tsx:27-31`), and then every insights call fails forever, is swallowed by
`.catch()`, and is stored as zeros (M1).
**Fix:** after the token exchange, `GET /me/permissions`; if any required scope is missing, do not
save the account — redirect back with `auth_type=rerequest` and an explicit explanation.

### M18. Every Page the user administers is connected, with no chooser. **P1, CONFIRMED (code).**
`oauth-meta-callback.ts:79-93` loops all returned Pages and calls `saveAccount` for each — plus
each linked IG account. There is no selection UI. A user who administers 12 Pages (including
dormant or client-owned ones) has all 12 tokens stored and all 12 synced daily forever. This is:
(a) a data-minimisation failure that the Data Protection Assessment will ask about;
(b) a rate-limit multiplier (§4) — and the dormant Pages are exactly the ones with near-zero
    Business-Use-Case budget, so they are the ones that will start returning throttle errors;
(c) combined with `sync.ts:132` / `sync-cron.ts:167` classifying *any* error message matching
    `/token|expired|oauth|session/i` as "expired", those throttle errors can mark healthy Pages as
    needing reconnection, producing exactly the repeated-OAuth-churn signal that draws Meta's
    attention.
**Fix:** show the returned Pages and let the user pick; store tokens only for the chosen ones.

### M19. The IG account row stores a **duplicate copy of the Page token**. **P2, CONFIRMED (code).**
`oauth-meta-callback.ts:89` writes `page.access_token` into a second `account_secrets` row for the
Instagram account. One credential, two plaintext copies, two rows to find and delete on
revocation — and deleting one leaves the other live. Store a reference to the Page's secret row
instead (`extra.page_id` is already there at `:89`).

### M20. Which Instagram product this is, and whether it survives. **INFORMATIONAL / P2, LIKELY.**
This code is **"Instagram API with Facebook Login"**: Facebook Login → `/me/accounts` →
`instagram_business_account.id` → `graph.facebook.com/{ig-user-id}/...` with a **Page** token, and
the `instagram_basic` / `instagram_manage_insights` scope family. That path **is still supported in
2026** and remains the recommended route for apps managing multiple accounts through Pages.
It is *not* "Instagram API with Instagram Login", which uses `graph.instagram.com`, Business Login,
and the `instagram_business_*` scopes (the old `business_basic` etc. were retired 27 Jan 2025).
So the earlier audits' implicit assumption is correct — but note two consequences:
- Every connected IG account **must** be a Professional account linked to a Facebook Page. The code
  never checks and never explains; a Creator account not linked to a Page simply produces
  `no_pages_found` (`:74`) or a Page with no `instagram_business_account`, and the user sees
  "Facebook connected" with no Instagram and no reason given.
- The permission set for this product is `instagram_basic` + `instagram_manage_insights` +
  `pages_show_list` + `pages_read_engagement` (+ `read_insights` for Page insights). That is what
  should be submitted. `business_management` is not part of it.
Sources: [Meta — IG API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/),
[keyapi.ai](https://www.keyapi.ai/blog/what-is-the-instagram-api/).

### M21. Content is capped at 25 items with no paging and no date window. **P2, CONFIRMED (code).**
`_sync.ts:93` (`limit=25`) and `:169` (`limit=25`) fetch only the 25 most recent items and ignore
`paging`. `src/lib/api.ts` then selects "the top 200 posts". So on first connect the Content page
covers only the last 25 posts regardless of the advertised 30-day backfill, and a prolific creator
posting >25 items between daily syncs permanently loses the ones in between.
**Fix:** page through `/media` and `/posts` with `since`/`until` matching the backfill window
(IG `/media` supports `since`/`until` on `timestamp`), with a hard cap.

---

## §4 — Rate limits: which apply, and the exact number of accounts at which this breaks

**Three independent limiters apply to these calls:**

| Limiter | Formula | Applies to | Header |
|---|---|---|---|
| Platform / app-level | **200 × (app daily active users)** calls per rolling hour, app-wide | every call in this codebase | `X-App-Usage` → `{call_count, total_time, total_cputime}` as % of limit |
| BUC — Pages | **4800 × (Page engaged users in prior 24h)** calls per 24h, per app+Page pair | F1–F4, O5 | `X-Business-Use-Case-Usage` → per business-id, incl. `estimated_time_to_regain_access` |
| BUC — Instagram | **4800 × (impressions on that IG account's content in prior 24h)** calls per 24h, per app+IG-user pair | I1–I7 | `X-Business-Use-Case-Usage` |

**Nothing in this repo reads either header.** `getJson` (`_sync.ts:312-317`) does not check
`res.ok`, does not read response headers at all, has no retry and no backoff — confirming
LAUNCH-AUDIT #9 and adding that the headers are *available on every response* and would cost
nothing to record.

**Call budget consumed by this code (from §1):**
- Facebook Page: **4** calls/sync · Instagram account: **9** calls/sync
- Typical creator (1 Page + 1 linked IG): **13** calls/sync
- Plus **3** calls at connect time (O3, O4, O5).

**Where it breaks — computed:**

1. **Netlify function timeout, not Meta, is the first wall.** `sync-cron.ts:161-171` loops every
   account in the system **serially** in one invocation. At a conservative 400 ms per Graph call,
   one creator = 13 × 0.4 s ≈ **5.2 s**. A scheduled Netlify function is subject to the standard
   function execution cap (10 s default, 26 s max for synchronous functions; background functions
   get 15 min). **At the 26 s cap the cron dies after ~5 creators.** Even as a background
   function (15 min) it caps at **~170 creators**, after which later accounts silently never sync —
   compounding the PostgREST 1000-row cap the earlier audit noted. ⚠️ Netlify's exact scheduled-
   function limit must be confirmed. **P1.**

2. **App-level (Platform) limit — the cron is the risk, because it runs when nobody is active.**
   Budget = 200 × DAU per hour. The cron fires at 06:00 UTC (`sync-cron.ts:176`) and spends
   13 × U calls in that single hour, where U = connected creators. The inequality that must hold is
   **13·U ≤ 200·DAU**, i.e. **U/DAU ≤ 15.4**.
   A weekly-check-in analytics dashboard typically runs DAU/MAU of 5–15%. At 10% (U/DAU = 10) there
   is headroom; **at 6.5% (U/DAU ≈ 15.4) the daily cron alone saturates the entire app's hourly
   budget**, and on a quiet Sunday — the realistic worst case — it exceeds it outright and every
   user's sync starts failing, including users who *are* active. There is no fixed account count:
   **the limit is a ratio, and it is breached by inactivity, not by growth.** This is exactly the
   "one user's behaviour harms every other connected account" mechanism, and the fix is to spread
   the cron across the hour/day (hash account id into a slot) and to check `X-App-Usage.call_count`
   before each account, pausing at 75%. **P1.**

3. **On-demand `/api/sync` is unthrottled and app-wide-destructive.** `sync.ts` has no minimum
   interval and no per-user cap. One scripted caller issuing a sync every 5 s spends
   13 × 720 = **9,360 calls/hour**. With 50 DAU the whole app's budget is 10,000/hour — **a single
   user exhausts the entire app in ~64 minutes and locks out every connected creator**. Enforce a
   server-side minimum interval against `social_accounts.last_synced_at` (15 min) before doing any
   work. **P1.**

4. **BUC bites the small Pages, not the big ones.** The target users are high-engagement creators,
   whose BUC budget (4800 × engaged users) is enormous — a Page with 1,000 engaged users/day gets
   4.8 M calls. But M18 means PulseBoard also connects every *dormant* Page the user administers,
   and a Page with ~0 engaged users has a near-zero budget. Those Pages will throttle (Graph codes
   4/17/32/613, or `X-Business-Use-Case-Usage` at 100%), the error will be swallowed or
   mis-classified as "expired" (M18c), and the user will be told to reconnect a healthy account.
   **P2.**

5. **Retry pressure.** With no backoff and a daily cron, a throttled account is retried at the same
   time every day indefinitely, and any user-triggered sync retries immediately. Meta's throttle
   responses carry `estimated_time_to_regain_access`; honour it. **P1.**

**Minimum instrumentation to add:** log `X-App-Usage`, `X-Business-Use-Case-Usage` and
`x-fb-trace-id` for every call into `sync_log`; abort the run at 75% of any bucket; exponential
backoff with jitter on HTTP 429 and Graph codes 4, 17, 32, 613, 80001-80004.
Sources: [Meta rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/),
[bundle.social — the three FB limit systems](https://bundle.social/blog/facebook-api-rate-limits),
[Phyllo — IG rate limits 2026](https://www.getphyllo.com/post/instagram-api-rate-limits-explained----and-how-to-scale-beyond-them-2026).
---

## §5 — App Review and access: what is required, and what in this repo fails as written

To read **other people's** Pages and IG accounts, this app needs **Advanced Access** to
`pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`,
`instagram_manage_insights`. Standard Access only covers accounts with a role on the app itself —
which is why the Connections banner (`Connections.tsx:64`) is correct that nothing works until
approval. Gating items:

| Requirement | Status in this repo |
|---|---|
| Business Verification of the owning Business portfolio | Not addressed anywhere; must precede the Advanced Access submission |
| Privacy Policy URL (live, reachable, names deletion path) | **Missing** — no `/privacy` route (`src/pages/`) |
| Terms of Service URL | **Missing** |
| Data Deletion Callback URL **or** Data Deletion Instructions URL | **Missing** — neither route nor function exists |
| Deauthorize Callback URL | **Missing** (see M23) |
| Working test credentials for the reviewer | README §1.4 recommends turning **off** email confirmation to smooth the demo — do not ship that setting; create a dedicated reviewer account instead |
| Screencast showing each permission in use, end to end | Cannot be produced today: with v19.0 expired and the metrics removed, the reviewer would record a dashboard of zeros |
| Written justification **per permission** | `business_management` is requested (`oauth-meta.ts:22`) and **used nowhere** — an unjustifiable permission is a standard rejection, and it drags in extra verification |
| Data Use Checkup (annual) | Not addressed |
| Data Protection Assessment (required because Platform Data is stored server-side) | Would fail on at least four counts, below |
| Tech Provider designation (apps accessing other businesses' assets on their behalf) | Not addressed. ⚠️ VERIFY whether this app falls in scope |

### M22. The Data Protection Assessment would fail on the specific things it asks about. **P1, LIKELY.**
The DPA questionnaire covers prohibited data uses, deletion, sharing with third parties, and data
security. Against this codebase:
- **Encryption of Platform Data at rest beyond disk-level** — absent (`schema.sql:53`, plaintext
  `text` column). The README's "Tokens are encrypted at rest by Supabase" is a disk-encryption
  claim being used to answer an application-encryption question; answering the DPA that way is a
  misrepresentation risk, not just a technical gap.
- **Access control and logging** — no audit log of which token was used when, by which code path.
  The service-role key grants unrestricted read of every creator's tokens and metrics.
- **Deletion on request / on disconnect** — none (LAUNCH-AUDIT #4). `Connections.tsx:51` flips a
  status column client-side and stops there.
- **Third parties receiving Platform Data** — Supabase, Netlify **and Anthropic** (`ai.ts:53`).
  None are disclosed anywhere in the repo. See M25.
- **Data minimisation** — M18 (every Page connected) and the 30-day-then-forever retention of
  `metrics_daily`/`content` with no stated window.
Sources: [Meta DPA overview](https://developers.meta.com/horizon/resources/publish-data-protection-assessment/),
[Advanced Access guide](https://singhamandeep.com/what-is-meta-advanced-access/).

---

## §6 — Platform Terms / Developer Policy obligations not implemented

### M23. No Deauthorize Callback and no permission-revocation handling. **P0 for review, P1 for safety. CONFIRMED (absent from repo).**
Two distinct Meta callbacks are required/expected and neither exists in `netlify/functions/`:
- **Deauthorize Callback URL** — Meta POSTs a `signed_request` when a user removes the app from
  their Facebook settings. Without it, PulseBoard keeps a stored Page token, keeps calling with it
  daily, and keeps showing the account as "Connected". Repeatedly calling with a token the user has
  revoked is precisely the pattern that triggers app-level enforcement.
- **Data Deletion Callback URL** (or Instructions URL) — App Review will not complete without one.
  It must verify the `signed_request` HMAC with the app secret, actually delete, and return
  **JSON** `{ url, confirmation_code }`. Returning HTML fails review.
Additionally there is no subscription to the **`permissions` webhook field** on the `user` object,
which is what tells you a user revoked `instagram_manage_insights` specifically rather than the
whole app.
**Fix:** `netlify/functions/meta-deauthorize.ts` and `netlify/functions/meta-data-deletion.ts`,
both verifying `signed_request` (base64url `sig` = HMAC-SHA256 of the payload with the app secret,
`algorithm` must be `HMAC-SHA256`), both performing the full delete-token-and-data path, plus a
`/deletion-status/:code` page for the returned `url`. Subscribe the app to `user`→`permissions`
and, if you add Page webhooks later, request `pages_manage_metadata`.
Source: [Data deletion callback requirements](https://singhamandeep.com/facebook-data-deletion-callback-url/).

### M24. Error classification must be by numeric code, and the current regex will cause OAuth churn. **P1, CONFIRMED (code).**
`sync.ts:132` and `sync-cron.ts:167` mark an account `expired` when the *message text* matches
`/token|expired|oauth|session/i`. Meta's error messages for deprecated metrics, throttling and
permission problems routinely contain those words. Wrong classification → the UI prompts a
reconnect → the user re-runs OAuth on a healthy account → repeated authorisation churn across many
creator accounts.
**Correct classification (verify each against the Graph error reference):**
| Meaning | Codes |
|---|---|
| Token invalid / user revoked / password change | `190` (+ subcodes `458` app removed, `459` checkpoint, `460` password change, `463` expired, `464` unconfirmed user, `467` invalid) → mark `expired`, delete the secret, stop syncing |
| Permission missing | `10`, `200`-`299` → prompt re-consent for the specific scope, do **not** mark expired |
| Throttling | `4` (app), `17` (user), `32` (page), `613`, `80001`-`80004` (BUC) → back off, do **not** mark expired |
| Invalid metric / field (deprecation) | `100` with `error_subcode` / `error_user_title` → alert the operator, do **not** touch the user's account |
| Transient | `1`, `2` → retry with jitter |
Log `x-fb-trace-id` on every failure — Meta support will ask for it.

### M25. Onward transfer to Anthropic is real and undisclosed. **P1, CONFIRMED (code).**
`ai.ts:31` accepts an 8 KB `summary` and `:53` sends it to the Anthropic API. `src/lib/snapshot.ts`
and `src/lib/analytics.ts` build that summary from Platform Data: per-platform followers/reach/
views/engagements, engagement rate, best-posting windows derived from IG `online_followers`, and
top-post titles (which are **Instagram captions** — user-authored Platform Content) with
permalinks. So the claim in the README that "no raw rows... leave the browser" is true for rows but
not for content: captions and permalinks do leave.
Under Meta's Data Terms, a downstream processor is a **Service Provider** that must be contractually
bound, disclosed, and limited to processing on your behalf. Obligations not met here:
- Anthropic is named in **no** privacy policy (there isn't one).
- No DPA/sub-processor list, no contractual flow-down.
- ⚠️ **VERIFY against Meta Platform Terms §3 (prohibited practices):** I believe the Terms restrict
  using Platform Data to train or fine-tune ML/AI models. Anthropic's commercial API does not train
  on API inputs by default, which is the mitigating fact — but that has to be *stated*, not assumed.
**Fix:** disclose Supabase, Netlify and Anthropic as sub-processors in a real privacy policy; add
a per-user opt-out for the Assistant; strip captions/permalinks from the AI payload if you want the
"numbers only" claim to be literally true; confirm no-training in writing.
Source: [Meta Data Terms](https://www.facebook.com/legal/terms/data-terms).

### M26. Public share links publish Platform Data to an unauthenticated, permanent, indexable URL. **P1, CONFIRMED (code).**
`share.ts:18-29` serves `/api/share?slug=` with **no authentication**, `schema.sql:147` has no
`expires_at`, and `netlify.toml` sets no `X-Robots-Tag`. The payload includes derived audience
activity windows and post-level Platform Data. LAUNCH-AUDIT #10 frames this as a security gap; the
platform-policy framing is sharper: making Platform Data publicly available without the ability to
revoke it is a Platform Terms exposure as well as a client-confidentiality one — a creator's
sponsor-facing numbers stay live at a guessable-length URL forever, including after the creator
disconnects and after their Meta grant is revoked.
**Fix:** `expires_at` default 30 days enforced in the GET; delete all `report_shares` for an
account when it is disconnected or its data is deleted; `X-Robots-Tag: noindex, nofollow` on
`/r/*` and on `/api/share`; a revoke UI; a per-user creation cap.

### M27. No retention policy for Platform Data. **P2, CONFIRMED (absent).**
`metrics_daily`, `content` and `audience_snapshots` grow forever with no purge and no documented
window; nothing deletes on disconnect (LAUNCH-AUDIT #4). Meta's terms require deleting Platform
Data when it is no longer needed for the disclosed purpose, on user request, and on loss of access.
**Fix:** a stated window (e.g. 25 months, matching a plausible year-on-year reporting need), a
nightly purge job, and cascade deletion on disconnect/deauthorize/deletion-callback.

---

## §7 — Other things in this domain that could harm a connected account

### M28. `business_management` makes a leaked token catastrophic instead of merely bad. **P1, CONFIRMED (code).**
LAUNCH-AUDIT #11 treats `business_management` (`oauth-meta.ts:22`) as a review-speed problem. The
sharper point: every other scope requested here is **read-only**, so a leaked Page token can read
insights but cannot post, delete or reconfigure. `business_management` is not read-only — it is
broad Business-portfolio access. Combined with M15 (no revocation possible), M19 (two plaintext
copies of every credential), and no `appsecret_proof` (LAUNCH-AUDIT #7, so a stolen token is
replayable from anywhere), a database leak becomes a business-asset compromise across every
connected creator rather than an analytics-data leak. **Remove `business_management` before a
single real account connects** — this is the cheapest large risk reduction available.

### M29. Any Page admin can connect a client's Page to their own PulseBoard account. **P2, CONFIRMED (code).**
`saveAccount` keys on `(user_id, platform, external_id)`. Nothing checks that the connecting user
is the account's owner rather than one of its admins/editors. An agency staffer or a former
collaborator who still holds a Page role can connect the creator's Page and IG to their own
PulseBoard account, sync it daily, export CSV, and mint a permanent public share link (M26) — with
no notification to the creator and no way for the creator to see it. Meta considers a Page admin
legitimate, so this is not a platform violation; it is a product risk that matters precisely
because the users are high-value creators with staff.
**Fix:** show the creator a list of every PulseBoard connection to their assets; notify on connect;
and treat share-link creation as an action requiring the owning account to still be connected.

### M30. Provider error text is reflected into a redirect URL — including Graph error detail. **P3, CONFIRMED (code).**
`oauth-meta-callback.ts:42` and `:98` put `q.error_description` / `e.message` into the query string
via `backToApp` (`_lib.ts:253`), which `Connections.tsx:32` renders in a toast. Graph error
messages can contain identifiers and internal detail. Return opaque codes; log detail server-side.

### M31. `getJson` never checks `res.ok` and parses the body blind. **P2, CONFIRMED (code).**
`_sync.ts:312-317`. A 5xx HTML error page or an empty body from Meta throws a JSON parse error
whose message is *not* a Graph error, then hits the regex at `sync.ts:132`. Check `res.ok`, read
the rate-limit headers, and only then parse.

### M32. `page_engaged_users` is worth fetching for its own sake. **P3.**
The Pages BUC budget is `4800 × page_engaged_users`. Fetching that metric (if it survives the
Nov-2025 round — verify) lets the sync compute its own remaining budget per Page rather than
discovering the ceiling by hitting it.

### M33. The README overstates what the product can deliver, in ways a client will check. **P2, CONFIRMED.**
Three claims in `README.md` are not deliverable against the 2026 API and should be corrected before
a creator reads them: (a) "**No mock data**" — falsified by M1's fabricated zeros; (b) Audience
"syncs from IG `follower_demographics` and FB `page_fans_*`" — the FB half is dead (M11); (c)
"Tokens are encrypted at rest by Supabase" — disk-level only (M22).

---

## Verification burden — what a human must check against official docs before acting

Ordered by consequence. Every item below is sourced only from secondary documentation.

1. **M6** — the timezone basis of IG `online_followers` hour keys and of `end_time` day boundaries
   (fixed Pacific vs account-local). This decides whether DATA-INTEGRITY D2/D3's prescribed fix is
   correct or actively harmful. Test empirically against one real account.
2. **M9 / M10 / M11** — the exact surviving Page Insights metric names in v25.0
   (`page_media_view`, `post_media_view`, `page_follows`, and whether `page_post_engagements`,
   `page_fans_gender_age`, `page_fans_country`, `fan_count` still resolve). Read the
   [Meta Page Insights API Updates blog post](https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/)
   and the `/insights` reference directly.
3. **M2 / M3** — whether IG account-level `views` and `total_interactions` return `values[]` or
   only `total_value`, i.e. whether a daily series exists at all.
4. **M5** — `metric_type=total_value` and the legal `breakdown` combinations for
   `follower_demographics`.
5. **M16** — Page access token expiry semantics when derived from a long-lived user token.
6. **M8** — the maximum `since`/`until` span for IG insights and the current-day exclusion.
7. **M25** — Meta Platform Terms §3 on ML/AI training with Platform Data.
8. **§4** — Netlify's scheduled-function execution limit (affects the ~5-creator cron ceiling).
