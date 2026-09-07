# Security review — 2026-09-07

Run against the live deployment at `app.theoffice.it.com`, on Cloudflare Pages
and Workers, with two real Instagram accounts connected. Every claim below was
tested, not reasoned about; where something could not be tested, it says so.

## What was tested and passed

### The public key reaches nothing

`VITE_SUPABASE_ANON_KEY` ships in the browser bundle by design. Queried every
table with it, unauthenticated:

```
social_accounts  account_secrets  metrics_daily  content  audience_snapshots
provider_identities  sync_log  report_shares  ai_usage
  -> all: 42501 permission denied
```

Blocked at the **grant** level, not merely by row-level security (migration
0006 revoked privileges from `anon`). This is stronger than an RLS policy: a
mistaken policy cannot leak what the role has no privilege to read at all.

### Every endpoint refuses an unauthenticated caller

```
account-data GET/POST 401   ai POST 401        disconnect POST 401
refresh-post POST 401       sync POST 401      share POST 401
```

`share?slug=` and `deletion-status?code=` are public by design — the first
serves report links, the second is Meta's data-deletion callback. Both require an
identifier and return 400 without one.

### Scheduled work is unreachable over HTTP

```
/api/sync-cron      404
/api/token-refresh  404
```

Neither is in the route table. `sync-cron` touches every user's accounts and
`token-refresh` rewrites stored credentials; both run only from the Cron Trigger
in `worker-cron`, which has `workers_dev = false` and no fetch handler, so its
own hostname 404s too.

### Public identifiers are not guessable

All from `crypto.randomBytes`, never `Math.random`:

| Identifier | Entropy |
|---|---|
| Share link slug | 72 bits |
| Deletion confirmation code | 96 bits |
| OAuth state nonce | 144 bits |

Enumeration is not practical at these sizes.

### No server secret reaches the browser

Checked the local build **and** the live served bundle for the literal values of
`SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENC_KEY`, `OAUTH_STATE_SECRET` and
`INSTAGRAM_APP_SECRET`. Absent from both. The three `VITE_` values are present,
which is correct: they are public by construction and RLS is what protects the
data behind them.

### Tenant isolation on the newest endpoint

`/api/refresh-post` resolves a post by joining through `social_accounts` on the
caller's own id. Tested directly: the owner's request returns the row, a
different user id returns nothing. Without that join a guessable content id
would have let any signed-in user read another tenant's post.

`disconnect` rejects an account whose `user_id` is not the caller's;
`account-data` filters every query by `uid`.

### Prompt injection

`ai.ts` builds its system prompt from a fixed array. The dashboard snapshot goes
in a **user** turn, incoming messages are forced to `role: "user"` so a caption
cannot impersonate the assistant, and the system prompt states that snapshot
text is data written by other people and must not be obeyed. The endpoint is
also capped per user per hour and per day.

### Transport

All six headers live: HSTS, a CSP with `script-src 'self'` and
`frame-ancestors 'none'`, nosniff, `X-Frame-Options: DENY`, referrer policy and
permissions policy. The OAuth nonce cookie is `HttpOnly; Secure; SameSite=Lax`.

### Dependencies

`npm audit`: **0 vulnerabilities**, after upgrading React Router past
GHSA-337j-9hxr-rhxg. See below.

## What was fixed during the review

**React Router advisory GHSA-337j-9hxr-rhxg.** Arbitrary constructor injection
via `deserializeErrors()`. The vulnerable path is SSR hydration and this app has
no SSR — `createRoot` and `BrowserRouter`, no `StaticRouter`, no
`renderToString` — so it was very probably unreachable. Upgraded to 7.18.3
anyway: "probably unreachable" is an argument, and a client asking whether their
data is safe deserves an answer that does not rest on one. No 6.x release clears
the advisory. Every route and the parameterised `/content/:id` deep link were
verified after.

**`/api/refresh-post` had no rate limit.** Added a 30-second per-post cooldown
(migration 0012). Instagram throttling would only inconvenience the caller, but
each call also spends a Cloudflare Worker invocation, and on the free plan that
daily budget is **account-wide** — shared with the other projects on the same
Cloudflare account. A looping client could have taken unrelated sites' functions
down with it.

## Known and accepted, with reasons

**A token can hold more than we request.** Audited live: an OAuth token issued by
our flow carries whatever the *account* previously granted the app, so
`@heath_ens21`, which once generated a token through the App Dashboard, holds
publishing and messaging permissions this app never asked for. `@malekismaiil`,
which never did, audits clean. We cannot narrow what Meta issues; the callback
now audits every token at connect time and records what it found (migration
0011). Full detail in `API-VERIFICATION.md` §7.5.

**Share links never expire and cannot be revoked.** A slug is unguessable, but
anyone holding the URL keeps access indefinitely, and the payload is a frozen
snapshot of a client's figures. Tracked in `tasks.md` §7. This is the largest
remaining gap.

**CSP allows `style-src 'unsafe-inline'` and `img-src https:`.** The first is
required by React's inline styles, the second by platform-hosted avatars and
thumbnails. Both widen the policy; neither permits script execution.

## Not tested

**Cross-tenant reads by an authenticated user.** Proving this needs a second real
user account and a genuine JWT, which would mean creating one in production. The
grant-level block on `anon` and the per-endpoint ownership checks were verified
instead. Worth doing properly with a staging project before client number two.

**Penetration testing.** Nothing here is a substitute for it.
