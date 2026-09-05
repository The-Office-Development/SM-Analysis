# Instagram API verification against the official documentation

First verification of the `IG` block in `netlify/functions/_instagram.ts` against
`developers.facebook.com`. Every previous session recorded that site as
unreachable, so every endpoint, scope, metric and field name in that block rested
on secondary sources. This document replaces that guess with a citation.

Verified: 2026-08-26, from a session with direct access to the developer site.
Primary source: **Instagram Account Insights**, reference page for
`GET /<IG_ACCOUNT_ID>/insights`, page dated **Updated: Jun 16, 2026**, which
states its requirements for *both* login paths in a single table.

Still not verified against a live response. Documentation agreement is not the
same as one real API call, and the reconciliation gate in `CLAUDE.md` §4 stands
unchanged.

---

## 1. Verdict

| Item in the `IG` block | Status |
|---|---|
| `AUTHORIZE` `https://www.instagram.com/oauth/authorize` | **Correct** |
| `TOKEN` `https://api.instagram.com/oauth/access_token` (form POST) | **Correct** |
| `GRAPH` `https://graph.instagram.com` | **Correct** — the docs name this host for the Instagram Login path |
| `EXCHANGE_GRANT` `ig_exchange_token` | **Correct** — `GET graph.instagram.com/access_token`, no version prefix, as coded |
| `REFRESH_GRANT` `ig_refresh_token` | **Correct** — `GET graph.instagram.com/refresh_access_token`, no version prefix, as coded |
| `SCOPES` `instagram_business_basic`, `instagram_business_manage_insights` | **Correct**, and both are read-only |
| `MEDIA_FIELDS`, `MEDIA_INSIGHT_METRICS` `reach,saved,shares,views` | **Correct** — `saved`, not `saves`, is right at the media level |
| Demographics call (`follower_demographics`, `lifetime`, `this_month`, `total_value`) | **Correct** — matches the reference exactly |
| Version path on `/insights` | Correct in form; the **pin is stale** (see 3.4) |
| `DAILY_METRICS` `reach, views, follower_count, total_interactions` | **Three of the four are wrong** (see 2) |

Nine of twelve items were assembled correctly from secondary sources. The
exception is the daily metric set, and it is the one the dashboard is built on.

---

## 2. The finding: only `reach` can be fetched as a daily series

`syncInstagramLogin` in `_sync.ts` requests all four daily metrics the same way:

```
GET /me/insights?metric=<m>&period=day&since=<t>&until=<t>
```

then reads a per-day series out of the response. The reference's Metrics table
gives a **Metric Type** column per metric, and it does not support that shape:

| Metric | Documented metric type | Consequence for this code |
|---|---|---|
| `reach` | `total_value`, **`time_series`** | Works. The only one that does. |
| `views` | `total_value` **only** | Cannot return a daily series |
| `total_interactions` | `total_value` **only** | Cannot return a daily series |
| `follower_count` | **absent from the table entirely** | Not a supported metric |
| `online_followers` | **absent from the table entirely** | Not a supported metric |

`follower_count` and `online_followers` survive on the page only inside a
Limitations bullet ("not available on accounts with fewer than 100 followers")
which reads as text left behind by an earlier revision. Neither appears among the
metrics the API documents as requestable. The documented replacement for follower
movement is **`follows_and_unfollows`** (`period=day`, `total_value`, breakdown
`follow_type`), which is in the table.

### What this does to the product

The failures are safe but silent — this is the audit's `optional()` discipline
working as designed. Nothing is corrupted; things are simply missing:

- **`views`** — every daily call errors, the metric is filed as unavailable, and
  the `views` column stays `null` for every day. The chart is empty, not wrong.
- **`total_interactions`** — errors, then falls back to summing likes, comments,
  shares and saves across the 25 most recent posts. That fallback is a different
  quantity from the platform's own figure and covers only the fetched window.
- **`follower_count`** — errors, so `flatFollowers` draws a flat line at the
  account's current follower count. A follower graph that cannot move is the
  single most visible number in a sponsor-facing media kit.
- **`online_followers`** — errors, so the Planner's best-time-to-post
  recommendation has no data behind it at all.

### The open question this closes, and the one it opens

`CLAUDE.md` §4 names the highest-value open question: are `online_followers`
hour keys account-local or a fixed platform timezone? **The question is probably
moot** — the metric is no longer documented as requestable. What replaces the
Planner's recommendation is now a product question, not a timezone question.

### Why the test suite did not catch any of this

`verify/tests/mock-graph.mjs:19` returns a per-day value for all four metrics:

```js
return { reach: 1000 + day, views: 2000 + day, follower_count: day, total_interactions: 300 + day }[metric] ?? 0;
```

The oracle encodes the same wrong model as the code, so 40 tests and 18/18
mutations agree with each other and with nothing else. This is precisely the risk
`CLAUDE.md` §3 records — "validated against that model, not against real
responses" — now demonstrated rather than predicted. **Any fix must correct the
mock first**, or the suite will keep certifying the defect.

---

## 3. Smaller findings

**3.1 `metric_type` is never sent.** `reach` supports both types, and the code
relies on the API's default being `time_series`. The default is not documented.
Send `metric_type=time_series` explicitly.

**3.2 Advanced access is required.** Meta's announcement of user and media
insights for Instagram Login states that `instagram_business_manage_insights`
requires **Advanced access** to be requested from any app user. Standard access
covers app-role holders only. This does not block the tester-route pilot in
`PROJECT-STATE.md` §3, but it is an App Review requirement to plan for.

**3.3 Breakdown errors are indiscriminate.** Requesting a breakdown against a
metric that does not support it returns "An unknown error has occurred" — for the
*whole* query. The code already requests metrics one at a time, which contains
this. Keep it that way.

**3.4 The version pin is stale.** `IG_VERSION` defaults to `v23.0`; the reference
names **v26.0** as latest and its examples use v26.0. Meta removes metrics
between versions, so the pin should be a deliberate, current choice.

**3.5 Demographics has a `city` breakdown** the code does not request, and
`engaged_audience_demographics` exists alongside `follower_demographics` — a
possible feature, not a defect.

**3.6 `ig_reels_avg_watch_time` exists** at the media level. `avg_watch_seconds`
is hard-coded `null` in the sync; it is obtainable for Reels.

---

## 4. One invariant, independently confirmed

The reference states:

> If insights data you are requesting does not exist or is currently unavailable,
> the API will return an empty data set instead of 0 for individual metrics.

That is the platform confirming the invariant the audit derived the hard way:
an absent metric is absent, never zero. `?? 0` in the sync path would convert
Meta's own "no data" into a client's "you reached nobody". The rule in
`CLAUDE.md` §5 is not defensive coding; it matches the documented contract.

---

## 5. Sources

- Instagram Account Insights reference (`GET /<IG_ACCOUNT_ID>/insights`), updated Jun 16 2026 — metrics table, metric types, parameters, limitations
- Instagram Media Insights reference — media metric names per media type
- Business Login for Instagram — authorize and token exchange endpoints
- Access Token / Refresh Access Token references — `ig_exchange_token`, `ig_refresh_token`, hosts, 24-hour and 60-day rules
- Meta developer blog, 24 Mar 2025, user and media insights on Instagram API with Instagram Login — `instagram_business_manage_insights`, Advanced access

---

## 6. First contact with the live API — 2026-09-04

The probe in `verify/probe-live.mjs` made the first real Instagram calls this
project has ever made, using a token generated from the App Dashboard rather
than through OAuth. No deploy, no client, no risk.

**Every endpoint, scope and field name in the `IG` block is correct: 11 of 11,
zero failures.** `/me` with `ME_FIELDS`, `reach` as `time_series`, `views` and
`total_interactions` as `total_value`, `follows_and_unfollows` with the
`follow_type` breakdown, `/me/media` with its insights expansion, and all three
demographic breakdowns. The largest standing risk in `PROJECT-STATE.md` §4 —
"never run against the live API" — is closed for the contract, though not for
the numbers (see 6.3).

### 6.1 Correction: `follower_count` and `online_followers` are NOT removed

Section 2 of this document concluded, from the metrics table, that neither metric
is requestable. **That conclusion is wrong.** Both answered a live call, each
returning a `values` array with `end_time`, and a localised `title` and
`description`:

```
follower_count   {"name":"follower_count","period":"day","values":[{"value":0,"end_time":"2026-09-03T07:00:00+0000"}], ...}
online_followers {"name":"online_followers","period":"day","values":[{"value":0,"end_time":"2026-09-03T07:00:00+0000"}], ...}
```

Absence from the documentation table is not absence from the API. The §2 reading
was careful and still wrong, which is the argument for the reconciliation gate in
one line.

What re-opens:

- **The `online_followers` hour-key timezone question**, long recorded as the
  highest-value open question and prematurely retired as moot. It is live again.
- **`follower_count` as a real daily series**, which would replace the
  reconstructed follower line anchored on today's count. That line is the single
  most visible number in a sponsor-facing media kit.

What does not change: both metrics are **undocumented but working**. Meta removes
such metrics without notice, so neither may become a hard dependency. Anything
built on them keeps the `optional()` treatment and a fallback.

### 6.2 The day boundary is not Amman, and this is now the top open question

`reach` returned `end_time` of `2026-08-29T07:00:00+0000`. That is midnight
**US Pacific**, not midnight Amman, which would be `21:00:00+0000` the previous
day.

`dayKeyFromEndTime` handled it correctly — it derives the offset from `end_time`
itself rather than assuming, so it read `-7` and filed the bucket as
`2026-08-28`. No defect. But the consequence is real:

> On this account, a "day" in the dashboard runs **10:00 to 10:00 Amman time**.

Two possibilities, and they have different fixes:

1. **The boundary follows the account's own Instagram timezone setting.** This
   test account is simply set to Pacific. A Jordanian business account set to
   Amman would return `+3` and everything is already correct.
2. **The boundary is fixed platform-side.** Then every Jordanian client's daily
   figures are bucketed on a US day, and the dashboard must label that honestly
   rather than implying local days.

**The test is cheap and decisive:** run `verify/probe-live.mjs` against a second
account whose Instagram timezone is set to Amman and read the derived offset the
probe now prints. Until then, treat this as unresolved.

### 6.3 The probe validated the contract, not the numbers

The account used (`heath_ens21`) has **101 followers, 0 media, and zero activity**:
every metric returned `0`, the media list was empty, and all three demographic
breakdowns returned 0 segments despite the follower count sitting right at the
~100 threshold.

So this settles what the API *is called* and what shape it returns. It settles
nothing about whether the numbers are right. `PROJECT-STATE.md` §0 already warns
that test accounts cannot validate numbers, and this is that warning arriving on
schedule. **The reconciliation gate still stands, unchanged, and still needs a
real account with real history.**

### 6.4 Second live run, 2026-09-04 — through the real OAuth flow

The first run used a token generated in the App Dashboard. This one used a token
obtained through **PulseBoard's own OAuth flow** — the first time `exchangeCode`
has ever executed against Meta. Same result: **11 of 11, zero failures.**

Three findings.

**The day boundary is −7 again, on a Jordanian account.** `end_time` came back
`2026-08-29T07:00:00+0000` — midnight US Pacific — for an account created and
used in Jordan. One account is not proof, but this now leans toward the boundary
being **fixed platform-side** rather than following the account's own timezone.
That was the more expensive of the two possibilities and it is the one the
evidence favours.

If it holds, the 0007 fix is doing the right thing rather than a redundant one:
every `total_value` metric is requested with an explicit per-day window in the
account's timezone, and the docs state the API "will only include data created
within this range", so those windows produce genuine Amman days regardless of
how Meta buckets its own `time_series`. `reach` is re-fetched the same way when
the boundaries disagree. **What is still unverified is whether an arbitrary
window really is honoured**, and only an account with real activity can show
that — a zero-activity account returns zero for every window.

**`follower_count` returns real per-day data.** Six days, one of them non-zero,
each with its own `end_time`. It is a usable daily series, which means it can
replace the reconstructed follower line — the most visible number in a media
kit — rather than the current reconstruction from `follows_and_unfollows`. Still
undocumented, so it needs `optional()` and a fallback, never a hard dependency.

**`online_followers` returns six days, all zero.** Expected on an account with
101 followers and no posts. It confirms the metric is requestable and says
nothing yet about the hour keys, which is the question the Planner depends on.

### 6.5 What this account can and cannot settle

`heath_ens21`: 101 followers, **zero media**, every metric zero, demographics
empty. It has now proved, end to end:

- the OAuth flow, including the token exchange and encrypted storage
- every endpoint, scope and field name in the `IG` block
- that the sync runs without throwing against live responses

It cannot prove a single **number**. The reconciliation gate needs an account
with real history, and until one is connected the correctness of the day
windows, the discovery split and the follower series remains unverified.

---

## 7. Token scopes — what a connection can actually do

The pitch to a creator with a six-figure following is that connecting cannot put
their account at risk. That claim needs evidence, and the two ways to obtain a
token **do not grant the same thing**.

### 7.1 The OAuth token is provably read-only

`authorizeUrl()` requests exactly `instagram_business_basic` and
`instagram_business_manage_insights`. Meta enforces scopes server-side, so a
token issued from that flow cannot publish, message, moderate comments, or
change anything. A test asserts the scope list and explicitly rejects
`business_management` and `instagram_business_content_publish`; a mutation adds a
write scope and confirms the test fires. This is the token a client's connection
produces.

### 7.2 The App Dashboard token is NOT the same, and grants far more

"Generate token" bypasses OAuth entirely — nothing in this codebase constrains
it, and **it does not ask the operator to choose permissions**. After generating
one for `@heath_ens21`, Instagram's own Apps and Websites screen listed the app
as holding:

| Permission | State |
|---|---|
| Basic business information | Required |
| **Business message information** | granted |
| **Publish content as a business** | granted |
| Manage insights | granted |
| **Business comment information** | granted |

Three of those are write-capable and **the product never requests any of them**.
They came from the dashboard flow, which grants what the app is configured for
rather than what a caller asks for.

**Consequences:**

- Treat a dashboard-generated token as materially more dangerous than an OAuth
  one. Use it for probing, then let it expire — it is long-lived (60 days).
- A client will never see this, because they authorise through the OAuth flow
  whose consent screen lists only the two scopes we request.
- The excess permissions can be revoked per-account at
  **Instagram → Settings → Apps and websites → (the app) → toggles**.

### 7.3 What the product needs, exhaustively

| Call | Scope |
|---|---|
| `/me` — username, followers_count, media_count, avatar | `instagram_business_basic` |
| `/me/media` — caption, type, permalink, timestamp, like_count, **comments_count** | `instagram_business_basic` |
| media `insights` — reach, saved, shares, views | `instagram_business_manage_insights` |
| `/me/insights` — reach, views, total_interactions, follows_and_unfollows | `instagram_business_manage_insights` |
| `follower_demographics` — age, gender, country | `instagram_business_manage_insights` |

Nothing else. In particular **`comments_count` is a number on the media object
under `basic`** — reading comment *text* would need the `/comments` edge, which
this codebase never calls. Revoking "business comment information" therefore
costs nothing.

**Verify rather than trust that last claim.** `comments: m.comments_count ?? 0`
means a field that stopped being returned would show as **0 comments, not as
unknown** — a quiet failure, not a loud one. After revoking, sync an account with
real posts and confirm the Content page still shows comment counts.

### 7.4 Auditing a live token

`verify/audit-token.mjs` decrypts the stored token from `account_secrets` and
audits it: the three reads the product depends on should succeed, and every
write-gated endpoint must be refused. Every call is a GET — a write capability is
proved by reading an endpoint that capability gates, never by attempting the
write.

It exits non-zero if any write capability is allowed, and it is the thing to run
in front of a sceptical client.

### 6.6 Insights ARE retroactive on a newly converted account

I claimed in session that Instagram insights begin accumulating only when an
account becomes professional, so converting an account for testing would yield
no usable history. **That was wrong, asserted from general knowledge rather than
evidence, and the stored data disproves it.**

Meta documents no such limitation. The account-insights Limitations section
lists exactly four — the 100-follower floor for `follower_count` and
`online_followers`, the 30-day window for `online_followers`, empty sets rather
than zeros for unavailable data, and the top-45 cap on demographics. Conversion
date is not among them.

`@heath_ens21` was converted to a professional account a few days before
2026-09-05, and `reconcile.mjs --days 30` returned real values for the full
month, including movement that a reconstruction could not fabricate:

```
2026-08-06   92      2026-08-22   96      2026-08-29   98   <- a DECREASE
2026-08-11   93      2026-08-23   98      2026-09-01  100
2026-08-12   94      2026-08-26   99      2026-09-03  100
```

A follower line rebuilt backwards from today's count cannot produce a fall on
one day and a rise on the next; that requires genuine per-day data. Scattered
non-zero `reach` on 8, 9, 23, 30 and 31 August says the same.

**Consequence for onboarding:** an account converted specifically for testing is
a valid oracle, and switching a personal account to Creator does not cost its
history. That materially changes the advice to give someone lending an account
for a pilot.

**The general lesson is the one this document keeps relearning.** Documentation
absence is not API absence — that reopened `online_followers` — and a
confidently remembered platform behaviour is weaker evidence than either. Check
the stored rows.
