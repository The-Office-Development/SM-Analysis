# PulseBoard — launch readiness audit

Scope: the mechanism by which this app connects to, authenticates against, reads from and
retains data for Facebook, Instagram and TikTok accounts. Assessed for (a) whether it works
at all today, (b) whether it can pass Meta and TikTok review, (c) whether it can put a
connected account at risk of restriction, and (d) whether it holds credentials safely at the
scale of high-value creator accounts.

Assessed against the code on branch `claude/analysis-35bck4`. Verdict: **not launchable in
its current state.** One issue is a hard stop (the app cannot successfully call Meta today),
several are review blockers, and several are account-safety risks that grow with the number
of connected accounts.

Severity key: **P0** blocks launch · **P1** must ship before real accounts connect ·
**P2** required before scale · **P3** hardening.

---

## P0 — the integration cannot work today

### 1. Graph API v19.0 expired on 21 May 2026

`netlify/functions/_sync.ts:3` and `netlify/functions/oauth-meta-callback.ts:37` pin
`https://graph.facebook.com/v19.0`; `oauth-meta.ts:25` pins the `v19.0` login dialog.

Meta versions live about two years. v19.0 (Jan 2024) expired **21 May 2026** — every call to
it errors now. The current version is v25.0 (Feb 2026), and v20.0 expires 24 Sep 2026.

Fix: move to v25.0 (skip v20 — it expires within weeks) and put the version in one exported
constant, plus an env override, so a version bump is a config change. Add a calendar
reminder at each version's release +18 months.

### 2. The metrics being requested were removed from the API

Even on a current version, these calls fail or return nothing:

| Call | Site | Problem |
|---|---|---|
| IG account `insights?metric=reach,impressions` | `_sync.ts:79` | `impressions` deprecated for user/media insights from 21 Apr 2025; not requestable at all from v22.0 |
| IG media `insights.metric(...,plays)` | `_sync.ts:92` | `plays` deprecated in the same change |
| FB `page_impressions` | `_sync.ts:163` | part of the same consolidation into `views` |

Meta consolidated impressions / plays / video views into a single **`views`** metric. A
request for a removed metric returns an error rather than a number.

Fix: request `views` (and keep `reach`, which survives), map it onto the existing `views`
column, and stop writing `reach` into `views` as IG does today (`_sync.ts:117`) — that
silently reports reach as video views.

Second-order risk: `getJson` throws on any `body.error` (`_sync.ts:~350`), and
`sync.ts:32` decides an account needs reconnecting by regex-matching `/token|expired|oauth|session/i`
on the message. A metric-deprecation error whose text happens to contain one of those words
flags a perfectly healthy account as `expired` and prompts the user to re-authorise. Repeated
unnecessary OAuth churn across many creator accounts is exactly the signal that draws
platform attention. Classify on Meta's numeric `code` / `error_subcode` (190, 102, 463, 467)
and TikTok's error codes instead of on message text.

---

## P1 — review blockers and account-safety risks

### 3. No token refresh anywhere

`account_secrets.refresh_token` and `expires_at` are written (`_lib.ts:105-114`) and then
never read by any code path. Consequences:

- **TikTok breaks every 24 hours.** TikTok access tokens carry `expires_in` 86400 (24h);
  the refresh token lasts 365 days and can be refreshed without user consent via
  `POST https://open.tiktokapis.com/v2/oauth/token/` with `grant_type=refresh_token`. Today
  the app simply lets the token die, marks the account expired, and asks the user to run the
  whole OAuth flow again — daily.
- **Meta degrades silently.** Long-lived user tokens last ~60 days; Page tokens derived from
  them stop working when the user token is invalidated (password change, permission removal,
  inactivity). Nothing detects this before the next failed sync.

Fix: a refresh step at the top of `syncAccount` that checks `expires_at` and refreshes when
within a threshold (TikTok), and a scheduled re-exchange for Meta long-lived tokens well
before the 60-day mark. Persist the new token and expiry. Alert the user *before* expiry,
not after data has already stopped flowing.

### 4. "Disconnect" neither revokes nor deletes anything

`Connections.tsx:51` sets `status = 'revoked'` on our own row. That is the whole operation.
After a user disconnects:

- the access token stays live and stored in `account_secrets` (no delete, no revoke call),
- all previously collected Platform Data stays in our tables indefinitely,
- the user's Meta/TikTok settings still show the app as authorised.

This is a data-deletion obligation under both platforms' terms, and it is the single worst
finding from a breach-blast-radius perspective: the database accumulates live tokens for
accounts that believe they have disconnected.

Fix, in one transaction on disconnect:
1. `DELETE /{user-id}/permissions` (Meta) / `POST /v2/oauth/revoke/` (TikTok),
2. delete the `account_secrets` row,
3. delete or schedule deletion of that account's `metrics_daily`, `content`,
   `audience_snapshots` rows (offer an export first if you want to keep the UX),
4. only then mark the account revoked.

Do the same on token-invalid errors, so dead tokens don't linger.

### 5. Meta's required review artefacts do not exist

There is no privacy policy page, no terms page, no data-deletion instructions page and no
data-deletion callback endpoint in this repo (`src/pages/`, `netlify/functions/`). App Review
requires a live Data Deletion Callback URL **or** a Data Deletion Instructions URL, plus a
privacy policy that names a concrete deletion path; data-deletion problems are one of the
most common rejection reasons, and an endpoint that acknowledges but does not delete is an
enforcement risk in itself.

Fix: add `/privacy`, `/terms`, `/data-deletion` routes and a
`netlify/functions/meta-data-deletion.ts` that verifies the `signed_request` with the app
secret, actually performs the deletion in 4 above, and returns JSON `{ url, confirmation_code }`
(JSON, not HTML — returning HTML fails review). Add a status page the `url` points at.

Also required before Advanced Access to other people's data: Business Verification, the Data
Use Checkup, and — because this app stores Platform Data server-side — a Data Protection
Assessment. Budget weeks, not days, and note that the DPA asks directly about the encryption
and access-logging gaps listed below.

### 6. The user's Supabase session JWT travels in a URL

`oauth-meta.ts:9` and `oauth-tiktok.ts:9` take the access token as
`GET /api/oauth-meta?token=<supabase access token>`. That token lands in browser history, in
Netlify's request logs, and potentially in the `Referer` sent onward when the function
redirects the browser to facebook.com. Anyone who obtains it holds the user's PulseBoard
session, which in turn can enumerate their connected accounts.

Fix: POST the token to a small endpoint that returns the provider URL, or mint a single-use,
60-second, HMAC-signed handoff nonce and pass that. Add `Referrer-Policy: strict-origin-when-cross-origin`
site-wide regardless.

### 7. No `appsecret_proof` on any Graph call

Every Meta call sends only the access token (`_sync.ts` throughout). Two problems: a stolen
token can be replayed from anywhere, and the moment anyone enables **Require App Secret** in
the app dashboard — which is the correct setting for a server-side app custodying tokens for
high-value accounts — every call in this codebase starts failing.

Fix: append `appsecret_proof` (HMAC-SHA256 of the access token keyed with the app secret) and
`appsecret_proof_time` to every Graph request, generated inline per call (proofs expire after
5 minutes). Then turn Require App Secret on.

### 8. Tokens are stored in plaintext columns

`account_secrets.access_token` is a plain `text` column (`supabase/schema.sql:53`). The
README's claim that "tokens are encrypted at rest by Supabase" describes disk-level
encryption only — anyone with the service-role key, a SQL console, or a database backup reads
them directly. For a platform hosting influencer accounts this is the highest-consequence
asset in the system and it has exactly one layer of protection (RLS with no policies, which
the service role bypasses by design).

Fix: envelope-encrypt tokens at the application layer (AES-256-GCM with a key held only in
the function environment / a KMS) or use Supabase Vault / pgsodium. Then a leaked database
snapshot is not a set of live credentials. Update the README claim either way.

---

## P2 — required before you scale past a handful of accounts

### 9. Nothing respects platform rate limits

No code reads `X-App-Usage` or `X-Business-Use-Case-Usage`, no backoff, no retry policy, and
`getJson` (`_sync.ts:~348`) never even checks `res.ok` before parsing. Meta's app-level limits
are shared across **all** users of your app, so this is the mechanism by which one user's
behaviour harms every other connected account:

- `/api/sync` (`sync.ts`) has no server-side throttle. The UI disables the button while a sync
  runs, but a scripted caller can issue unlimited syncs; each one is ~9 Graph calls per account.
- `sync-cron.ts:34` fires every account in the system at 06:00 UTC in one serial loop from one
  function — a thundering herd that grows linearly with signups and will also blow the
  function time limit (see the earlier note on pagination: the query is capped at PostgREST's
  default 1000 rows, so past that, accounts silently stop syncing entirely).
- On a 429 or a transient 5xx there is no backoff, so the failure mode is retry pressure
  against an API that is already telling you to slow down.

Fix: read the usage headers and pause at a threshold (e.g. 75%); exponential backoff with
jitter on HTTP 429 and Graph codes 4/17/32/613; a hard per-account minimum sync interval
(15 minutes) enforced server-side against `last_synced_at`; a global concurrency cap; and
spread the cron by hashing account id into a slot across the hour instead of one 06:00 burst.

### 10. Public report links are permanent and unrevocable

`share.ts` mints a slug and stores a snapshot forever. There is no expiry column
(`schema.sql:147`), no revoke UI, no owner-facing list of live links, no size limit and no
rate limit on creation. The payload includes audience demographics derived from Platform
Data, published at a URL that needs no authentication.

Fix: `expires_at` (default 30 days) enforced in the GET, a revoke action on the Reports page,
a payload size cap, a per-user creation limit, and `X-Robots-Tag: noindex` on `/r/*`.

### 11. Over-broad scope request

`oauth-meta.ts:15-23` requests `business_management`. It is a heavy permission that pulls in
Business Verification and a harder review, and nothing in `_sync.ts` uses Business Manager
endpoints. `public_profile` is granted automatically and does not need requesting.

Fix: request only `pages_show_list`, `pages_read_engagement`, `read_insights`,
`instagram_basic`, `instagram_manage_insights`. Fewer scopes means faster approval, a smaller
breach blast radius, and a more credible review submission.

### 12. No audit log, no retention policy, no kill switch

Nothing records which token was used when, or by which code path. `metrics_daily` and
`content` grow without bound and without a stated retention period. There is no way to
mass-revoke if the service-role key or the app secret leaks.

Fix: an append-only `sync_log` (account, timestamp, calls made, outcome — never token
material); a documented retention window with a purge job; and a runbook-backed script that
revokes every stored token and rotates secrets.

---

## P3 — hardening

- **No security headers.** `netlify.toml` sets none. Add CSP, HSTS, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and `X-Robots-Tag: noindex` for `/r/*`.
- **Provider error text is reflected into a redirect URL.** `backToApp` (`_lib.ts:75`) puts
  `error_description` straight into the query string; return opaque codes and log the detail
  server-side.
- **Third-party disclosure.** `/api/ai` sends aggregated metrics to Anthropic. It is
  numbers-only and never sees tokens or raw rows, which is the right design, but Anthropic is
  a sub-processor and must be named in the privacy policy alongside Supabase and Netlify.
- **No CI.** The `verify/` suites are genuinely good and run in seconds; nothing runs them
  automatically. Wire typecheck + build + all three suites into a GitHub Action so a bad sync
  change cannot reach production.
- **No alerting.** A failed cron returns a 500 body nobody reads. Route failures somewhere a
  human sees them.
- **Model pin.** `ai.ts:13` uses `claude-opus-4-8`; current default is `claude-opus-5`.

---

## Suggested sequence

1. **Unblock:** Graph v25.0, `views` metric migration, error classification by code. Nothing
   else matters until calls succeed.
2. **Make it safe to hold credentials:** token refresh, real revoke-and-delete on disconnect,
   `appsecret_proof`, encrypted token storage, session token out of the URL.
3. **Make it reviewable:** privacy / terms / deletion pages, deletion callback endpoint,
   scope reduction, then submit for App Review, Business Verification, DUC and DPA.
4. **Make it safe at scale:** rate-limit handling, per-account sync throttle, cron
   pagination + jitter, share-link expiry, audit log, CI.

Only after 1–3 should a real creator account connect, and only after 4 should more than a
handful.

---

## Sources

- [Graph API version schedule](https://developers.facebook.com/docs/graph-api/changelog/versions) ·
  [v19.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/) ·
  [version deprecation overview](https://singhamandeep.com/meta-graph-api-version-deprecation/)
- [Instagram impressions → views deprecation](https://docs.emplifi.io/platform/latest/home/instagram-insights-metrics-deprecation-april-2025) ·
  [Meta merges data points into views](https://www.socialmediatoday.com/news/meta-deprecates-impressions-in-favor-of-views-api/757958/)
- [TikTok access token management](https://developers.tiktok.com/doc/oauth-user-access-token-management)
- [Facebook data deletion callback URL guide](https://singhamandeep.com/facebook-data-deletion-callback-url/) ·
  [Meta user data deletion requirements](https://ppc.land/meta-enhances-developer-platform-with-new-user-data-deletion-requirements/)
- [Meta Login security / appsecret_proof](https://developers.facebook.com/documentation/facebook-login/security) ·
  [Graph API rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
