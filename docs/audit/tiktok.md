# PulseBoard — TikTok deep pass (round 2)

Branch `claude/analysis-35bck4`. Date 2026-08-23. Companion to `docs/LAUNCH-AUDIT.md`,
`docs/DATA-INTEGRITY.md`, `docs/JORDAN-CONTEXT.md` — findings there are not re-derived.

Severity: P0 blocks launch · P1 before real accounts connect · P2 before scale · P3 hardening.
Confidence: CONFIRMED (read in this repo / multiple independent sources agree) ·
LIKELY (strong secondary sources, official doc not directly readable) ·
UNVERIFIED (inference; a human must check).

> **Network constraint on this pass.** WebFetch to `developers.tiktok.com` is blocked in this
> environment, so **no claim below was read off TikTok's own documentation page**. Everything
> marked LIKELY rests on secondary mirrors (Phyllo, Nango, Ayrshare, community threads).
> Every policy/API claim is tagged with what a human must confirm.

---

## 1. Every TikTok API call in the codebase

### 1.1 Inventory (from code)

| # | Site (file:line) | Method + endpoint | Params / fields | Scope required | Response shape the code assumes |
|---|---|---|---|---|---|
| T1 | `netlify/functions/oauth-tiktok.ts:17-22` | `GET https://www.tiktok.com/v2/auth/authorize/` | `client_key`, `scope=user.info.basic,user.info.profile,user.info.stats,video.list`, `response_type=code`, `redirect_uri`, `state` | n/a (authorize) | 302 back to `redirect_uri` with `code` + `state` |
| T2 | `oauth-tiktok-callback.ts:18-28` | `POST https://open.tiktokapis.com/v2/oauth/token/` (form-encoded) | `client_key`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri` | n/a | flat JSON: `access_token`, `expires_in`, `refresh_token`, `open_id`, `scope` |
| T3 | `oauth-tiktok-callback.ts:35-38` | `GET https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url,username,follower_count` | Bearer token | `user.info.basic` (open_id, union_id, avatar_url, display_name), `user.info.profile` (username), `user.info.stats` (follower_count) | `info.data.user.{open_id,username,display_name,avatar_url}` |
| T4 | `_sync.ts:232-234` | `GET https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count` | Bearer token | `user.info.stats` | `info.data.user.{follower_count,likes_count,video_count}` |
| T5 | `_sync.ts:236-239` | `POST https://open.tiktokapis.com/v2/video/list/?fields=id,title,view_count,like_count,comment_count,share_count,create_time,share_url,duration` JSON body `{max_count:20}` | Bearer token | `video.list` | `listRes.data.videos[]` with those fields |

No other TikTok endpoint is called anywhere in the repo. **Absent entirely** (grep across
`netlify/` and `src/`): `/v2/oauth/token/` with `grant_type=refresh_token`, `/v2/oauth/revoke/`,
`/v2/video/query/`, and any cursor/pagination handling.

### 1.2 Verification against the current v2 surface — see §1.3 for each row's verdict.

### 1.3 Verdict per call — the migration checklist

| # | Verdict | Detail |
|---|---|---|
| T1 | **Well-formed but incomplete** | Host, path, and the four required params are right for Login Kit v2 (web server flow). Missing: PKCE (optional for web — see §2.1), `disable_auto_auth`, and any browser binding for `state` (§2.3). Scope list is syntactically right (comma-separated). |
| T2 | **Correct shape** | `POST` form-encoded to `https://open.tiktokapis.com/v2/oauth/token/` with those five params matches the v2 spec. Response is **flat** (not `{data:…}`), which the code assumes correctly at `oauth-tiktok-callback.ts:30-32,45,50`. |
| T3 | **Correct, but drops fields it fetched** | Fields legal. `union_id` is fetched (`:36`) and never stored — see F13. `follower_count` fetched at connect and discarded. |
| T4 | **BROKEN — see F1.** | Endpoint and fields are right; the *parsing* throws on every successful response. |
| T5 | **Works, but truncated + mis-mapped** | `max_count:20` is legal (max 20). `duration` is a real field. But no `cursor`/`has_more` handling → permanently capped at the 20 newest videos (F8), and `duration` is written into `avg_watch_seconds` (F14). |

Sources for the v2 surface: [Login Kit overview](https://developers.tiktok.com/doc/login-kit-overview/) ·
[Manage user access tokens](https://developers.tiktok.com/doc/oauth-user-access-token-management) ·
[Get User Info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info) ·
[Video List](https://developers.tiktok.com/doc/tiktok-api-v2-video-list) ·
[Display API get started](https://developers.tiktok.com/docs/en/display-api-get-started).
**Human must re-read all five pages directly** — this pass could not fetch developers.tiktok.com.

---

## F1. The TikTok sync throws on *every successful* API response. P0, CONFIRMED.

This is the headline finding of this pass and it is not in either earlier document.

Every TikTok v2 endpoint returns a **success envelope that always contains an `error` object**:

```json
{ "data": { "user": { … } },
  "error": { "code": "ok", "message": "", "log_id": "2022…727021" } }
```

(shape confirmed by the [Display API get-started example](https://developers.tiktok.com/docs/en/display-api-get-started); `code:"ok"` is the *success* marker.)

`getJson` (`netlify/functions/_sync.ts:312-317`) is written for Meta's convention, where `error`
is present only on failure:

```ts
const body = await res.json();
if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
```

`{code:"ok", message:"", log_id:…}` is a **truthy object**, so the guard fires. `message` is the
empty string, so it throws `JSON.stringify(body.error)`.

`syncTiktok` calls `getJson` at `_sync.ts:232` as its **first statement** and does not `.catch()` it
(unlike the `video/list` call at `:239`, which does). So:

1. `syncTiktok` throws before it reaches `video/list`.
2. `syncAccount` (`_sync.ts:30`) propagates; nothing is written — no `metrics_daily`, no `content`,
   no `last_synced_at`.
3. `sync.ts:31` adds the account to `failures` and the user is told
   **"Reconnect needed: tiktok:<username>"** on every single sync, forever.
4. The thrown text (`{"code":"ok","message":"","log_id":"…"}`) does not match
   `/token|expired|oauth|session/i` (`sync.ts:32`, `sync-cron.ts:25`), so the row is *not* flagged
   `expired` — the UI shows "connected" and healthy while producing zero data and a permanent
   error banner.

The author clearly knew about the envelope: `postJson` (`_sync.ts:318-323`) guards correctly with
`if (j.error && j.error.code && j.error.code !== "ok")`. `getJson` was never given the same guard.

**Net effect: TikTok has never worked. Not one TikTok metric can ever have been stored.** Every
data-correctness finding below (F14-F17) is therefore latent — it becomes live the moment F1 is
fixed, which is exactly why it must be fixed *with* them, not before them.

**Why no test caught it:** there is no TikTok test at all. `verify/mock-graph.mjs` mocks only the
Graph API; `grep -rn "tiktokapis" verify/` matches only compiled build artefacts, never a test.
The TikTok path has **zero** coverage.

**Fix.** Do not share one JSON helper across two incompatible error conventions.

```ts
// dedicated TikTok helper
async function tiktokJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const j = await res.json();
  const code = j?.error?.code;
  if (code && code !== "ok") {
    const e = new Error(`tiktok:${code}: ${j.error.message ?? ""} (log_id ${j.error.log_id})`);
    (e as any).tiktokCode = code;            // classify on this, never on message text
    throw e;
  }
  if (!res.ok) throw new Error(`tiktok:http_${res.status}`);
  return j;
}
```
and route `_sync.ts:232` (and any future TikTok GET) through it. Add a `verify/tiktok-sync.test.mjs`
whose mock returns the real envelope including `error:{code:"ok"}` — that single fixture would have
caught this.

---

## 2. OAuth correctness

### F2. PKCE: not required for this app type, but the *reason* is fragile. P3, LIKELY.

TikTok's Login Kit applies PKCE to **desktop, iOS and Android** clients; the **web (server-side)
flow relies on `state` plus a server-held `client_secret`** — a confidential client, where PKCE is
optional ([Login Kit overview](https://developers.tiktok.com/doc/login-kit-overview/),
[Login Kit for Desktop](https://developers.tiktok.com/doc/login-kit-desktop/)). PulseBoard's flow is
server-side (`oauth-tiktok.ts` builds the URL, `oauth-tiktok-callback.ts` holds the secret), so the
absence of `code_challenge` is **not a defect today**.

Two caveats a human must carry forward:
- The protection PKCE would have provided is being supplied by `state` — and `state` here is broken
  (F4). So the flow currently has *neither* defence.
- If PKCE is ever added, TikTok deviates from RFC 7636: its `code_challenge` is the **hex** encoding
  of SHA-256(verifier), not base64url. A stock OAuth library will produce base64url and fail.
  **Verify against the Login Kit page before implementing.**

Recommendation: add PKCE anyway (it is free for a server flow and future-proofs a move to a public
client), but fix `state` first — that is the actual hole.

### F3. No missing required parameter; two config hazards. P2, CONFIRMED (code) / LIKELY (rules).

`client_key`, `scope`, `response_type=code`, `redirect_uri`, `state` are the full required set for
`https://www.tiktok.com/v2/auth/authorize/`. Nothing required is absent.

Redirect-URI rules (TikTok: must be **HTTPS**, must **exactly** match a URI registered in the
developer portal, no wildcards, no fragment). Both `oauth-tiktok.ts:14` and
`oauth-tiktok-callback.ts:15` derive it from `env.SITE_URL`, which is
`VITE_SITE_URL ?? process.env.URL ?? ""` (`_lib.ts:12`). Two failure modes:

- On a Netlify **deploy preview / branch deploy**, `process.env.URL` is the deploy-specific URL, so
  the generated `redirect_uri` is not the registered one → TikTok rejects the authorize request.
  Because the same expression is used at exchange time the two agree with each other but not with
  TikTok's registry, so the error surfaces as an opaque `bad request` at the *authorize* step.
- If both are unset, `redirect_uri` becomes the relative string `/api/oauth-tiktok-callback`, and
  `backToApp` (`_lib.ts:76-77`) redirects to a relative URL. Nothing validates this at boot.

**Fix.** Fail fast at module load if `SITE_URL` is not an absolute `https://` origin; pin the
redirect URI to one explicitly-configured constant (`TIKTOK_REDIRECT_URI`) rather than deriving it,
so previews cannot silently mint an unregistered URI.

### F4. The state-replay account-takeover exists identically on the TikTok path — and is worse here. P0, CONFIRMED.

Confirmed by reading the code: `oauth-tiktok.ts:22` calls the **same** `signState`, and
`oauth-tiktok-callback.ts:9` the **same** `verifyState`, as the Meta path (`_lib.ts:44-65`). The
state is an HMAC over `{uid, provider, t}`. There is **no** nonce store, **no** cookie, **no**
single-use consumption, and a **15-minute** window (`_lib.ts:60`) in which it can be replayed an
unlimited number of times.

TikTok's own guidance is explicit that the `state` token should be stored in the user's browser
(e.g. a cookie) and compared on return — that is precisely the step this code omits
([Login Kit overview](https://developers.tiktok.com/doc/login-kit-overview/)).

**The TikTok-specific attack and why it is more damaging than on Meta.**

1. Attacker registers a normal PulseBoard account and hits `/api/oauth-tiktok`, capturing the
   authorize URL containing `state = HMAC({uid: attacker})`. (The URL is handed to their own browser
   in a 302 — no privilege needed.)
2. Attacker sends that URL to the victim creator (DM, "connect your TikTok to our media kit tool").
3. Victim is logged into TikTok, sees a genuine `tiktok.com` consent screen for a real reviewed app,
   and approves.
4. TikTok redirects to `…/api/oauth-tiktok-callback?code=<victim's code>&state=<attacker's state>`.
5. `verifyState` passes. `saveAccount(admin(), state.uid, …)` (`oauth-tiktok-callback.ts:42`) writes
   the **victim's TikTok open_id and live access token under the attacker's `user_id`**.

The attacker now holds, inside their own dashboard, a live TikTok access token for a high-value
creator account — with `user.info.profile`, `user.info.stats` and `video.list`. Nothing in the
product ever tells the victim; `social_accounts` is keyed `(user_id, platform, external_id)`
(`schema.sql:42`), so **the same TikTok account can be bound to unlimited PulseBoard users
simultaneously**, and the victim's own (legitimate) connection is unaffected and shows healthy.

Worse on TikTok than on Meta for three reasons:
- The TikTok token is a **bearer token usable from anywhere** — there is no `appsecret_proof`
  equivalent to bind it to the server (contrast LAUNCH-AUDIT §7, which is at least *available* on
  Meta).
- The connection surfaces in the victim's TikTok "Manage app permissions" as *one* authorisation of
  a legitimate app, indistinguishable from their own.
- Because disconnect never revokes (LAUNCH-AUDIT §4), the victim has **no** effective way to cut it
  off from inside PulseBoard; only revoking in TikTok settings works, and that also kills their own.

**Additional confirmed flaw in the same code path — cross-provider state confusion. P2.**
`oauth-tiktok-callback.ts:9-10` checks only that the signature verifies; it never asserts
`state.provider === "tiktok"`. A state minted by `/api/oauth-meta` (`provider:"meta"`) is accepted
verbatim by the TikTok callback, and vice versa. The `provider` field is written and never read.

**Fix (all four parts).**
1. Mint a random `nonce`, set it in a `Secure; HttpOnly; SameSite=Lax; Path=/api` cookie, include
   its hash in the signed state, and require both to match in the callback — this is the
   browser binding TikTok documents.
2. Make state **single-use**: store the nonce in a small table/KV with a TTL and delete on
   consumption; reject an already-consumed nonce.
3. Cut the TTL from 15 minutes to ~5.
4. Assert `state.provider === "tiktok"` in the TikTok callback (and `"meta"` in the Meta one).
5. Defensively: on `saveAccount`, if this `external_id` is already bound to a *different* `user_id`,
   refuse and alert rather than silently duplicating.

### F5. Granted scope is stored and never checked. P2, LIKELY.

The token response's `scope` is persisted (`oauth-tiktok-callback.ts:50`, into
`account_secrets.extra`) and no code path ever reads it (`grep -rn "extra" netlify/ src/` → written
only). TikTok's consent screen lets a user decline individual optional scopes, so a connection with
only `user.info.basic` is a normal outcome. The app will then fail on `user.info.stats` /
`video.list` with an opaque error and tell the user to reconnect — which will produce the same
result. **Human must confirm** on the Login Kit consent screen whether per-scope decline is
offered for this scope set.

**Fix.** Compare the returned `scope` against the required set at callback time; if `video.list` or
`user.info.stats` is missing, do not mark the account `connected` — show "TikTok connected with
limited permissions: re-authorise and allow video access", and record which features are disabled.

---

## 3. Token lifecycle

### 3.1 The facts (LIKELY — mirrors of [Manage user access tokens](https://developers.tiktok.com/doc/oauth-user-access-token-management); human must confirm on the page itself)

| Property | Value |
|---|---|
| Access token life | `expires_in: 86400` — **24 hours** |
| Refresh token life | `refresh_expires_in: 31536000` — **365 days** |
| Refresh call | `POST https://open.tiktokapis.com/v2/oauth/token/`, `Content-Type: application/x-www-form-urlencoded`, body `client_key`, `client_secret`, `grant_type=refresh_token`, `refresh_token` |
| Refresh response | Flat JSON: new `access_token`, `expires_in`, **new `refresh_token`**, `refresh_expires_in`, `open_id`, `scope` |
| **Rotation** | **Yes.** Each refresh returns a *new* refresh token; the old one is invalidated. The new token must be persisted or the chain is broken on the next attempt. |
| Chain ceiling | The refresh chain is bounded at ~365 days from the original grant; after that the user must re-authorise interactively. |
| Revocation | `POST https://open.tiktokapis.com/v2/oauth/revoke/` with `client_key`, `client_secret`, `token` (the access token). Removes the app from the user's *Manage app permissions* page. |
| User revokes in TikTok settings | The access **and** refresh tokens are invalidated immediately. Subsequent calls return `error.code = "access_token_invalid"` (HTTP 401). |

### F6. Refresh is not implemented at all, so TikTok dies every 24 hours. P0, CONFIRMED.

LAUNCH-AUDIT §3 states this; here is the precise mechanism and the exact fix.

`refresh_token` and `expires_at` are written at `_lib.ts:109-110` from
`oauth-tiktok-callback.ts:50`. `syncAccount` reads **only** `access_token,extra`
(`_sync.ts:31`) — `expires_at` and `refresh_token` are never selected by any query in the repo.

Concrete consequence, hour by hour: a creator connects at 14:00 Amman. The cron fires at 06:00 UTC
= 09:00 Amman. The **first** cron run after connection is inside the 24-hour window and would work
(but for F1). The **second** — 33 hours after connection — hits a dead token. From that point every
sync returns `access_token_invalid`, whose message text contains "token", so `sync.ts:32` matches
and the account is flipped to `expired`. The user is prompted to run the full OAuth consent flow
again, **every day, forever**, for every TikTok client on the roster.

This is not merely annoying: repeated daily re-authorisation of the same `open_id` by the same
`client_key` is an anomalous pattern. Combined with F4 (multiple PulseBoard users able to hold the
same account) it is the kind of signal that gets a client's account or the app's `client_key`
reviewed. **P0 on account-safety grounds, not just availability.**

**Exact fix.** Add to `_sync.ts`, called from the top of `syncAccount` for TikTok accounts:

```ts
const { data: s } = await db.from("account_secrets")
  .select("access_token,refresh_token,expires_at,extra").eq("account_id", acc.id).single();

async function tiktokToken(db: Db, accountId: string, s: SecretRow): Promise<string> {
  const skew = 10 * 60 * 1000;                                  // refresh 10 min early
  if (s.expires_at && Date.parse(s.expires_at) - Date.now() > skew) return s.access_token;
  if (!s.refresh_token) throw new Error("tiktok:no_refresh_token");

  const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token", refresh_token: s.refresh_token,
    }),
  });
  const t = await r.json();
  if (!t.access_token) throw new Error(`tiktok:refresh_failed:${t.error ?? "unknown"}`);

  // MUST persist the ROTATED refresh token, or the next run has a dead chain.
  await db.from("account_secrets").update({
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? s.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    extra: { ...s.extra, scope: t.scope,
             refresh_expires_at: new Date(Date.now() + t.refresh_expires_in * 1000).toISOString() },
    updated_at: new Date().toISOString(),
  }).eq("account_id", accountId);

  return t.access_token;
}
```

Three details that are easy to get wrong and that a review will punish:
- **Persist the rotated `refresh_token` in the same statement as the access token.** If the write
  fails after TikTok has rotated, the account is permanently unrecoverable without re-consent.
  Prefer a single `update` (as above) so it is atomic.
- **Store `refresh_expires_at`** and warn the user at T-30 days. The 365-day ceiling is silent
  otherwise; a client will simply find their data stopped a year later.
- Because a daily cron refreshes daily, the chain stays alive — but any account that goes >365 days
  without a *successful* run is gone. Alert on consecutive failures.

### F7. Disconnect never calls `/v2/oauth/revoke/` — TikTok-specific consequences. P1, CONFIRMED.

LAUNCH-AUDIT §4 covers the general case. Specific to TikTok:

`src/pages/Connections.tsx:51` sets `status='revoked'` on PulseBoard's own row. After a client
"disconnects", the app **continues to hold a token that PulseBoard's own refresh job (once F6 is
implemented) will keep alive indefinitely** — because `sync-cron.ts:15` filters on
`status='connected'`, refresh would stop, and the token dies within 24h. But `account_secrets` is
never deleted, so a live-at-the-time token and 365 days of refresh capability sit in the database.

More importantly, the app **remains listed in the creator's TikTok "Manage app permissions"**. From
the creator's point of view they revoked access and TikTok says otherwise. For an agency handling
other people's high-value accounts, that discrepancy is the thing a client escalates.

**Fix.** On disconnect, in order: `POST /v2/oauth/revoke/` with the current access token (refreshing
first if expired, since revoke takes a live token) → delete the `account_secrets` row → delete or
schedule deletion of that account's `metrics_daily` / `content` rows → then set `status='revoked'`.
Do the same automatically on `access_token_invalid`.

### F8. Error classification by message text mis-handles every TikTok error. P1, CONFIRMED.

`sync.ts:32` / `sync-cron.ts:25` regex `/token|expired|oauth|session/i` against `e.message`. TikTok
returns machine-readable codes — `access_token_invalid`, `scope_not_authorized`,
`rate_limit_exceeded`, `invalid_params`, `internal_error`
([error handling](https://developers.tiktok.com/doc/tiktok-api-v2-error-handling)). Under the
current code:

- `access_token_invalid` → matches ("token") → correctly flagged. Accidental.
- `scope_not_authorized` → **does not match** → silent permanent failure, account shows healthy.
- `rate_limit_exceeded` → does not match → good, but there is no backoff either (§4).
- F1's `{"code":"ok",…}` → does not match → the permanent-error-but-healthy state described above.

**Fix.** Attach `tiktokCode` to the thrown error (F1's helper) and branch on it: `expired` only for
`access_token_invalid`; a distinct `needs_reauth_scope` state for `scope_not_authorized`; retry with
backoff for `rate_limit_exceeded` and `internal_error`; alert a human for anything else.

### F9. `video/list` is capped at 20 posts with no pagination. P2, CONFIRMED.

`_sync.ts:236-240` posts `{max_count: 20}` and reads `data.videos`. The response also carries
`cursor` and `has_more` ([Video List](https://developers.tiktok.com/doc/tiktok-api-v2-video-list));
neither is read. So PulseBoard permanently knows only the 20 most recent videos of an account —
and, per D4 in DATA-INTEGRITY, the Content page claims to show a date range it never filters. A
creator posting daily has an 20-day horizon; the "top posts by views" in a 90-day report is drawn
from 20 videos.

**Fix.** Loop on `cursor`/`has_more` up to a bounded page count (e.g. 10 pages / 200 videos), stop
when `create_time` falls before the retention window, and persist the last cursor so incremental
syncs are cheap.
