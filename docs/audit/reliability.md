# PulseBoard — Reliability, Scalability & Operability audit (pass 3)

Branch `claude/analysis-35bck4`, audited 2026-08-23. Companion to `docs/LAUNCH-AUDIT.md`
(can it run / is it safe) and `docs/DATA-INTEGRITY.md` (are the numbers right). This pass asks
the third question: **when it runs at agency scale, does it keep running, and would anyone know
if it stopped?**

Answer: no, and no. The daily cron is a single serial invocation with no pagination, no timeout,
no retry, no concurrency control, no idempotency guard beyond the upsert key, and no alerting.
Combined with `DATA-INTEGRITY.md` D1 (each day is written exactly once, on the day itself, and
never revisited), **any interruption of the cron is a permanent, unrecoverable hole in every
affected tenant's history** — not a delay. That coupling is the central finding of this document.

Severity: **P0** blocks onboarding agency clients · **P1** must exist before the first large
tenant · **P2** before scale · **P3** hardening.
Confidence: **CONFIRMED** (proved from code/docs) · **LIKELY** (strong inference) · **UNVERIFIED**.

---

## 0. Corrections to the earlier passes

Recorded first so nothing downstream is built on them.

**C1. `LAUNCH-AUDIT.md` P3 "Model pin — `ai.ts:13` uses `claude-opus-4-8`; current default is `claude-opus-5`" is wrong as stated.**
`claude-opus-4-8` is a current, valid, supported model id (1M context, $5/MTok in, $25/MTok out) — identical list price to `claude-opus-5`. Nothing is broken and nothing costs more. Downgrade to P3-cosmetic. The *real* defect at `netlify/functions/ai.ts:13,174` is different and is scored below as **R-AI-1** (`thinking: {type:"disabled"}` on an Opus-4.8-class model plus a non-streaming 900-token call behind a 10-second Netlify timeout).

**C2. `DATA-INTEGRITY.md` D1 does NOT imply "a missed cron day is a permanently missing day" for Meta accounts.** The brief asked me to confirm that; I cannot, and the distinction matters operationally.
`backfillStart()` (`_sync.ts:279-286`) sets `start = latest + 1 day`, floored at `today − 29`. So if the cron misses day D, the next successful run computes `start = D` and `enumerateDays(D, today)` re-fetches D — and re-fetches it as a **complete** day, which is strictly *more* accurate than the 6-hour value D1 describes. A single missed Meta day is self-healing.
The claim is true only in four specific, confirmed cases, and those are the ones to alarm on:
1. **TikTok, always.** `syncTiktok()` ignores `start` entirely and returns exactly one row, `date: today()` (`_sync.ts:259`). There is no gap fill on any code path. **Every missed cron day is a permanent, unrecoverable hole in every TikTok account's history.**
2. **Any outage longer than 29 days**, because `backfillStart` clamps `start` to `today − 29` (`_sync.ts:281,283`). Days older than that are never requested again by any code path, ever.
3. **IG `follower_count` / `online_followers`**, which Meta only serves for a trailing ~30 days, so the reconstructed follower curve and the whole best-time heatmap are unrecoverable beyond that window even if the reach numbers are not.
4. **The zeroing path in R-CRON-4 below**, which is worse than a hole: it writes fabricated zeros *over* the gap and then advances `latest`, so the gap is marked filled and never revisited.

So the accurate statement for the runbook is: *a Meta gap self-heals if fixed within 29 days; a TikTok gap never self-heals; and a partially-failed sync poisons the gap permanently.*

**C3. `LAUNCH-AUDIT.md` #9's parenthetical "the query is capped at PostgREST's default 1000 rows, so past that, accounts silently stop syncing" is correct but describes the *second* wall, not the first.** The 30-second scheduled-function timeout bites at roughly **8 accounts**, not 1000 — 125× earlier. See R-CRON-2.

---

## 1. THE CRON PATH

### 1.0 Measured cost of one `syncAccount()` — the arithmetic everything else uses

Counted directly from `netlify/functions/_sync.ts`.

| Platform | Outbound HTTP calls | Sequential round-trips | Supabase round-trips | Call sites |
|---|---|---|---|---|
| Instagram | **9** | **7** (the 3 demographics calls run in `Promise.all`) | 6 | `:77` profile · `:82` reach+impressions · `:85` total_interactions · `:87` follower_count · `:93` media · `:141`×3 follower_demographics · `:145` online_followers |
| Facebook | **4** | **4** | 6 | `:159` profile · `:164` page insights · `:169` feed · `:207` audience |
| TikTok | **2** | **2** | 5 | `:232` user info · `:236` video list |

Supabase round-trips: `:31` select secret · `:36` select latest date · `:48` upsert metrics · `:54` upsert content · `:65` upsert audience (IG/FB only) · `:72` update `last_synced_at`.

Latency model (Graph insights over a 30-day `since/until` window; the IG `media` call carries nested `insights.metric(...)` for 25 items and is the slowest):

| Call class | p50 | p95 |
|---|---|---|
| Graph profile / TikTok user info | 350 ms | 900 ms |
| Graph insights window | 500 ms | 1,400 ms |
| IG media + nested insights / FB feed | 1,200 ms | 3,500 ms |
| Supabase round-trip (Netlify → Supabase, cross-region) | 60 ms | 180 ms |

**Wall time per account** = sum of sequential round-trips:

- Instagram p50 = 350 + 500 + 500 + 500 + 1200 + 600 + 500 = 4,150 ms + 6×60 = **≈ 4.5 s** (p95 ≈ **11 s**)
- Facebook p50 = 350 + 600 + 900 + 600 = 2,450 ms + 6×60 = **≈ 2.8 s** (p95 ≈ **7 s**)
- TikTok p50 = 400 + 700 = 1,100 ms + 5×60 = **≈ 1.4 s** (p95 ≈ **3.5 s**)

One Meta OAuth connection creates **two** account rows — a Facebook Page and its linked IG Business account share the same Page token (`oauth-meta-callback.ts:285-298`). So **one connected Page costs ≈ 7.3 s p50 / ≈ 18 s p95** of cron time.

---

### R-CRON-1 · The cron is a single serial invocation with no fan-out, no concurrency, no queue. **P0, CONFIRMED.**

`netlify/functions/sync-cron.ts:20-30` — one `for` loop, `await syncAccount()` per iteration, one invocation, one process. Total runtime is the *sum* of every tenant's sync. There is no work queue, no per-account invocation, no `Promise.all` with a concurrency cap, no partitioning by hash or hour. Throughput is fixed at ~0.22 accounts/second regardless of how many accounts exist.

**Fix.** Split into a dispatcher and a worker. The scheduled function becomes a cheap enumerator that pages through `social_accounts` (see R-CRON-3) and, for each account, either (a) inserts a row into a `sync_queue` table that a separate background function drains, or (b) fire-and-forgets a `POST /.netlify/functions/sync-account-background` (background functions get 15 minutes and run per-invocation, so 10,000 accounts become 10,000 independent 4-second jobs instead of one 12-hour job). Spread by hashing `account_id` into one of 60 minute-slots so the whole estate is not hitting Meta at 06:00:00.

---

### R-CRON-2 · Netlify kills the scheduled invocation at 30 seconds. The platform stops syncing at ~6-10 accounts. **P0, CONFIRMED.**

Netlify scheduled functions have a **30-second execution limit** ([Netlify docs](https://docs.netlify.com/build/functions/scheduled-functions/)). This is *not* the same as the synchronous function limit (10 s default, 26 s on request for Pro — [Netlify support](https://answers.netlify.com/t/increasing-timeout-from-10-seconds-to-26-seconds/163253)) and *not* the background-function limit (15 minutes — [Netlify docs](https://docs.netlify.com/build/functions/background-functions/)). Scheduled and background are separate features: a function cannot be both `schedule()`d and `-background` (LIKELY — reported consistently across Netlify's forums, and the docs steer long scheduled work to "call a background function from a scheduled one").

Usable budget = 30 s − cold start (~0.4 s) − the initial `select` (~0.15 s) ≈ **29.4 s**.

| Estate composition | Seconds/account (p50) | **Accounts synced before the kill (p50)** | p95 |
|---|---|---|---|
| All Instagram | 4.5 | **6** | 2 |
| All Facebook | 2.8 | **10** | 4 |
| All TikTok | 1.4 | **21** | 8 |
| Realistic agency mix (1 FB + 1 IG per Page) | 7.3 / Page | **4 Pages (8 accounts)** | 1 Page |

**Concretely: the 5th agency Page onboarded is the one that stops the platform syncing.** Not the 1000th. The PostgREST row cap in `LAUNCH-AUDIT.md` #9 is a real wall but it sits 125× further out and will never be reached, because the timeout kills the run first.

This also means the current cron *has almost certainly never completed a full pass* on any estate larger than a demo. Because the handler returns `200` regardless (see R-CRON-6), no one would know.

**Fix.** As R-CRON-1. There is no way to make a 30-second serial loop cover a real tenant base; this must be a fan-out, not a tuning exercise.

---

### R-CRON-3 · The account query has no `.limit()`, no `.range()`, no `.order()` — and is silently capped at 1000 rows in a non-deterministic order. **P1, CONFIRMED.**

`sync-cron.ts:12-15`:
```ts
const { data: accounts, error } = await db
  .from("social_accounts")
  .select("id,platform,external_id,username")
  .eq("status", "connected");
```
Two independent defects:

1. **The 1000-row cap.** Supabase sets PostgREST's `db-max-rows` to **1000** by default. PostgREST returns HTTP 200 with a `Content-Range` header and no error — `error` is `null`, `accounts.length` is 1000. Past 1000 connected accounts, every account beyond the cap **never syncs and nothing reports it**. `sync.ts:15-19` has the identical shape for the per-user path (an agency running many hundreds of Pages under one login hits the same cap).
2. **No `ORDER BY`.** Row order from Postgres without `ORDER BY` is unspecified and, in practice, heap order. Every successful sync `UPDATE`s `last_synced_at` on the row (`_sync.ts:72`), which churns heap position (a non-HOT update relocates the tuple). So **which** tenants land inside the 1000-row window, and which land inside the ~8 accounts the timeout allows, varies between runs in a way nobody can predict or reproduce. The accidental effect is a crude rotation — different tenants get starved on different days — which is arguably worse than a stable cut, because the resulting data holes are scattered rather than contiguous and no tenant is ever consistently "the broken one".

**Fix.** Explicit keyset pagination: `.order("id").gt("id", cursor).limit(500)` in a loop, with the cursor carried across invocations. Add `.order()` to every unbounded query in the codebase on principle. Also set an explicit `Prefer: count=exact` and assert `count === rows.length` so a silent truncation becomes a loud one.

---

### R-CRON-4 · A single transient upstream failure writes fabricated zeros over real data, then marks the gap as filled. **P0, CONFIRMED. This is the most destructive finding in this document.**

Every Meta insights call in the sync is wrapped in `.catch(() => ({ data: [] }))`:
`_sync.ts:82, 85, 87, 93` (Instagram) and `:164, :169` (Facebook).

Follow the Instagram path when the reach/impressions call at `:82` fails for *any* reason — a 429, a 500, a Cloudflare HTML error page, a metric-deprecation error (`LAUNCH-AUDIT.md` #2 says these are firing today), a dropped connection:

1. `daily` becomes `{ data: [] }` → `reachByDate = {}`, `imprByDate = {}` (`:83-84`).
2. `days` is still built for **every date in the window** (`:113-120`) as `reach: reachByDate[date] ?? 0` → all zeros.
3. `:48` upserts those rows with `onConflict: "account_id,date"` — **overwriting whatever real values were already stored for those dates**.
4. `:72` still updates `last_synced_at`, so the account looks healthy.
5. Next run, `backfillStart()` reads `latest = today` and returns `start = today`. **The zeroed window is now considered complete and is never re-fetched.**

On a first sync or after a gap the window is up to 30 days, so **one 429 at 06:00 permanently writes 30 days of zeros into a client's dashboard**, and per `DATA-INTEGRITY.md` D1 those rows are never revisited. The client sees their reach chart flatline to zero across a month; `src/lib/analytics.ts:51` fires "Reach dropped"; the AI assistant repeats it as fact.

Note the asymmetry that makes this silent: the *profile* calls at `:77` and `:159` are **not** wrapped in `.catch`, so a total outage throws and the account is skipped cleanly. It is precisely the **partial** failure — profile succeeds, insights fail — that destroys data. Partial failures are the common case under rate limiting.

The schema makes the bug unfixable at the read layer: `metrics_daily.reach/impressions/views/engagements` are all `bigint not null default 0` (`supabase/schema.sql:73-77`). **There is no representation for "we do not know".** A platform that stops returning a metric and a platform that returns zero are the same row.

**Fix, in order:**
1. Make the columns nullable and write `null` when the platform returned nothing for that date. Teach the charts to render gaps as gaps.
2. Never upsert a day whose source call failed — carry a per-call `ok` flag and skip those dates entirely.
3. Only advance the effective watermark for dates that were actually written from a successful response.
4. Per `DATA-INTEGRITY.md` D1's own fix, always re-fetch a trailing 7-day window so a poisoned day self-heals.
5. Add a guard rail: if a sync would write a window where >50% of days are zero for an account whose trailing average is non-zero, refuse the write and raise an alert instead.

---

### R-CRON-5 · What the database actually looks like when the invocation is killed mid-loop. **P1, CONFIRMED.**

There is no transaction anywhere. `syncAccount()` performs up to six independent writes; a kill can land between any two. The resulting states:

| Kill lands... | Persisted state | Self-heals? |
|---|---|---|
| Between accounts | Account N complete, N+1..end untouched | Meta: yes, next run's `backfillStart` covers the gap (≤29 days). **TikTok: no — permanent hole (C2).** |
| After `:48` metrics upsert, before `:54` content upsert | Metrics written, content stale by one day | Yes — content is re-fetched whole each run |
| After `:48`, before `:65` audience upsert | No `audience_snapshots` row for that `captured_on` | **No** — `captured_on: today()` (`:66`) is never back-filled, so the best-time heatmap has a permanent one-day hole. Low impact (it aggregates), but it is permanent. |
| After `:48`, before `:72` `last_synced_at` update | Data written, `last_synced_at` stale | Yes, but **the only staleness signal an operator has now lies in the pessimistic direction** — an account looks broken when it isn't. Acceptable. |
| Anywhere, on TikTok | The single `date: today()` row either exists or does not | **No.** Permanent hole (see C2 item 1). |

The load-bearing point: because the kill always lands at the *same relative position* in a deterministic serial loop (~8 accounts in), the same slice of the estate is starved every day — **except** that R-CRON-3's missing `ORDER BY` randomises which slice that is. Either way, no tenant is ever told.

---

### R-CRON-6 · Nothing retries and nothing is alerted. The failure returns HTTP 200. **P0, CONFIRMED.**

- **No retry in code.** `sync-cron.ts:21-29` catches per account and moves on; there is no retry, no backoff, no dead-letter, no second pass. A tenant that fails today is simply not synced today.
- **No retry from the platform.** Netlify does not re-invoke a scheduled function that timed out or errored; the next attempt is the next cron tick, 24 hours later (LIKELY — no retry semantics are documented for scheduled functions).
- **The success path and the total-failure path are indistinguishable.** `sync-cron.ts:31` returns `{ statusCode: 200, body: "Daily sync complete: 0/450" }` when *every single account failed*. A 200 with a human-readable string is not a monitorable signal.
- **Nothing consumes the return value.** A scheduled function's response body goes to the Netlify function log and nowhere else. There is no webhook, no email, no Slack, no metric, no error tracker (`grep -rn "console\.\|Sentry\|logger" netlify/` returns **zero** matches across all 8 functions).
- **The timeout case does not even reach line 31** — the process is killed, so the only artefact is a Netlify log line an operator would have to go looking for.

**Fix.** See §5. Minimum: emit one structured JSON log line per account, `throw` (non-2xx) when `ok < total`, and add a heartbeat row + dead-man's-switch alert so *absence* of a run is itself an alert.

---

## 2. QUERY LIMITS — every unbounded query and the tenant size at which it lies

Supabase caps PostgREST responses at **1000 rows** by default (`db-max-rows`), returning HTTP 200 with a `Content-Range` header. `supabase-js` surfaces `error: null`. **Every truncation in this table is silent.**

| # | Site | Query | Bound | Rows = | Silently truncates at |
|---|---|---|---|---|---|
| Q1 | `netlify/functions/sync-cron.ts:12` | all connected accounts | none | accounts | **1000 connected accounts** (moot — timeout hits at ~8, R-CRON-2) |
| Q2 | `netlify/functions/sync.ts:15` | one user's connected accounts | none | that user's accounts | **1000 accounts under one login** |
| Q3 | `src/lib/api.ts:29` | `metrics_daily` `gte(date, today-range)`, `order(date asc)` | **none** | accounts × days | **see table below — 11 accounts at 90 days** |
| Q4 | `src/lib/api.ts:40` | `content select *`, `order(views desc)` | `.limit(200)` | all-time posts | **200 posts total across the whole tenant** |
| Q5 | `src/lib/api.ts:51` | `audience_snapshots select *`, `order(captured_on desc)` | **none** | accounts × days since connect | **1000 rows**, e.g. 5 accounts × 200 days |
| Q6 | `src/lib/api.ts:19` | `social_accounts select *` | none | accounts | 1000 |
| Q7 | `src/lib/api.ts:64` | `goals select *` | none | goals | 1000 (benign) |
| Q8 | `netlify/functions/oauth-meta-callback.ts:275` | `GET /me/accounts` | **Graph default page = 25**, `paging.next` never followed | Pages on the Business | **26th Facebook Page** |
| Q9 | `_sync.ts:93`, `:169` | IG `/media`, FB `/posts` | `limit=25`, no cursor | newest 25 posts only | any account posting >25 times between syncs |
| Q10 | `_sync.ts:238` | TikTok `/v2/video/list/` | `max_count: 20`, `cursor` never used | newest 20 videos only | any account posting >20 times between syncs |
| Q11 | `netlify/functions/share.ts:231` | share payload insert | **no size cap** | arbitrary | Netlify's ~6 MB request body limit, as a 502 |

### Q3 in detail — the dashboard lies to exactly the customers being onboarded. **P0, CONFIRMED.**

`src/lib/api.ts:29-33` selects `metrics_daily` filtered only by date, ordered `date` **ascending**, with no `.limit()` and no `.range()`. PostgREST applies `LIMIT 1000` *after* the sort, so the rows that get dropped are the **most recent** ones. The chart does not error, does not warn — it just ends early, and "today" is missing.

`Range` is `7 | 30 | 90` (`src/lib/types.ts:69`), rendered as three buttons (`src/components/AppLayout.tsx:112`). `isoDaysAgo(range)` with `gte` is inclusive, so days = range + 1:

| Range | Days | 1000 ÷ days | **Truncates above** |
|---|---|---|---|
| 7 | 8 | 125 | 125 accounts |
| 30 | 31 | 32.2 | **32 accounts** |
| 90 | 91 | 10.9 | **11 accounts** |

A Meta connection creates two account rows per Page (`oauth-meta-callback.ts:285-298`). So **an agency with six Facebook Pages (12 accounts) clicking "90 days" gets a chart that silently stops around day 83 and omits the last week entirely.** That is a mid-size agency, not a large one. Every derived number — `sum()`, `momentum()`, `engagementRate()`, the CSV export, the PDF report, the public share link, and the AI assistant's grounding snapshot — inherits the truncation without knowing.

**Fix.** Filter by account id and paginate: `.in("account_id", ids).order("account_id").order("date").range(from, to)` in a loop until a short page comes back; or move the aggregation server-side into a Postgres RPC that returns one row per date (which also fixes the egress problem in R-DATA-4 and the index problem in R-DATA-3). Assert on `Content-Range` and surface a visible error rather than a short chart.

### Q4 in detail — the Content page hides small accounts entirely. **P1, CONFIRMED.**

`fetchContent()` takes the top 200 posts by `views` across the whole tenant, with **no account filter and no date filter** (`DATA-INTEGRITY.md` D4 already covers the date half). `src/pages/Content.tsx:32` then filters by *platform* client-side. At agency scale the top 200 by raw views will be dominated by the largest one or two accounts, so **selecting a smaller client's platform tab can return an empty list even though that account has hundreds of posts stored**. The page renders "no content" for a client who posts daily.

**Fix.** Query per account (or per selected scope) with its own limit, and filter by `published_at` against the active range.

### Q8 in detail — an agency with more than 25 Pages silently connects 25 of them. **P0, CONFIRMED.**

`oauth-meta-callback.ts:275-299` calls `/me/accounts` with `fields=...` and **no `limit` parameter and no paging loop**. Graph's default page size for `/me/accounts` is 25. The code iterates `pages.data` (`:285`) and never looks at `pages.paging.next`. The only guard is `if (!pages.data?.length)` at `:280`, which passes.

Result for the exact customer profile in the brief: a large agency with 40-80 Pages under one Business connects, sees "connected", and 15-55 of their clients' Pages are simply absent from PulseBoard. There is no error, no count shown, no reconciliation. They will discover it when a client asks why their brand is missing.

**Fix.** `limit=100` plus a `paging.next` follow-loop with a hard iteration cap, and return the connected count in the redirect so the UI can display "connected 63 Pages". Reconcile on every sync, not only at OAuth time, so Pages added later appear.

---

## 3. CONCURRENCY AND IDEMPOTENCY

**There is no locking of any kind in this codebase.** No advisory lock, no `for update`, no in-flight table, no unique partial index, no `last_synced_at` check, no request coalescing, no idempotency key. `social_accounts.last_synced_at` exists (`schema.sql:41`) and is written (`_sync.ts:72`) but is **never read by any code path** — the natural guard is already in the schema and unused.

### R-CONC-1 · `/api/sync` has no server-side guard; the UI button is the only throttle. **P1, CONFIRMED.**

`src/pages/Connections.tsx:108` disables the button while `dash.syncing`. That is a React state flag in one browser tab. `netlify/functions/sync.ts` accepts every authenticated POST unconditionally (`:9-14`). Consequences:

- Two tabs, or a page refresh mid-sync, or a double-click before React re-renders → concurrent runs.
- A scripted caller with a valid session token issues unlimited syncs. Each Instagram account costs 9 Graph calls; Meta's app-level rate limit is **shared across every user of the app**, so one tenant's loop degrades or blocks *every other tenant's* sync (`LAUNCH-AUDIT.md` #9 flags the rate-limit angle; the idempotency angle is new here).
- Because `syncAccount` writes `last_synced_at` only at the end (`:72`), even a well-behaved caller cannot tell a sync is already running.

### R-CONC-2 · Cron and user-triggered sync race on the same account. **P2, CONFIRMED — mostly benign today, catastrophic once R-CRON-4 is present.**

At 06:00 UTC the cron and a user pressing Sync both call `syncAccount(db, acc)` for the same account. Both read the same `latest` (`:36-38`), compute the same `start`, and upsert the same primary keys. Where both runs succeed, last-writer-wins on identical values — harmless.

The hazard is the interaction with **R-CRON-4**: if one run's insights call 429s (which is *more* likely precisely because two runs are hammering the same endpoint) it produces a full window of zeros, and whichever run finishes last wins. So the observable outcome — real data or a month of zeros — is decided by a race. This is the mechanism by which a user clicking Sync *destroys* their own data.

Content is worse than metrics here: `content` upserts on `(account_id, external_id)` with values read at fetch time, so two runs a second apart write two different lifetime view counts for the same post; the loser is lost. Not corrupting, but non-deterministic.

### R-CONC-3 · Lost update on `social_accounts.status`. **P1, CONFIRMED.**

Three code paths write `status` with no compare-and-set:
- `sync.ts:33` and `sync-cron.ts:25` → `update({ status: "expired" })`
- `_lib.ts:87-100` `saveAccount()` → upsert with `status: "connected"`
- `src/pages/Connections.tsx:51` → `update({ status: "revoked" })` (client-side, RLS-scoped)

Interleavings that actually happen:
- User's token expires → cron marks `expired` → user immediately reconnects (`saveAccount` sets `connected`) → a *still-running* sync from the same cron pass, holding the old token, fails and writes `expired` **after** the reconnect. The user reconnected successfully and the app still tells them to reconnect. They will do it again. `LAUNCH-AUDIT.md` #2 notes that repeated unnecessary OAuth churn across creator accounts is exactly the signal that draws platform enforcement; this is a second, independent generator of that churn.
- User clicks Disconnect (`revoked`) while a sync is in flight → the sync's `last_synced_at` write at `:72` succeeds against a revoked row, and if it then fails it flips `revoked` → `expired`, resurrecting the account into the "needs reconnect" UI after the user disconnected it.

**Fix.** Every status write must be conditional: `.eq("id", acc.id).eq("status", expectedPriorStatus)`, plus a monotonic `status_version int` or a `status_changed_at` guard so a stale writer cannot win. `revoked` must be terminal.

### R-CONC-4 · Token refresh — which `LAUNCH-AUDIT.md` #3 correctly says must be added — is unsafe to add on top of this. **P0 (as a design constraint), CONFIRMED.**

`account_secrets` is a single row per account (`schema.sql:51-58`, PK `account_id`), written only by `saveAccount()`'s blind upsert (`_lib.ts:105-114`). There is no version column, no `updated_at` check (the column exists at `:57` and is never compared), no lock.

TikTok's refresh flow **rotates the refresh token**: `grant_type=refresh_token` returns a new `access_token` *and* a new `refresh_token`, and the old refresh token is consumed. Now add the refresh step at the top of `syncAccount` as recommended, and run the cron and a user sync concurrently on the same TikTok account:

1. Run A reads `refresh_token = R0`. Run B reads `refresh_token = R0`.
2. Run A exchanges R0 → receives `(A1, R1)`, writes them.
3. Run B exchanges R0 → **R0 has already been consumed; TikTok rejects it.**
4. Depending on which error text comes back, `/token|expired|oauth|session/i` (`sync.ts:32`) matches → run B writes `status: "expired"`, **over a row that was just successfully refreshed**.
5. Worse ordering: B's exchange happens first and A's write lands second, persisting `(A1, R1)` after B already invalidated the chain — the stored refresh token is dead. **The account cannot be recovered without the user running the full OAuth flow again**, and this repeats every day the race occurs.

Meta has the mirror-image problem: a long-lived-token re-exchange writing over a Page token, or two callbacks for the same Business writing different Page tokens for the same `external_id`.

**This must be fixed before refresh ships, not after.** Minimum viable design:
- A `sync_runs` table with `unique (account_id) where finished_at is null` (a partial unique index) as the in-flight guard; `insert` failing = a sync is already running, return 409.
- Or `pg_advisory_xact_lock(hashtextextended(account_id::text, 0))` around the whole `syncAccount`.
- Refresh under the lock, with a compare-and-set write: `update account_secrets set ... where account_id = $1 and refresh_token = $old`.
- Enforce a minimum sync interval server-side against the existing `last_synced_at` (15 minutes, per `LAUNCH-AUDIT.md` #9).

### R-CONC-5 · Upsert idempotency — audited. **Mostly sound; one gap.**

| Write | Conflict key | Idempotent? |
|---|---|---|
| `metrics_daily` (`_sync.ts:48-51`) | `account_id,date` — matches the PK (`schema.sql:78`) | Yes, given identical input. Not idempotent across a partial failure (R-CRON-4). |
| `content` (`:54-57`) | `account_id,external_id` — matches the unique constraint (`schema.sql:103`) | Yes |
| `audience_snapshots` (`:65-68`) | `account_id,captured_on` — matches (`schema.sql:121`) | Yes |
| `social_accounts` (`_lib.ts:89-100`) | `user_id,platform,external_id` — matches (`schema.sql:42`) | **No** — it unconditionally resets `status` to `connected`, so it is a state *reset*, not an idempotent write (R-CONC-3). |
| `account_secrets` (`_lib.ts:105-114`) | `account_id` — matches the PK | Blind last-writer-wins (R-CONC-4). |
| `report_shares` (`share.ts:231`) | plain `insert`, random slug | Not idempotent by design; every retry mints a new permanent public URL (`LAUNCH-AUDIT.md` #10). |

The one thing the upserts do buy: **replaying a whole sync is safe**, which is what makes the fan-out design in R-CRON-1 viable — a queue with at-least-once delivery is fine here, provided R-CRON-4 is fixed first.

---

## 4. FAILURE HANDLING

`_sync.ts:312-323`:
```ts
async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  return body;
}
```
`res.ok` is never checked. `res.status` is never read. There is no `AbortSignal`, no timeout, no retry, no backoff, no jitter, no circuit breaker, no `Retry-After` handling, and no reading of `X-App-Usage` / `X-Business-Use-Case-Usage`. `postJson` (`:318-323`) is the same, and its guard `j.error && j.error.code && j.error.code !== "ok"` is weaker still — TikTok returns `error.code: "ok"` on success, so any response whose error object lacks a `code` field passes straight through as valid data.

### R-FAIL-1 · Failure-mode matrix. **P0, CONFIRMED.**

| Failure | What `getJson` does | Effect on the account | Effect on the whole cron run | Stored data |
|---|---|---|---|---|
| **HTTP 429** (rate limited; body is JSON with `error`) | throws | wrapped call → `{data:[]}`; unwrapped `prof` → account skipped | run continues | **30 days of zeros written and frozen** (R-CRON-4) |
| **HTTP 500/503** with JSON body | throws | same as 429 | continues | same |
| **HTTP 502/504 with an HTML error page** (edge/proxy) | `res.json()` throws `SyntaxError: Unexpected token '<'` | same as 429 | continues | same — and the error message is a JSON parse error, so nothing downstream can classify it |
| **HTTP 200 with a partial page** (`data` present, `paging.next` set) | returns normally | treated as the complete series | continues | days beyond the first page written as **0** |
| **Empty `data: []` for a deprecated metric** | returns normally, no `error` | zeros | continues | zeros, frozen. This is the live case today per `LAUNCH-AUDIT.md` #2 |
| **Network hang / no response** | **blocks indefinitely** | — | **kills the entire invocation** | see below |
| **Auth error (code 190)** | throws, message contains "token"/"session" | account marked `expired` | continues | fine, but see R-CONC-3 and the `LAUNCH-AUDIT.md` #2 misclassification |
| **TikTok error object without `code`** | **returns as success** | `data.videos` undefined → `videos = []` → posts `[]` → `views: 0`, `engagements: 0` | continues | a **zeroed day row written for TikTok, permanently** (C2 item 1) |

### R-FAIL-2 · A single hung fetch starves 100% of the remaining tenants. **P0, CONFIRMED — quantified.**

Node's global `fetch` (undici) defaults to `headersTimeout` and `bodyTimeout` of **300,000 ms** ([nodejs/node#46706](https://github.com/nodejs/node/issues/46706) — reverted from 30 s back to 300 s). Nothing in this repo sets a dispatcher or an `AbortSignal`.

300 s ≫ the 30 s scheduled-function limit. So a *single* connection that accepts and never responds — one Meta edge node degrading, one TCP black hole — hangs the loop until Netlify kills the whole invocation.

Quantified against §1.0:

- The hang can occur at any of the **9 (IG) / 4 (FB) / 2 (TikTok)** call sites per account.
- If it occurs on account *k*, accounts *k+1 … N* get **zero** calls. With N accounts and the loop reaching ~8 before the timeout anyway, a hang on account 1 costs `min(N, 8) − 1` accounts their entire day.
- Expected cost of one hang per run = **every account after the hang, i.e. up to 100% of the estate**, and 100% of the estate beyond position ~8 regardless.
- Recovery time = **24 hours** (next cron tick). For TikTok accounts, the lost day is never recovered (C2).

The same defect makes `/api/sync` unusable: a hang there burns the 10-second synchronous budget and returns a 502 to the user with no message.

**Fix.**
1. `AbortSignal.timeout(8000)` on every outbound call, and a global `undici` `Agent({ headersTimeout: 8000, bodyTimeout: 15000, connectTimeout: 3000 })`.
2. A per-account deadline (`Date.now() + 20_000`) checked before each call, so one slow account cannot consume the whole budget.
3. `if (!res.ok)` before `res.json()`, and classify on `res.status` + Meta's numeric `code`/`error_subcode` rather than message text (`LAUNCH-AUDIT.md` #2).
4. Retry only idempotent GETs, 3 attempts, exponential backoff with full jitter, honouring `Retry-After`; never retry a 4xx other than 429.
5. Read `X-App-Usage` / `X-Business-Use-Case-Usage` and stop the run at 75%, recording a `deferred` outcome rather than writing zeros.
6. **A failed call must never produce a written zero** (R-CRON-4).

---

## 5. OBSERVABILITY

### R-OBS-1 · There is no logging. **P0, CONFIRMED.**

`grep -rn "console\.|Sentry|logger|trace|metric" netlify/` across all eight functions returns **zero matches**. The only `console.*` in the entire repository is `src/lib/supabase.ts:11`, a browser-side config warning.

Nothing records: which account was being synced, how long it took, how many Graph calls it made, what HTTP status came back, which metrics returned empty, whether a window was written as zeros, or which accounts the loop never reached. There is no request id, no correlation id, no run id. `LAUNCH-AUDIT.md` #12 asks for an audit log for *security* reasons; the operability case is separate and equally strong — **without a run log, none of the failures in §1-§4 are diagnosable after the fact, only reproducible.**

### R-OBS-2 · The four scenarios in the brief, answered honestly

| Scenario | Can an operator detect it today? |
|---|---|
| **A tenant's sync has failed for a week** | **No.** `last_synced_at` (`schema.sql:41`) is the only signal and is written only on success (`_sync.ts:72`) — so it *is* a correct staleness indicator — but nothing queries it, no view surfaces it, the UI never shows it, and RLS means only the tenant themselves (or a service-role query nobody runs) can see it. The tenant sees a chart that stopped moving and has no reason to think it is a fault. |
| **An expired token** | **Partially, and unreliably.** `status` flips to `expired` via a regex on the error *message* (`sync.ts:32`, `sync-cron.ts:24`), which `LAUNCH-AUDIT.md` #2 shows both false-positives and false-negatives. No email, no push, no in-app alert is sent — the flag only changes a badge on a page the user may not visit. TikTok tokens die every 24 h (`LAUNCH-AUDIT.md` #3), so this is the *normal* daily state, not an exception. |
| **A metric the platform stopped returning** | **No, and it is architecturally undetectable.** The `.catch(() => ({data:[]}))` at `_sync.ts:82,85,87,93,164,169` converts "gone" into `[]`, and `?? 0` at `:115-119,191-195` converts `[]` into `0`, and `bigint not null default 0` (`schema.sql:73-77`) means the row cannot express "unknown". A metric silently disappearing looks exactly like genuine zero traffic. This is happening **right now** for `impressions`, `plays` and `page_impressions` per `LAUNCH-AUDIT.md` #2. |
| **The cron silently stopped** | **No.** The handler returns `200` even on total failure (`sync-cron.ts:31`), a timed-out invocation returns nothing at all, and *absence* of an invocation produces no artefact whatsoever. A schedule that stops firing — a deploy that renames or drops the function, a plan change, a cron-parse regression — is completely invisible. |

### R-OBS-3 · Minimum viable monitoring and alerting. **P0 to build before the first agency client.**

This is small — roughly one table, one function, and four alert rules.

**1. A `sync_runs` table (also the concurrency guard from R-CONC-4):**
```sql
create table pulseboard.sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,                     -- one per cron invocation
  account_id uuid references pulseboard.social_accounts on delete cascade,
  trigger text not null check (trigger in ('cron','user','backfill')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome in ('ok','partial','failed','deferred','skipped')),
  api_calls int not null default 0,
  days_written int not null default 0,
  days_zeroed int not null default 0,       -- the R-CRON-4 tripwire
  http_status int, error_code text, error_class text,  -- codes, never message text, never tokens
  duration_ms int
);
create unique index on pulseboard.sync_runs (account_id) where finished_at is null;
```
No policies (service-role only), same pattern as `account_secrets`.

**2. One structured JSON log line per account** (`console.log(JSON.stringify({...}))` — Netlify's log drain can then ship it to any sink).

**3. A heartbeat + dead-man's switch.** The cron writes `run_id`/`finished_at` on every pass. An *external* uptime checker (Better Stack / Healthchecks.io / a cheap cron ping) expects a ping within 26 hours; **absence of the ping is the alert.** This is the only mechanism that catches "the schedule stopped", and it must live outside Netlify.

**4. Four alert rules, each with an owner and a runbook link (§9):**

| Alert | Condition | Severity |
|---|---|---|
| Cron did not complete | no `sync_runs` row with `trigger='cron'` and `finished_at` in the last 26 h | page |
| Cron did not cover the estate | `count(distinct account_id where trigger='cron' and started_at > now()-1d)` < `0.98 × count(connected accounts)` | page — **this is the alert that would have caught R-CRON-2 on day one** |
| Tenant sync stale | any account `status='connected'` and `last_synced_at < now() - 36h` | ticket, plus notify the tenant |
| Zero-window written | any `sync_runs` row with `days_zeroed > 3` and the account's trailing 7-day average non-zero | page — the R-CRON-4 tripwire |

Plus: Anthropic spend alert (§8), Supabase disk/egress at 80%, and Meta `X-App-Usage` above 75%.

**5. Tenant-facing transparency.** Every chart should carry "last synced 4 minutes ago" and render a visible banner when it is older than 36 hours. The single most damaging property of this system is that a broken sync and a quiet week look identical to the client.

---

## 6. DATA LIFECYCLE

### R-DATA-1 · Table growth. **P2, CONFIRMED (arithmetic).**

Row counts per year, assuming one row per account per day where applicable:

| Table | Rows/account/year | Est. row width | 100 accounts | 1,000 | 10,000 |
|---|---|---|---|---|---|
| `metrics_daily` | 365 | ~130 B (24 B header + uuid + text + date + 5×bigint) | 36.5 k rows / **~5 MB** | 365 k / **~47 MB** | 3.65 M / **~475 MB** |
| `content` | ~300 published posts (rows accumulate, never deleted) | ~300 B (title ≤120 chars + permalink) | 30 k / **~9 MB** | 300 k / **~90 MB** | 3 M / **~900 MB** |
| `audience_snapshots` | 365 (IG+FB only, ~⅔ of accounts) | **~2 KB** (`active_hours` is a 7×24 jsonb grid, plus age/gender/countries) | 24 k / **~48 MB** | 243 k / **~490 MB** | 2.43 M / **~4.9 GB** |
| `report_shares` | unbounded, no expiry | ~50-200 KB payload | — | — | — |
| `social_accounts`, `account_secrets`, `goals` | O(accounts) | small | negligible | negligible | negligible |

**`audience_snapshots` is the dominant table and nobody has noticed.** At 10,000 accounts it is **~4.9 GB/year of a 7×24 integer grid that changes very slowly**, versus 475 MB for the metrics that actually drive the product. Add indexes and bloat and total DB size at 10,000 accounts is **~8-10 GB in year one, ~16-20 GB by year two** — past the Supabase Pro 8 GB inclusion ($0.125/GB overage) and, more importantly, past the point where the unindexed queries in R-DATA-3 stay interactive.

**Fix.** Write an audience snapshot **weekly, not daily** (it is a lifetime/this-month aggregate — a daily cadence adds no information), or only when the payload's hash changes. That is a ~85% reduction in the largest table for zero loss of fidelity.

### R-DATA-2 · No retention policy, no purge job, no deletion on disconnect. **P1, CONFIRMED.**

Nothing in `supabase/schema.sql` or any function deletes a row, ever. The only deletes are `on delete cascade` from `auth.users` and from `social_accounts` — and `social_accounts` rows are **never deleted**, only flagged `revoked` (`Connections.tsx:51`, and `LAUNCH-AUDIT.md` #4 covers the compliance side). So a disconnected account's metrics, content and audience data live forever, and a revoked account still occupies a row that Q1's 1000-row cap counts against… actually `sync-cron.ts:14` filters `status='connected'`, so revoked rows do not consume the cron budget — but they do consume every unfiltered client query (`api.ts:19` `fetchAccounts` returns them; `Connections.tsx:56` filters client-side).

**Fix.** A documented retention window (proposal: `metrics_daily` and `content` 25 months — enough for year-on-year comparison; `audience_snapshots` 13 months; `report_shares` 30 days per `LAUNCH-AUDIT.md` #10; `sync_runs` 90 days), enforced by a nightly purge function, plus real deletion on disconnect as `LAUNCH-AUDIT.md` #4 requires.

### R-DATA-3 · Indexes do not cover the real query patterns; the dashboard sequential-scans on every load. **P1, CONFIRMED.**

Existing indexes (`schema.sql:159-162`) against the actual queries in `src/lib/api.ts`:

| Query | Index available | Usable? |
|---|---|---|
| `metrics_daily where date >= X order by date` (`api.ts:29-33`) | PK `(account_id, date)` and `idx_metrics_account_date (account_id, date)` | **No.** The predicate has no `account_id`, so a leading-column index cannot serve it. **There is no index on `date` alone.** → seq scan + sort of the whole table on every dashboard load. |
| `content order by views desc limit 200` (`api.ts:40-44`) | `idx_content_account_views (account_id, views desc)` | **No.** No `account_id` predicate → seq scan + top-N sort. |
| `audience_snapshots order by captured_on desc` (`api.ts:51-55`) | none | **No index at all** → seq scan + sort of the largest table in the database. |
| `social_accounts` by `user_id` (RLS) | none — only `unique (user_id, platform, external_id)` | Yes, the unique index's leading column serves it. |

Two further problems:

1. **`idx_metrics_account_date` is redundant.** The primary key is `(account_id, date)` (`schema.sql:78`), which already creates exactly that index. `idx_metrics_account_date` (`:159`) is a duplicate — pure write amplification and wasted space on the largest metrics table.
2. **The RLS predicate is not inlineable.** `pulseboard.owns_account(acc)` (`schema.sql:63-66`) is `language sql stable **security definer**`. Postgres does **not** inline `SECURITY DEFINER` functions, so the planner cannot push it down or use it against an index — it becomes a per-row function call executed after the date filter. Combined with the seq scan above, at 3.65 M rows a single `fetchMetrics` call evaluates the function millions of times.

**Fix.**
```sql
drop index pulseboard.idx_metrics_account_date;                     -- duplicate of the PK
create index on pulseboard.metrics_daily (date);                    -- or better, see below
create index on pulseboard.audience_snapshots (account_id, captured_on desc);
create index on pulseboard.content (account_id, published_at desc); -- for the D4 fix
```
and rewrite the policies as an inlineable, initplan-cached subquery instead of a `SECURITY DEFINER` function:
```sql
create policy "metrics owner read" on pulseboard.metrics_daily for select using (
  account_id in (select id from pulseboard.social_accounts where user_id = (select auth.uid()))
);
```
Then have `fetchMetrics` pass `.in("account_id", ids)` explicitly so the `(account_id, date)` PK is actually used. Best of all: replace the three client queries with one Postgres RPC that returns per-day aggregates, which fixes the row cap (Q3), the index coverage, and the egress (R-DATA-4) in one change.

### R-DATA-4 · Egress is dominated by two queries that refetch on every range toggle. **P2, CONFIRMED.**

`src/context/DashboardContext.tsx:44,57` refires **all four** queries whenever `range` changes — but only `fetchMetrics` depends on `range`. Clicking 7 → 30 → 90 refetches `fetchAccounts`, `fetchContent` (200 rows, `select *`) and `fetchAudience` (up to 1000 rows of ~2 KB jsonb, `select *`) three extra times for no reason.

Worst-case egress per dashboard load: `fetchAudience` 1000 × ~2 KB ≈ **2 MB**, plus `fetchContent` 200 × ~300 B ≈ 60 KB, plus `fetchMetrics` 1000 × ~110 B JSON ≈ 110 KB → **~2.2 MB per load, ~8.8 MB per session with three range toggles.** Supabase Pro includes 250 GB egress/month, $0.09/GB after. 10,000 accounts ≈ ~1,500 tenants × 10 loads/day × 2.2 MB × 30 = **~1 TB/month → ~$68/mo of pure avoidable overage**, and far worse if anyone toggles ranges.

**Fix.** Only refetch what depends on `range`; select explicit columns instead of `*`; aggregate `active_hours` server-side (the client only needs a 7×24 sum, never the per-day rows) — that alone removes ~95% of the egress.

### R-DATA-5 · Backup and restore expectations are undocumented and, given D1, insufficient. **P1, CONFIRMED.**

Nothing in the repo mentions backups, PITR, RTO, RPO or a restore drill. Supabase Pro includes **daily backups** with a 7-day window; **PITR is a paid add-on starting around $100/month** for 7 days of retention ([Supabase pricing overview](https://flexprice.io/blog/supabase-pricing-breakdown)). Daily-only backups give an **RPO of up to 24 hours**.

The critical interaction: a restore to yesterday's snapshot rolls `metrics_daily` back, and per `DATA-INTEGRITY.md` D1 + `backfillStart`'s 29-day clamp, the sync **can** re-fetch the lost Meta days (good) but **cannot** re-fetch TikTok days at all (C2), and cannot re-fetch anything older than 29 days. So:

- **RPO for Meta data: effectively 0** once the sync is fixed, provided the outage is under 29 days.
- **RPO for TikTok data: 24 hours, permanently unrecoverable.**
- **RTO: unknown — no restore has ever been tested.**

**Fix.** Buy PITR before the first agency client (the cost of one lost day of an agency's data exceeds $100). Document RPO/RTO explicitly. **Run one restore drill into a scratch project and time it** — an untested backup is a hypothesis. Add a `pg_dump` of `social_accounts` + `account_secrets` (encrypted, per `LAUNCH-AUDIT.md` #8) to a second provider, because those are the only rows that cannot be rebuilt from the platforms.

---

## 7. DEPLOY AND ENVIRONMENT

### R-DEP-1 · `schema.sql` cannot express a change. The second edit is a silent no-op; the third is undiagnosable drift. **P0, CONFIRMED.**

`supabase/schema.sql` is a hand-run script (README step 1.2: "Open SQL Editor and run the whole of `supabase/schema.sql`"). Every table uses `create table if not exists` (`:31, :51, :69, :86, :111, :129, :147`) and every policy uses `drop policy if exists` + `create policy`.

That combination is idempotent for a **fresh** database and **inert** for an existing one:

- **First run:** creates everything. Correct.
- **Second edit** — say you add `metrics_daily.provisional boolean` (which the `DATA-INTEGRITY.md` D1 fix requires) or make `reach` nullable (which the R-CRON-4 fix requires). You re-run the file. `create table if not exists` sees the table and **does nothing**. No error, no warning, exit code 0, "Success. No rows returned." The column does not exist in production. Meanwhile the deployed function's upsert now sends `provisional` → PostgREST returns `PGRST204 "Could not find the 'provisional' column"` → `syncAccount` throws for **every account on every platform**, and `sync-cron.ts:24`'s regex doesn't match, so nothing is flagged; the estate just stops syncing, silently, per §5.
- **Third edit:** production's real schema is now some unknown superset/subset of the file, differing by whatever was applied by hand in the SQL editor between runs. Policies *do* get re-applied (the `drop`/`create` pair), so security state and structural state drift independently. **There is no way to compute the difference between the file and production**, because the file is not a history — it is a snapshot that lies about itself.

Note also `alter default privileges in schema pulseboard grant all on tables to anon, authenticated` (`:27`): **any table created in this schema later is immediately granted full DML to the anon role.** RLS is the only thing standing in the way, and RLS is opt-in per table. One future `create table` without `enable row level security` is a world-writable table reachable with the public anon key. That is a landmine planted by the migration strategy itself.

**Fix.** Move to real migrations before touching the schema again:
```
supabase/migrations/20260823000000_baseline.sql   # current prod state, verified by diff
supabase/migrations/20260824000000_nullable_metrics.sql
```
applied with `supabase db push` (or `supabase migration up`) in CI, tracked in `supabase_migrations.schema_migrations`. Every migration forward-only and idempotent at the *statement* level (`alter table ... add column if not exists`), never at the table level. Verify with `supabase db diff` against production as a CI gate: **a non-empty diff fails the build.**

### R-DEP-2 · There is no staging. Deploy Previews run production functions against the production database. **P0, LIKELY (depends on the Netlify env-var context configuration, which is not in the repo).**

`netlify.toml` (20 lines) declares `[build]`, `[functions]` and two redirects. It contains **no `[context.deploy-preview]`, no `[context.branch-deploy]`, no `[context.production]`** — so every deploy context builds identically. Netlify environment variables set without an explicit context apply to **all** contexts, and the README (step 4) instructs setting them once in "Netlify → Site configuration → Environment variables" with no mention of scoping.

Consequences, assuming the README was followed:
- Any pull-request Deploy Preview exposes a live `/api/sync` and `/api/share` bound to `SUPABASE_SERVICE_ROLE_KEY` for **production**. A preview of a broken branch can write to real tenant tables. There is no read-only mode and no confirmation.
- `/api/ai` on a preview spends the production Anthropic budget (§8).
- The service-role key is present in the runtime of every branch build, so any function added in any PR can exfiltrate every stored OAuth token.
- Scheduled functions only run on production, so the cron itself is at least isolated — small mercy.
- `env.SITE_URL` resolves `VITE_SITE_URL ?? process.env.URL` (`_lib.ts:12`). With `VITE_SITE_URL` set globally to production, a preview's OAuth callbacks redirect to production, which limits *that* blast radius but makes previews untestable for the OAuth flow — the one part of the system most in need of pre-production testing.

**Fix.** A second Supabase project and a second Meta/TikTok app for staging; env vars scoped per Netlify context (`[context.deploy-preview.environment]`); the service-role key present **only** in the production context; and a hard `if (process.env.CONTEXT !== "production") return 403` on any function that writes, until a staging database exists.

### R-DEP-3 · Config drift silently degrades to insecure defaults. **P0, CONFIRMED.**

`netlify/functions/_lib.ts:9-18` reads every secret with a `?? ""` fallback — and one with something worse:

```ts
STATE_SECRET: process.env.OAUTH_STATE_SECRET ?? "dev-insecure-secret",
```

If `OAUTH_STATE_SECRET` is not set in the Netlify environment — a typo, a context-scoping mistake, a new site, a restored-from-backup site — **the OAuth state HMAC is signed with a constant that is published in this public repository.** `verifyState()` (`:49-65`) then accepts any state an attacker forges, including an arbitrary `uid`. The attacker connects *their own* social account into a victim's dashboard (or, with the token-in-URL issue at `LAUNCH-AUDIT.md` #6, pivots further). Nothing logs it, nothing fails at boot, and the application behaves normally in every visible way.

The `?? ""` fallbacks are the same class of defect one level down: a missing `META_APP_SECRET` produces a token exchange with `client_secret=` empty, which fails as a runtime Graph error attributed to the user's connection attempt rather than to a misconfiguration.

**Fix.** Fail fast and loudly:
```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`FATAL: ${name} is not set`);
  return v;
}
```
called at module scope in every function, plus a `/api/healthz` that reports which variables are present (never their values) and a CI/deploy check that asserts the full set exists in the production context before the deploy is promoted.

### R-DEP-4 · Rollback restores the code, not the data. **P1, CONFIRMED.**

Netlify offers one-click rollback to a previous deploy, and that part is genuinely fine. But the failure modes in this system are **write-side**: a bad deploy that zeroes a month of metrics (R-CRON-4), shifts every date by one (`DATA-INTEGRITY.md` D2), or writes to the wrong column keeps its damage after the rollback, and per D1 the affected days are never revisited. **Mean time to detect is currently unbounded (§5); mean time to repair is unbounded too, because there is no backfill tool.**

**Fix.** Ship a `netlify/functions/backfill-background.ts` (admin-only, background function, 15-minute budget) that takes `{account_id, from, to}` and force-refetches a date range regardless of `backfillStart`. It is the missing half of every runbook in §9, and it is roughly 40 lines given `syncAccount` already exists.

### R-DEP-5 · Minimum viable release process for this risk level. **P0 to establish.**

The repo has `npm run typecheck`, `npm run typecheck:functions`, `npm run build`, and a genuinely good hand-rolled harness in `verify/` (`run-all.sh`, `run-oauth.sh`, `run-frontend-empty.sh`, plus the numeric proofs in `verify/proofs/`) — **all tracked in git, and none of it runs automatically.** `LAUNCH-AUDIT.md` P3 flags this; here is the concrete minimum:

1. **CI on every PR** (GitHub Actions): `npm ci` → `typecheck` → `typecheck:functions` → `build` → `verify/run-all.sh` → `verify/run-oauth.sh`. Required status check; no merge without it.
2. **Promote the `DATA-INTEGRITY.md` proofs to assertions** and add the two-consecutive-syncs test that document asks for, plus a new one for R-CRON-4: *a sync whose insights call fails must write zero rows, not rows of zeros.*
3. **A migration gate**: `supabase db diff` against staging must be empty; migrations apply to staging automatically, to production behind a manual approval.
4. **Staging soak**: merge → auto-deploy to staging → the staging cron runs against staging Meta/TikTok apps → promote to production manually, next business day.
5. **A canary tenant**: one internal account synced first on every production deploy, with its metrics diffed against the previous day. A >50% swing blocks the rollout.
6. **Deploy freeze** during the 06:00 UTC cron window, and never deploy a `_sync.ts` change on a Friday, because the damage is written to permanent rows.
7. **Secret rotation, documented and rehearsed**: service-role key, `OAUTH_STATE_SECRET`, `META_APP_SECRET`, `TIKTOK_CLIENT_SECRET`, `ANTHROPIC_API_KEY` — quarterly, plus on any departure. Note that `OAUTH_STATE_SECRET` rotation invalidates in-flight OAuth states (15-minute TTL, `_lib.ts:60`) so it is safe to rotate any time; the Supabase service-role key rotation is **not** — it is derived from the project JWT secret, so rotating it invalidates every signed-in user session at the same moment.

**Blast radius of a bad deploy today:** one `git push` reaches 100% of tenants, in one region, with no canary, no gate, no staging, no automated test, no alerting, and write access to permanent rows that are never revisited. That is the highest-leverage single fix in this document after R-CRON-2.

---

## 8. COST AND QUOTA at 100 / 1,000 / 10,000 accounts

Assumption used throughout: **~1 tenant per 6-7 accounts** (an agency connects several Pages, each Page producing an FB + IG row).

### 8.1 Netlify — not the problem

Today's cron: 1 invocation/day, ≤30 s → ~30 invocations and 15 minutes of runtime per month. Negligible, and non-functional (R-CRON-2).

After the mandatory fan-out (R-CRON-1), one invocation per account per day:

| Accounts | Invocations/mo | Runtime/mo (@ p50 §1.0) | vs. included 125 k inv / 100 h |
|---|---|---|---|
| 100 | 3,000 | 100 × 4 s × 30 = 12,000 s = **3.3 h** | comfortable |
| 1,000 | 30,000 | **33 h** | comfortable |
| 10,000 | **300,000** | **333 h** | **2.4× over invocations, 3.3× over runtime** — needs the next tier (~2 M inv / 1,000 h, +$25/mo) |

Netlify costs tens of dollars at every scale. It is a correctness constraint (the 30 s limit), not a cost one.

### 8.2 Supabase

| Accounts | DB size yr 1 (R-DATA-1) | Egress/mo (R-DATA-4) | Cost |
|---|---|---|---|
| 100 | ~60 MB | ~10 GB | inside Pro $25 |
| 1,000 | ~630 MB | ~100 GB | inside Pro $25 |
| 10,000 | **~6.3 GB (yr 1), ~13 GB (yr 2)** | **~1 TB** | $25 + ~$0.6 storage overage + **~$68 egress overage** ($0.09/GB over 250 GB) + PITR add-on ~$100 → **~$195/mo** |

The bill is manageable. **The binding constraint is compute, not price**: R-DATA-3 shows `fetchMetrics`, `fetchContent` and `fetchAudience` all sequential-scan, and at 10,000 accounts that is a scan over 3.65 M + 3 M + 2.43 M rows on every dashboard load, with a non-inlineable `SECURITY DEFINER` RLS predicate evaluated per row. A Pro-tier instance will not serve that interactively. Fix the indexes and the RLS predicate and the same instance serves it in single-digit milliseconds; do not fix them and the answer is an ever-larger compute add-on that never actually solves it.

### 8.3 Anthropic via `/api/ai` — the largest cost line by an order of magnitude, uncapped

`netlify/functions/ai.ts` has **no per-user cap, no per-day cap, no rate limit, no spend ceiling, no prompt caching**. The only gate is `userIdFromToken` (`:20`), and signup is open Supabase email auth which the README (step 1.4) suggests running with *Confirm email* **off**. The population able to spend the org's Anthropic budget is therefore *anyone with an email address*.

**Cost per request**, from the code's own caps:

| Component | Cap in code | Tokens |
|---|---|---|
| System instructions | `:158-166` | ~350 |
| `summary` | `.slice(0, 8000)` chars (`:148`) | ~2,000 |
| History | 12 messages × `.slice(0, 4000)` chars (`:152-153`) | ~12,000 |
| **Input total** | | **~14,350** |
| Output | `max_tokens: 900` (`:172`) | 900 |

At `claude-opus-4-8` list price ($5 / $25 per MTok):
```
input : 14,350 × $5  / 1,000,000 = $0.0718
output:    900 × $25 / 1,000,000 = $0.0225
                                   ─────────
per request                      ≈ $0.094
```

| Scenario | Arithmetic | Spend |
|---|---|---|
| 100 accounts (~15 tenants, 10 questions/day) | 150 × $0.094 | **$14/day · $423/mo** |
| 1,000 accounts (~150 tenants) | 1,500 × $0.094 | **$141/day · $4,230/mo** |
| 10,000 accounts (~1,500 tenants) | 15,000 × $0.094 | **$1,410/day · $42,300/mo** |
| **Worst case — one authenticated abuser, 1 req/s** | 86,400 × $0.094 | **$8,122/day** |
| **Worst case — 50 concurrent (Netlify's default concurrency easily allows it), ~5 req/s** | 432,000 × $0.094 | **$40,600/day** |

There is no circuit breaker at any layer. The first indication would be an Anthropic billing notification.

**Fix (all cheap):**
1. **A per-user daily request cap** in Postgres (`ai_usage(user_id, day, requests, input_tokens, output_tokens)` with a `check`), enforced before the API call. 50/day covers every legitimate user.
2. **A global daily kill switch** — a `settings` row holding a spend ceiling; exceed it and the endpoint returns 503.
3. **Prompt caching** on the system block: mark the ~2,350-token stable prefix `cache_control: {type: "ephemeral"}`. It is re-billed at full price on every turn today; caching cuts it ~90%, i.e. **~$0.065 → ~$0.030 per request, a ~35% reduction in total spend** for a two-line change (note the summary must move *after* the breakpoint or it invalidates the prefix).
4. Cut the history cap from 12×4,000 to 8×2,000 chars — the dominant input term, and dropping it roughly halves per-request cost.
5. Set an Anthropic **workspace spend limit** and a budget alert at 50%/80%/100%. This is the one control that works even if the code is wrong.

### R-AI-1 · The Assistant will time out in production regardless of cost. **P1, LIKELY.**

`ai.ts:170-176` makes a **non-streaming** `messages.create` with `max_tokens: 900` behind a Netlify **synchronous** function, whose limit is **10 seconds by default** (26 s on Pro, and only on request). An Opus-class model generating 900 tokens takes roughly 13-22 s wall clock plus time-to-first-token. Long answers 502 with no message; short ones scrape through. The failure is intermittent and length-dependent, which is the hardest kind to report.

`thinking: { type: "disabled" }` at `:174` is commented "keep well under the function timeout" — but on an Opus-4.8-class model, disabling thinking makes the model write *more* visible reasoning into the response, i.e. **longer** output. The mitigation is pointed the wrong way.

**Fix.** Stream the response (Netlify supports streamed function responses) and render tokens as they arrive; keep adaptive thinking on and lower `output_config.effort` instead of disabling thinking; request the 26 s timeout on Pro as a floor, not a solution.

### 8.4 Platform API quota

**Meta.** Calls per full sync pass = 13 per connected Page (9 IG + 4 FB, §1.0):

| Accounts | Pages | Graph calls per pass | Per day (1 cron + user syncs) |
|---|---|---|---|
| 100 | ~50 | 650 | ~1,000 |
| 1,000 | ~500 | 6,500 | ~10,000 |
| 10,000 | ~5,000 | **65,000, all inside one 06:00 window** | ~100,000 |

App-level Platform Rate Limit scales with the app's user count (~200 calls/hour/user), so at ~1,500 tenants the app-level budget is ~300,000/hr against 65,000 demanded — headroom **on paper** (LIKELY). The binding constraint is almost certainly **Business Use Case rate limiting, which is enforced per Page asset**, and this code fires 13 calls at the *same* Page/IG pair inside ~7 seconds with **zero awareness of `X-App-Usage` / `X-Business-Use-Case-Usage`** (`LAUNCH-AUDIT.md` #9). When BUC throttling hits, the response is a 429 — which, per **R-CRON-4**, this code converts into **a month of zeros written permanently into a client's dashboard.** That is the single worst compound failure in the system: *the platform politely asking us to slow down destroys customer data.*

**TikTok.** 2 calls/account/day → 20,000/day at 10,000 accounts, plus one refresh per account per day once R-CONC-4's refresh lands (30,000/day). Display API app quotas are per-app and per-day. **UNVERIFIED** — `developers.tiktok.com` is not fetchable from this environment; confirm the current per-app daily quota before onboarding.

**Anthropic.** Org rate limits are per-minute token buckets; at 5 req/s the abuse case above would hit a 429 before the bill, which is an accidental partial mitigation and not a control.

---

## 9. DISASTER RUNBOOKS

None of these exist today. Each assumes the §5 monitoring is in place; where it is not, the **Detection** row says so, and that is the finding.

### RB-1 · Service-role key leak

- **Detection.** *None today.* No access logging (`LAUNCH-AUDIT.md` #12), no anomaly detection, no egress monitoring. You will learn from Supabase support, a GitHub secret-scanning alert, or a customer. **Build first:** Supabase log drain + an alert on service-role queries from an unexpected IP or a `select *` on `account_secrets`.
- **Containment (target < 15 min).** Rotate the service-role key in Supabase → set it in Netlify (production context only) → redeploy. **Know before you do it:** the service-role key is derived from the project JWT secret, so rotating it **signs out every user** — that is acceptable and expected. Simultaneously disable the `pulseboard` schema in Supabase's "Exposed schemas" to cut the REST path entirely.
- **Recovery.** Assume **every stored OAuth token is compromised** — they are plaintext (`schema.sql:53`, `LAUNCH-AUDIT.md` #8). Revoke all of them at the platforms (`DELETE /{user-id}/permissions`, `POST /v2/oauth/revoke/`), truncate `account_secrets`, set every account `expired`, and email every tenant to reconnect. Rotate `META_APP_SECRET`, `TIKTOK_CLIENT_SECRET`, `OAUTH_STATE_SECRET`, `ANTHROPIC_API_KEY` in the same window. **The mass-revoke script does not exist — write it now** (`LAUNCH-AUDIT.md` #12 asks for the same thing).
- **Client impact.** Every tenant signed out; every connection must be re-authorised; sync stops until each reconnects; a mandatory breach notification naming the tokens. Encrypting tokens at the application layer (`LAUNCH-AUDIT.md` #8) downgrades this entire runbook from "breach" to "rotate a key".

### RB-2 · Supabase down for 6 hours

- **Detection.** Immediate for the frontend (every page errors). **Invisible for the sync** unless the outage spans 06:00 UTC — and if it does, `admin()` throws or the first query errors, `sync-cron.ts:16` returns `500`, and **nobody is watching**. Build: the dead-man's switch in R-OBS-3.
- **Containment.** Nothing to contain — there is no cache, no queue, no read replica, no degraded mode. The dashboard is hard-down. Post to a status page (which does not exist; a static page on a different host is the cheapest fix).
- **Recovery.** If the outage misses 06:00 UTC: nothing to do. If it spans 06:00: **Meta accounts self-heal** on the next run because `backfillStart` covers the gap (C2), but **every TikTok account has a permanent one-day hole** and nothing will ever fill it. Run the backfill tool (R-DEP-4) for Meta accounts if you want the day sooner than 24 h.
- **Client impact.** 6 hours of no dashboard; a permanent one-day gap in TikTok charts. Once the fan-out queue from R-CRON-1 exists, a queue with retry makes this a delay instead of a gap — **that is the main operational argument for the queue, separate from the timeout.**

### RB-3 · The cron silently stops

- **Detection.** *Impossible today* (R-OBS-2). Absence of an invocation produces no artefact, and even a total failure returns HTTP 200. **This is the scenario most likely to be discovered by a client asking why their numbers stopped moving.** The dead-man's switch (R-OBS-3, external to Netlify) is the only fix, and it is ~10 minutes of work.
- **Containment.** Immediately trigger a manual pass: `curl -X POST https://<site>/.netlify/functions/sync-cron` — note this works because the handler takes no auth (`sync-cron.ts:8` comment: "no HTTP auth needed (internal)"), which is itself a finding (**R-EXTRA-1** below). Confirm coverage by querying `count(*) from social_accounts where status='connected' and last_synced_at > now() - interval '2 hours'` against the connected total.
- **Recovery.** Diagnose the cause: was the function removed by a deploy, was `schedule()` mis-parsed, did the plan lapse, or — most likely, per R-CRON-2 — **has it been timing out at ~8 accounts every day since the estate grew, and "stopped" is simply when someone finally noticed?** Check the Netlify function log for the last successful completion. Then backfill: Meta accounts recover automatically if the gap is < 29 days, otherwise run the backfill tool per account; TikTok days are gone.
- **Client impact.** Charts frozen from the day it stopped. If the gap exceeds 29 days, **the missing period is permanently unrecoverable for every platform** (C2 item 2) — which sets a hard SLO: *the cron must never be broken for more than 29 days, and must be alarmed within 26 hours.*

### RB-4 · A platform API version expires — this has already happened

Graph v19.0 expired **21 May 2026**; `_sync.ts:3`, `oauth-meta-callback.ts:3` and `oauth-meta.ts:25` still pin it (`LAUNCH-AUDIT.md` #1). It is a live incident today, three months old, undetected.

- **Detection.** *None today* — and this is the cleanest proof that §5 is a P0 rather than a nice-to-have: **the entire Meta integration has been failing for three months and the system reports HTTP 200.** Build: alert when the error rate for any platform exceeds 20% over an hour, and a calendar reminder at every Graph version's release + 18 months.
- **Containment.** The version is hard-coded in three files. Change it in three places, deploy. **This should be one exported constant with an env override** (`GRAPH_VERSION`), so containment is a Netlify env-var change and a redeploy rather than a code change, PR and build.
- **Recovery.** Bump to v25.0, migrate `impressions`/`plays`/`page_impressions` to `views` (`LAUNCH-AUDIT.md` #2), then backfill every account across the outage window — **which for a three-month outage is impossible beyond 29 days** (C2 item 2). The data from 21 May to 25 July 2026 is gone permanently for every tenant.
- **Client impact.** Total. Every number since the expiry is either absent or a fabricated zero (R-CRON-4). Any client who saw a chart in that period saw a fiction.

### RB-5 · A bad deploy corrupts stored metrics

- **Detection.** *None today.* Nothing compares a day's writes against the prior day's. Build: the canary tenant + day-over-day diff gate (R-DEP-5 item 5), plus the `days_zeroed` tripwire (R-OBS-3).
- **Containment (target < 10 min).** (a) Netlify instant rollback to the previous deploy. (b) **Immediately disable the cron** — otherwise the next 06:00 pass writes the corruption again and re-freezes it. There is no feature flag for this today; add a `settings.sync_enabled` row the cron checks on entry, because "roll back the code" does not stop a schedule that is mid-flight.
- **Recovery.** Identify the affected `(account_id, date)` range from `sync_runs` (once it exists) or from the deploy timestamp. `delete from metrics_daily where date between $from and $to` for the affected accounts — **deleting is required, because `backfillStart` keys off the newest surviving row, so leaving the corrupt rows in place guarantees they are never re-fetched.** Then run the backfill tool. If the corruption is older than 29 days, PITR-restore instead; if PITR was never purchased (R-DATA-5), the data is gone.
- **Client impact.** Wrong numbers in dashboards, CSV exports, PDF reports, **already-sent public share links** (which are permanent and unrevocable, `LAUNCH-AUDIT.md` #10 — so a corrupt snapshot stays live at its URL after the database is fixed), and in the AI assistant's answers. `DATA-INTEGRITY.md` makes the point that matters here: *trust is not recoverable by fixing the bug afterwards.*

---

## 10. Additional findings not covered by the brief's nine areas

### R-EXTRA-1 · `/api/sync-cron` is publicly invokable by anyone, with no auth. **P1, CONFIRMED.**

`sync-cron.ts:8` states "no HTTP auth needed (internal)" and the handler has no auth check. But `netlify.toml:12-15` redirects `/api/*` → `/.netlify/functions/:splat`, and scheduled functions remain reachable at `/.netlify/functions/sync-cron` regardless. So **any unauthenticated caller on the internet can trigger a full-estate sync of every tenant, on demand, in a loop.** That is a free amplifier for burning the shared Meta app rate limit (harming every tenant, `LAUNCH-AUDIT.md` #9) and, via R-CRON-4, for writing zeros across the estate. The 30-second timeout ironically limits the damage per call, but not per second.

**Fix.** Reject any invocation lacking Netlify's scheduled-function marker, or require a shared secret header. Netlify sends a `x-nf-event: schedule` style marker on scheduled invocations — assert on it, and return 404 otherwise.

### R-EXTRA-2 · `_sync.ts:275` silently caps any backfill at 400 days. **P3, CONFIRMED.**

`enumerateDays` loops `for (let i = 0; i < 400 && d <= endIso; i++)`. Unreachable today (`MAX_BACKFILL` is 30), but it is a silent truncation waiting for the first person who raises `MAX_BACKFILL` for a historical import. Make it throw rather than truncate.

### R-EXTRA-3 · `today()` is UTC-only and is the sole clock in the sync. **P2, CONFIRMED.**

`_sync.ts:4` `new Date().toISOString().slice(0,10)`. Every date decision — `backfillStart`, `enumerateDays`, the TikTok row's `date`, and `audience_snapshots.captured_on` — is UTC. Compounds `DATA-INTEGRITY.md` D2/D3 and, operationally, means a 06:00 UTC cron writes "today" for a Los Angeles account at 23:00 *the previous* local day. Any timezone fix must reach `today()`, not only `seriesFromInsight`.

### R-EXTRA-4 · No `Retry-After`, no `X-Robots-Tag`, no cache headers, and no size limit on the public share endpoint. **P2, CONFIRMED.**

`share.ts` GET (`:205-216`) is unauthenticated, uncached, unrate-limited and served by a function holding the service-role key. Every `/r/<slug>` view is a service-role database query. A crawler over a few thousand share links is an unauthenticated load generator against the production database with the highest-privilege credential in the system. `json()` (`_lib.ts:70-72`) sets only `content-type`.

**Fix.** `Cache-Control: public, max-age=300`, `X-Robots-Tag: noindex`, a payload size cap on POST, and the `expires_at` column `LAUNCH-AUDIT.md` #10 already asks for.

### R-EXTRA-5 · `verify/` is excellent and load-bearing, and one gap makes it misleading. **P2, CONFIRMED.**

The suites are tracked in git (21 files) and run in seconds. But as `DATA-INTEGRITY.md` observes, they assert on *shape* (`NaN`, `Infinity`, negatives, throws), not truth. Nothing in them exercises: a failing Graph call (R-CRON-4), a second consecutive sync (D1), a >1000-row result (Q1/Q3), a concurrent double-sync (R-CONC-2), or a hung fetch (R-FAIL-2). A green suite therefore actively communicates safety that does not exist. The three highest-value tests to add are listed in R-DEP-5 item 2.

---

## Consolidated priority order

The dependency order matters — several fixes are unsafe in the wrong sequence.

1. **R-DEP-3** (fail fast on missing env — 20 lines, closes a P0 auth hole) and **R-EXTRA-1** (auth the cron endpoint). Both are minutes of work.
2. **R-OBS-3** (structured logs + `sync_runs` + dead-man's switch + the four alerts). **Do this before any other fix**, because without it you cannot tell whether the other fixes worked. It is also the only thing that would have surfaced the three-month-old RB-4 outage.
3. **R-CRON-4** (never write a fabricated zero; nullable columns; skip failed windows). Must land **before** any change that increases request volume, or the retries in R-FAIL-2 will write zeros faster.
4. **R-FAIL-2 / R-FAIL-1** (timeouts, `res.ok`, retry with backoff, usage headers).
5. **R-CRON-1 / R-CRON-2 / R-CRON-3** (fan-out, pagination, ordering). Safe only after 3 and 4.
6. **R-CONC-4** (locking) — a hard prerequisite for the token refresh that `LAUNCH-AUDIT.md` #3 correctly demands.
7. **Q3 / Q8** (metrics pagination; `/me/accounts` paging) — the two defects that specifically break the *agency* customer being onboarded.
8. **R-DEP-1 / R-DEP-5** (migrations, CI, staging, canary).
9. **R-DATA-3** (indexes, RLS predicate), **8.3** (Anthropic caps), **R-DATA-1/2** (retention), **R-DATA-5** (PITR + a rehearsed restore).

**Do not onboard a large agency client before items 1-7.** Items 1-4 are days of work, not weeks, and every one of them is a case where the system currently fails *silently* — which is precisely the failure mode the brief calls unacceptable.

---

## Sources

- [Netlify Scheduled Functions — 30 s execution limit](https://docs.netlify.com/build/functions/scheduled-functions/)
- [Netlify Background Functions — 15 min limit](https://docs.netlify.com/build/functions/background-functions/)
- [Netlify synchronous function timeout: 10 s default, 26 s on Pro by request](https://answers.netlify.com/t/increasing-timeout-from-10-seconds-to-26-seconds/163253)
- [Netlify functions included quota: 125 k invocations / 100 h, tiers above](https://flexprice.io/blog/complete-guide-to-netlify-pricing-and-plans)
- [Supabase/PostgREST `db-max-rows` default of 1000](https://github.com/orgs/supabase/discussions/3765) · [same, confirmed in practice](https://github.com/orgs/supabase/discussions/28858)
- [Supabase Pro: 8 GB storage, 250 GB egress, $0.09/GB overage, PITR add-on ~$100/mo](https://flexprice.io/blog/supabase-pricing-breakdown)
- [Node `fetch`/undici default headers & body timeout of 300 s](https://github.com/nodejs/node/issues/46706)
- [Meta Graph API rate limiting (app-level and Business Use Case)](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- Anthropic model pricing (`claude-opus-4-8` / `claude-opus-5`: $5 / $25 per MTok) — Anthropic model catalogue, June 2026.
