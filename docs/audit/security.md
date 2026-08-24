# PulseBoard Round-2 Security Audit (adversarial)
Date: 2026-08-23. Branch: claude/analysis-35bck4.
Status: IN PROGRESS — findings appended as established.

## Threat-model positions used
A = anonymous internet user · B = free self-service signup · C = legitimate tenant reaching another tenant
D = holder of a leaked artefact (anon key / user JWT / service-role key / DB backup / build log)
E = a party who can post content on a synced platform account

---

# S1. OAuth account-linking CSRF: an attacker can capture a victim's Facebook Page + Instagram tokens into the attacker's own tenant. **P0 · CONFIRMED**

**Evidence**
- `netlify/functions/_lib.ts:44-48` — `signState()` HMACs `{uid, provider, t}`. The state's *only* binding is to the user who started the flow. Nothing is stored server-side, nothing is set as a cookie, nothing marks it used.
- `netlify/functions/_lib.ts:49-65` — `verifyState()` checks HMAC + a 15-minute TTL. **No single-use check, no nonce store, no binding to the browser that completes the flow.**
- `netlify/functions/oauth-meta.ts:28` — the state is emitted into the redirect URL the browser is sent to, so the initiating user can read it out of their own address bar.
- `netlify/functions/oauth-meta-callback.ts:11-12,47,54` — the callback trusts `state.uid` and calls `saveAccount(db, state.uid, …)` with **whoever's** `code` arrived.
- Identical shape in `oauth-tiktok.ts:22` / `oauth-tiktok-callback.ts:9,42`.

**Exploitation (position B → C)**
1. Attacker signs up for a free PulseBoard account (self-service signup is on).
2. Attacker hits `/api/oauth-meta?token=<own JWT>`, lands on facebook.com, and copies `state=<S>` out of the URL. `S` is valid for 15 minutes and is bound to the *attacker's* uid.
3. Attacker sends the victim a link to the identical Facebook dialog URL carrying `state=S` (client_id, redirect_uri and scope are all public/fixed).
4. Victim — a creator with a Facebook Page — clicks and authorises. **If the victim has ever authorised this Meta app before, Facebook returns the `code` with no interaction at all: a silent one-click.**
5. Facebook redirects to `/api/oauth-meta-callback?code=<VICTIM CODE>&state=S`. The callback verifies `S`, resolves `uid = ATTACKER`, exchanges the victim's code for a long-lived user token, walks `/me/accounts`, and writes **every one of the victim's Pages and linked Instagram Business accounts, with their live Page access tokens, into `account_secrets` under the attacker's `user_id`.**
6. The attacker's dashboard now reads the victim's insights, audience demographics and content; the attacker's tenant holds a live Page token that `_sync.ts` will keep exercising daily.

**Reverse direction (position D, leaked JWT)** — with a victim's Supabase JWT (which this app puts in a URL, see S2), the attacker calls `/api/oauth-meta?token=<victim JWT>`, obtains a victim-bound state, completes the flow with the *attacker's* Facebook account, and injects an attacker-controlled social account into the victim's tenant — poisoning the victim's dashboard, exported reports and the AI snapshot.

The 15-minute window is generous, the state is replayable an unlimited number of times inside it, and step 2 is repeatable on demand, so "capture a fresh state, phish immediately" is a reliable loop.

**Fix**
On the entry point, generate a random `nonce`, include it in the signed state **and** set it in a `HttpOnly; Secure; SameSite=Lax` cookie. In the callback, require the cookie to be present and to equal `state.nonce`, then clear the cookie so the state is single-use. Persist consumed nonces (or a short-lived row keyed by nonce with a `used_at`) so a replay inside the TTL fails. Cut the TTL to 5 minutes. Additionally, before `saveAccount`, refuse to attach a platform `external_id` that is already attached to a *different* `user_id` unless the existing owner has explicitly released it — that alone converts this from silent theft into a visible error.

---

# S2. `/api/ai` is an unauthenticated-in-effect proxy to the org's Anthropic key: the entire system prompt is client-supplied. **P1 · CONFIRMED**

**Evidence**
- `netlify/functions/ai.ts:31` — `const summary = (body.summary || "").slice(0, 8000);`
- `netlify/functions/ai.ts:41-49` — that client string is concatenated *into the system prompt* verbatim after `=== DASHBOARD SNAPSHOT ===`.
- `netlify/functions/ai.ts:32-36` — `messages` are taken from the body too: up to 12 turns × 4000 chars, with `role` freely chosen, so the attacker also writes the assistant's side of the conversation.
- `netlify/functions/ai.ts:21` — the only gate is "is this a valid Supabase user", and signup is self-service.
- No rate limit, no per-user quota, no cost accounting anywhere in the file.

**Exploitation (position B)**
1. Sign up for a free account (no email confirmation if the README's advice at `README.md:35` was followed — see S7).
2. `POST /api/ai` with `summary` = arbitrary 8 KB of system-prompt text and `messages` = a hand-written conversation including fabricated assistant turns.
3. The server dutifully calls `claude-opus` with the attacker's system prompt. The "grounded, numbers-only" framing in `README.md:102` is a client-side convention (`src/lib/analytics.ts:114` `summarizeForAI`) that the server never enforces.

**Impact** — two distinct harms. (a) Free unmetered LLM: an attacker scripts this into a general-purpose Claude endpoint funded by `ANTHROPIC_API_KEY`, with prefill-style control of the assistant turn, which is the strongest lever for steering the model off-policy. Content generated this way is attributable to the operator's Anthropic account. (b) Direct financial DoS: 900 output tokens × unlimited concurrent requests burns the budget, and when the key hits its cap **every other tenant's Assistant stops working**.

**Fix**
Build the summary server-side from the caller's own rows (the service-role client already has them) instead of accepting it from the browser; at minimum reject any `summary` that does not match the shape `summarizeForAI` emits. Ignore client-supplied `assistant` turns or verify them against a server-held conversation id. Add a per-user rate limit (e.g. 20 requests / hour) and a daily token budget, enforced in a table, plus a global circuit breaker.

---

# S3. Prompt injection via platform captions — real, but narrower than it looks. **P2 · LIKELY**

**Evidence**
- `src/lib/analytics.ts:132-134` — post titles are interpolated into the AI summary as `- "${c.title.slice(0,60)}" (…)`, delimited by nothing stronger than a double quote, inside a block the model is told to treat as authoritative fact (`netlify/functions/ai.ts:43` "Answer using ONLY these numbers").
- `netlify/functions/_sync.ts:98` (IG `caption`), `:172` (FB `message`), `:243` (TikTok `title`) — captions land in `content.title` with only a 120-char truncation and no sanitisation.

**Who controls the text, and who reads the output.** This is the honest calibration the finding needs. `_sync.ts` reads `/{ig-user}/media`, `/{page}/posts` (page-authored, *not* `/feed`) and TikTok `video.list` — all **first-party** content. In a single-owner tenant the injector and the reader are the same person, which is self-injection and not a security boundary. The genuine cross-principal case is the app's actual target market: agencies and managed creator accounts, where a Page has several admins or a scheduler tool, and the person reading the Assistant is an account manager who did not write the caption. There, a caption is a text channel from one principal into another principal's LLM session.

**Ceiling.** `ai.ts` gives the model no tools, no retrieval and no network; the output is rendered as plain text (`src/pages/Assistant.tsx:81` `{m.content}` — React escapes it, so no XSS). So the maximum is *persuasive text in a trusted surface*: fabricated numbers the manager forwards to a sponsor, or a lure ("your Instagram token expired, reconnect at …"). 60 chars per post × the top 5 posts gives roughly 300 characters of attacker text spread over five adjacent lines — cramped, but enough for a short imperative. That is a P2, not a P0.

**Fix**
Wrap untrusted spans explicitly: emit titles inside a fenced, clearly-labelled `UNTRUSTED POST CAPTIONS` block, strip newlines and control characters, and add a system-prompt line stating that text inside that block is data and must never be treated as instructions. Combined with S2's fix (build the summary server-side), the channel is contained.

---

# S4. Checked and NOT a defect — recorded so it is not re-raised

- **Service-role key in the client bundle.** `grep` over `dist/assets/*.js` finds no `service_role`, no `SUPABASE_SERVICE_ROLE_KEY` and no JWT-shaped literal. Vite only inlines `VITE_`-prefixed vars and `src/` references exactly two (`src/lib/supabase.ts:3-4`). Clean.
- **Open redirect in the OAuth flow.** `backToApp` (`_lib.ts:75-78`) builds the location from `env.SITE_URL`, a server-side constant, and `redirect_uri` is likewise server-built (`oauth-meta.ts:14`, `oauth-tiktok.ts:14`). No user input reaches a `Location` host. Not an open redirect.
- **Share-slug entropy / enumerability.** `share.ts:43` uses `crypto.randomBytes(9)` = 72 bits. Not guessable, not enumerable. `LAUNCH-AUDIT.md#10`'s concern is expiry and revocation, which is correct; slug entropy itself is fine.
- **XSS.** No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` anywhere in `src/`. Captions, usernames and report fields all render as React text nodes.
- **CSRF on `/api/sync`, `/api/share` POST, `/api/ai`.** All authenticate from an `Authorization` header, never a cookie, so a cross-site form or image cannot carry credentials. Genuinely safe.
- **CSV formula injection does NOT extend to the report or share page.** `docs/DATA-INTEGRITY.md` D5 is correct for `src/lib/reports.ts:16`. I checked the two other surfaces the brief asked about: `src/components/ReportSheet.tsx:66` renders `c.title` as a React text node into HTML (printed to PDF, never parsed by a spreadsheet), and the share payload (`src/lib/snapshot.ts:52`) feeds the same component. The formula-injection class is confined to the CSV path. D5's fix stands; no extension needed.

---

# S5. RLS matrix, and the write policies that let a free account attack the shared cron

## The matrix (`supabase/schema.sql`)

| Table | RLS | SELECT | INSERT | UPDATE | DELETE | anon | Notes |
|---|---|---|---|---|---|---|---|
| `social_accounts` | on | owner | **owner** | **owner** | **owner** | denied | `:47` `for all` — writable by the client |
| `account_secrets` | on | — | — | — | — | denied | `:59-60` no policies: service-role only. Correct. |
| `metrics_daily` | on | owner via `owns_account` | — | — | — | denied | `:82` select-only. Correct. |
| `content` | on | owner via `owns_account` | — | — | — | denied | `:107` select-only. Correct. |
| `audience_snapshots` | on | owner via `owns_account` | — | — | — | denied | `:125` select-only. Correct. |
| `goals` | on | owner | owner | owner | owner | denied | `:140` `for all`. Acceptable. |
| `report_shares` | on | owner | **owner** | **owner** | **owner** | denied | `:155` `for all` — client can write arbitrary payloads |

**On the broad `grant all ... to anon, authenticated` (`:25-28`, re-asserted `:166-167`) — challenging `LAUNCH-AUDIT`'s framing.** It is *not* a live cross-tenant read hole. Every table has `enable row level security`, and Postgres RLS is default-deny: an operation with no matching policy is refused regardless of the `GRANT`. `anon` (`auth.uid()` null) fails every `using` clause. I could construct no path from position A or C to another tenant's rows through PostgREST. The real problem is different and worth stating precisely: `alter default privileges in schema pulseboard grant all on tables to anon, authenticated` (`:27`) means **every table added to this schema in the future is world-writable from the browser the instant someone forgets a single `enable row level security` line** — and that line is the only thing standing between the anon key and the data. Severity **P2 · CONFIRMED** as a latent footgun. Fix: grant `select, insert, update, delete` per table deliberately, never `all` and never via default privileges, and add a CI assertion that queries `pg_tables`/`pg_policies` for any table in `pulseboard` with `rowsecurity = false`.

**On `security definer` `owns_account` (`:63-66`).** Correct as written: it is `stable`, fully schema-qualifies `pulseboard.social_accounts`, pins `search_path`, and depends on `auth.uid()` so it returns false for `anon`. It is RPC-callable by anon via PostgREST (functions in an exposed schema get `execute` from `PUBLIC` by default) but yields no oracle — false for every input when unauthenticated. **P3** hygiene only: `revoke execute on function pulseboard.owns_account(uuid) from public, anon;` and pin `set search_path = pulseboard, pg_catalog, pg_temp`.

## S5a. `social_accounts` is client-writable, and `sync-cron` trusts it. **P1 · CONFIRMED (capability) / LIKELY (starvation mechanics)**

**Evidence** — `schema.sql:47-48` grants the client `for all` on `social_accounts`; `netlify/functions/sync-cron.ts:12-15` selects **every** row in the table with `status = 'connected'`, with no `limit`, no ordering and no per-user cap, then loops serially.

**Exploitation (position B → all tenants)**
1. Free signup. Using only the anon key and their own JWT, `POST /rest/v1/social_accounts` (schema `pulseboard`) with `{user_id: <self>, platform:'facebook', external_id:'x', username:'x', status:'connected'}`. The `with check (auth.uid() = user_id)` clause is satisfied — these are the attacker's own rows. Nothing caps how many.
2. Insert tens of thousands of them in bulk (PostgREST accepts array bodies).
3. At 06:00 UTC `sync-cron` pulls the table. Each junk row costs a `account_secrets` lookup that returns nothing, `_sync.ts:33` throws `"missing token"`, and `sync-cron.ts:25` regex-matches `/token/` and issues an `update` — so **two serial round trips per junk row**, before any real account is reached.
4. Two things then break for *other* tenants. The single serial loop blows the Netlify function execution limit, so real accounts at the tail never sync; and because the query is subject to PostgREST's default 1000-row ceiling (`LAUNCH-AUDIT.md#9`) with **no `order by`**, the returned window can consist entirely of attacker rows, silently excluding every genuine account.

**Impact** — a free account halts the daily sync for the whole platform, silently. No error surfaces to any tenant; their charts simply stop advancing, which is indistinguishable from the D1 defect already documented.

**Fix** — replace the `for all` policy with `for select` plus `for update (status)` scoped to the owner, and create rows only through the OAuth callbacks (service role). Additionally: enforce a per-user connected-account cap in the DB (a `check` via trigger, e.g. 25), page the cron with an explicit `order by id` and a keyset cursor, shard it, and skip accounts with no `account_secrets` row instead of writing to them.

## S5b. `report_shares` accepts arbitrary client-written payloads, bypassing `/api/share`. **P2 · CONFIRMED**

`schema.sql:155` gives the client `for all`, so `share.ts:39-45`'s `snapshot.v === 1` check and any future size/rate cap are optional — an authenticated attacker inserts directly via PostgREST with a slug **of their choosing** and a payload of unbounded size. Two consequences: (a) unbounded jsonb storage growth on the operator's Supabase plan from a free account; (b) the attacker gets to publish arbitrary text at `https://<site>/r/<chosen-slug>` — a page that carries the operator's brandmark and a "Read-only report" badge (`src/pages/SharedReport.tsx:28-32`) and needs no login. `ReportSheet` renders every field as a React text node so this is content spoofing, not XSS, but a report headed `scopeLabel: "ACTION REQUIRED: reconnect at …"` on the product's own domain is a credible phishing artefact.

**Fix** — `for select using (auth.uid() = user_id)` only; do all writes through `share.ts` with the service role. Add `expires_at`, a payload size cap enforced in the function, and a per-user creation rate limit.

---

# S6. Secrets

- **`OAUTH_STATE_SECRET` falls back to `"dev-insecure-secret"`.** `netlify/functions/_lib.ts:17`. If the env var is unset in Netlify, `signState`/`verifyState` are keyed with a value published in this public repo, so **anyone can forge a state carrying any `uid`** — which reduces S1 from "phish a state" to "mint one for any user id you can guess or read". `admin()` throws loudly when Supabase creds are missing (`:25-27`); the state secret silently degrades instead. **P0 · CONFIRMED (as a misconfiguration trap).** Fix: `if (!process.env.OAUTH_STATE_SECRET || length < 32) throw` at module load, same as `admin()`.
- **No secret has ever been committed.** `git log --all -p` grepped for `eyJ…` JWTs, `sk-ant-`, `EAA…` Meta tokens and service-role assignments: zero hits. Only `.env.example` with placeholders was ever added. `.gitignore:3-4` covers `.env` / `.env.local`. `dist/` is untracked. **Clean — recorded so it is not re-raised.**
- **Plaintext token columns** (`schema.sql:53`) — `LAUNCH-AUDIT#8` is correct and I will not re-derive it. One addition it misses: `_sync.ts` passes the access token in the **query string** of every Graph call (`:77,82,85,87,93,141,145,159,164,169,207`). Tokens in URLs are recorded by intermediaries, by Meta's own request logs, and by any error-reporting layer that captures request URLs; Meta's platform guidance is to send them as a header. **P2 · CONFIRMED.** Fix: send `Authorization: Bearer <token>` for Graph calls too (Graph accepts it), which also stops the token appearing in any future logging.
- **Rotation.** There is no rotation story for `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `TIKTOK_CLIENT_SECRET` or `OAUTH_STATE_SECRET`, and rotating `OAUTH_STATE_SECRET` silently invalidates in-flight OAuth flows (acceptable) while rotating the service-role key requires a Netlify redeploy with no dual-key window. **P3.** Document a rotation runbook; support two accepted state secrets (current + previous) so rotation is not a flow-breaking event.

## What each leaked artefact actually buys an attacker (position D)

| Artefact | Reach |
|---|---|
| anon key (`VITE_SUPABASE_ANON_KEY`, public in the bundle by design) | Nothing on its own — RLS denies `anon` on every table. Enables signup, hence position B. |
| a user JWT | That tenant's rows for the token's ~1 h life, **plus** minting an OAuth state for them (S1 reverse). Refresh token in `localStorage` is the durable prize, not the access token. |
| **service-role key** | Total: every tenant's rows **and every plaintext OAuth token in `account_secrets`** — i.e. live control of every connected influencer account. Single artefact, no second factor, no per-row encryption (S6 / `LAUNCH-AUDIT#8`), no audit trail to reconstruct what was taken (`LAUNCH-AUDIT#12`). |
| a database backup | Same as the service-role key minus the ability to write. Plaintext tokens make the backup a credential dump. |
| a Netlify build log | Build logs do not print env vars, but **function request logs record the full path including the query string**, and `/api/oauth-meta?token=<JWT>` (`src/pages/Connections.tsx:45`) puts user session JWTs there. Anyone with Netlify team read access harvests sessions. |

---

# S7. Identity: the README's "turn confirmation off" advice is an account-takeover switch. **P1 · CONFIRMED**

`README.md:35` — *"For a smoother demo you can turn Confirm email off"*, presented as a convenience with no warning.

**Exploitation (position A → C).** With confirmation disabled, Supabase creates a session for any email address on signup **without proving control of it**. Two concrete consequences beyond the obvious:
1. **Pre-registration squatting / takeover-on-arrival.** An attacker registers `finance@bigcreator.com` before the real owner does. When the real owner later signs up they hit "user already registered" and use password reset — but until then the attacker holds an account under a domain that other people, and the operator's support staff, will treat as that organisation's. Any invite/sharing feature added later inherits this.
2. **Impersonation inside the product.** `AuthContext.tsx:33-37` writes the signup `name` straight into `user_metadata.full_name` with no validation, and `AppLayout` renders it. Attacker signs up as `support@pulseboard.app` with display name "PulseBoard Support", creates a `report_shares` row (S5b) at `/r/<chosen-slug>`, and now has a plausible support identity plus a page on the product's own domain.
3. It also removes the only rate-limiting-by-inbox on account creation, which is what makes the S2 (`/api/ai` budget burn) and S5a (cron starvation) attacks cheap to parallelise across hundreds of accounts.

Correspondingly weak elsewhere in the identity stack, all **P2 · CONFIRMED**:
- **Password policy** is `minLength={6}` on the input element only (`src/pages/AuthPage.tsx:83`) — client-side, trivially bypassed by calling `supabase.auth.signUp` directly; the server-side floor is Supabase's default 6 characters with no complexity or breach-list check.
- **No MFA.** `supabase.auth.mfa` is not referenced anywhere in `src/`. For a product custodying tokens to high-value influencer accounts, password-only is the weakest link in the chain — an attacker who phishes one dashboard password inherits the tokens.
- **Account enumeration.** `AuthPage.tsx:42` renders Supabase's raw error text, which distinguishes "Invalid login credentials" from "User already registered". Fix: a single generic message for both paths.
- **Auth rate limiting** is whatever the Supabase project defaults to; nothing in this repo configures or asserts it, and there is no CAPTCHA (`supabase.auth` is called with no `captchaToken`). Enable Supabase's built-in CAPTCHA on signup and sign-in.

**Fix for the README specifically:** delete the suggestion, or replace it with "disable email confirmation only on a throwaway local project; never on a deployment anyone else can reach."

---

# S8. Transport and client-side posture. **P1 (aggregate) · CONFIRMED**

`netlify.toml` (20 lines, `:1-20`) sets **no headers block at all**. Consequences, in order of what they actually enable:

1. **No CSP + session tokens in `localStorage`.** `src/lib/supabase.ts:21` sets `persistSession: true`, whose default store is `localStorage`, holding both the access token and the **long-lived rotating refresh token**. With no `Content-Security-Policy`, any script that executes on the origin reads them and posts them anywhere. This is the payoff line for S9 (supply chain): one malicious transitive dependency in the frontend bundle exfiltrates every user's durable session — and via S1's reverse direction, their tenant. Fix: a strict CSP (`default-src 'self'; connect-src 'self' https://<project>.supabase.co; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`), and move the session to a cookie-backed store if you can accept the ergonomics.
2. **No `frame-ancestors` / `X-Frame-Options`.** The whole dashboard is framable, including `/connections` with its Connect and Disconnect buttons — clickjacking a user into starting an OAuth flow or into disconnecting an account.
3. **No HSTS.** Netlify redirects to HTTPS, but without `Strict-Transport-Security` the first request of a session is downgradeable on a hostile network — and the request the app makes with the JWT in the URL (`Connections.tsx:45`) is exactly the one you do not want in cleartext.
4. **No `Referrer-Policy`.** Correcting `LAUNCH-AUDIT#6`: browsers propagate the *original* referrer through a 302, so `/api/oauth-meta?token=…` is **not** sent to facebook.com in the `Referer` header — that part of the earlier finding is overstated. The real leak paths for that JWT are browser history, Netlify's function request log, and any TLS-terminating corporate proxy. The finding's severity stands; its mechanism does not. Set `Referrer-Policy: strict-origin-when-cross-origin` anyway and get the token out of the URL.
5. **No `X-Content-Type-Options: nosniff`, no `X-Robots-Tag` on `/r/*`.** `index.html` has no `<meta name="robots">` and there is no `public/robots.txt` (checked — the directory does not exist), so every share link a customer sends is indexable the moment it appears in any crawled page or a Chrome address bar. Fix: `[[headers]] for = "/r/*"` with `X-Robots-Tag = "noindex, nofollow"` plus `Cache-Control: private, no-store` on `/api/share`.

**What the share link actually exposes — correcting `LAUNCH-AUDIT#10`.** That finding says the payload "includes audience demographics derived from Platform Data." It does not. `src/lib/snapshot.ts:14-25,66` shows the payload carries headline totals and trends, per-platform follower/reach/view/engagement counts, the **top ten post titles** (verbatim captions), best-posting-window *labels* (derived from `active_hours`, but no age/gender/country breakdown), and anomaly dates. Age, gender and country never enter the snapshot. The exposure is still commercially sensitive — follower counts, engagement rates and content performance for a creator, permanently public at a URL with no expiry, no revocation and no owner-facing list — but the demographics claim should be dropped so the fix is scoped correctly.

---

# S9. Supply chain. **P2 · CONFIRMED**

`npm audit`: **6 vulnerabilities (2 high, 4 moderate)**. Lockfile is v3, all 141 packages resolve to `registry.npmjs.org`, and **every entry carries an `integrity` hash** (verified programmatically — 0 missing). No install scripts from unknown publishers. That part is healthy.

| Package | Installed | Advisory | Real reach here |
|---|---|---|---|
| `nanoid` 3.3.16 | high | GHSA-2v37-7h3g-55p8 — infinite loop when `size` is 0 | Transitive via postcss/vite, **build-time only**. Not reachable at runtime. |
| `esbuild` 0.21.5 | moderate | GHSA-67mh-4wv8-2f99 — any website can read the dev server's responses | **Dev only**, but genuinely serious for a developer running `npm run dev`/`netlify dev` with `.env.local` loaded: a malicious page read in the same browser can pull source and, via the dev server proxy, whatever the functions return. Fix by upgrading. |
| `react-router` / `react-router-dom` 6.30.4 | moderate ×2 | GHSA-wrjc-x8rr-h8h6 (open redirect via backslash in `<Link>`/`useNavigate`); GHSA-337j-9hxr-rhxg (constructor injection in `deserializeErrors`) | **Not exploitable as written.** Every `nav()`/`<Navigate>` call site takes a hard-coded literal (`CommandPalette.tsx:42,65`, `AppLayout.tsx:85,88,153`, `App.tsx:50`) — no user input reaches a route target; and the SSR hydration path does not exist in this SPA. Patch anyway so a future dynamic route does not silently inherit it. |
| `postcss` 8.5.20 | moderate | GHSA-fxqj-rqcc-2cmp — `sourceMappingURL` path traversal | Build-time only. |

**What a compromised dependency reaches** — the honest answer, and it is the reason to care: nothing in the *runtime* set is currently vulnerable, but `vite`/`esbuild`/`postcss` execute with full filesystem and network access **during the Netlify build**, in a process whose environment holds `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `TIKTOK_CLIENT_SECRET` and `ANTHROPIC_API_KEY` (they are set at the site level, so the build step sees them all — `README.md:56-69`). A single malicious postinstall or build-time transitive package exfiltrates every secret the platform has, in one step. Separately, a compromised *frontend* dependency lands in the bundle and, with no CSP (S8), harvests every user's `localStorage` session.

**Fix** — `npm audit fix` (non-breaking for nanoid/postcss/react-router; vite/esbuild needs the major bump, do it). Then: pin exact versions, enable `npm ci --ignore-scripts` in the build where possible, scope build-time env vars so the build step cannot see runtime function secrets (Netlify supports per-context/per-scope variables — set the backend secrets to Functions scope only), and add Dependabot plus `npm audit --audit-level=high` as a failing CI gate.

---

# S10. Abuse economics — what one free account does to everyone else. **P1 · CONFIRMED**

Three shared, finite resources, none of them metered per tenant:

1. **The Meta / TikTok app-level rate quota is shared across every user of the app.** `/api/sync` (`netlify/functions/sync.ts`) has no server-side throttle, no `last_synced_at` minimum interval and no concurrency cap; the UI's disabled button (`Connections.tsx:108`) is the only brake and a `curl` loop ignores it. Each call is roughly 9 Graph requests per connected account (`_sync.ts:77,82,85,87,93,141,145` for IG alone). An attacker with one connected sandbox account issues thousands of syncs per minute and drives the **app-wide** `X-App-Usage` to 100%; Meta then throttles or blocks the app, and **every other tenant's data stops flowing**. Nothing reads the usage headers or backs off (`LAUNCH-AUDIT#9` established the absence; the cross-tenant weaponisation is the part to act on). Fix: enforce a per-account minimum sync interval server-side against `social_accounts.last_synced_at` before doing any work, a per-user requests-per-hour ceiling, a global in-flight cap, and read `X-App-Usage` / `X-Business-Use-Case-Usage` and pause at 75%.
2. **The Anthropic budget** — see S2. Uncapped, and exhausting it disables the Assistant for all tenants.
3. **Netlify function minutes and the daily cron** — see S5a. Junk `social_accounts` rows both burn build/function minutes and starve the shared cron.

The common root is that **every expensive endpoint treats "is a valid Supabase user" as sufficient authorisation**, and self-service signup makes that predicate free. Fix at the root: a shared rate-limit/quota table keyed by `user_id` consulted by `sync.ts`, `ai.ts` and `share.ts` before doing any paid work, plus per-user caps on connected accounts and share links.

---

# S11. Smaller items

- **`javascript:` permalinks. P3 · UNVERIFIED-but-cheap-to-fix.** `src/pages/Content.tsx:80` renders `<a href={c.permalink}>` and `src/components/CommandPalette.tsx:65` calls `window.open(c.permalink)` with a value taken verbatim from the platform API (`_sync.ts:100` IG `permalink`, `:174` FB `permalink_url`, `:245` TikTok `share_url`). React does **not** sanitise `href`, so a `javascript:` value would execute on click. The value is platform-generated, so position E does not control it today; the exposure is one platform API bug or one response-tampering position away, and with no CSP (S8) the payload would reach `localStorage`. Fix: validate the scheme is `https:` before rendering, and drop the link otherwise. One line.
- **Error reflection into a redirect URL. P3 · CONFIRMED.** `_lib.ts:75-78` `backToApp` encodes provider error text into `?error=`; `oauth-meta-callback.ts:9,24,65` and `oauth-tiktok-callback.ts:7,30,54` feed it raw provider messages and raw exception messages. `Connections.tsx:32` renders it in a toast (React-escaped, so no XSS, and the URL host is fixed so no open redirect — `LAUNCH-AUDIT#P3` is right about the smell but the impact is limited to information disclosure). The concrete leak: a thrown exception message can carry internal detail — including, from a `fetch` failure inside `_sync`-style code, the request URL, which is where the access tokens live (S6). Fix: map to opaque codes (`bad_state`, `exchange_failed`) and log the detail server-side only.
- **`sync-cron` HTTP reachability — checked, NOT a defect (but brittle). P3 · CONFIRMED.** `sync-cron.ts:8-10` comments "no HTTP auth needed (internal)" and the handler has genuinely zero authentication. I checked whether the `schedule()` wrapper provides any: it does not — `node_modules/@netlify/functions/dist/lib/schedule.js` is literally `var schedule = (cron, handler) => handler;`, a runtime no-op, with the cron extracted at deploy time. The protection is entirely at the Netlify platform layer, which does not publish an HTTP URL for scheduled functions, so `/api/sync-cron` and `/.netlify/functions/sync-cron` are not reachable from position A. So this is safe **today**, purely by deployment convention. It is one refactor away from being a full-platform, unauthenticated Meta-quota bomb (S10) — if anyone unwraps `schedule()` to make the job manually triggerable, or the `/api/*` splat in `netlify.toml:12-15` behaves differently on a future platform version. Fix: add a shared-secret header check inside `run()` regardless, so the guarantee lives in the code rather than in Netlify's routing table.
- **No `Cache-Control` on `/api/share`** (`_lib.ts:70-72` `json()` sets only `content-type`). A shared/CDN cache could retain a report snapshot. Add `Cache-Control: private, no-store`. **P3.**

---

# S12. AuthN/AuthZ matrix — every Netlify Function

| Function | Who can call it | What is verified | What is missing |
|---|---|---|---|
| `oauth-meta.ts` | anyone holding **any** valid Supabase JWT | `userIdFromToken(query.token)` `:9-11` | JWT is in the **URL**, not a header (history/log leak); no browser-binding nonce issued (**S1**); no rate limit |
| `oauth-meta-callback.ts` | **anyone on the internet** with a valid-HMAC state | HMAC + 15-min TTL only (`_lib.ts:49-65`) | Not single-use, not replay-protected, not bound to the completing browser; does not check whether the incoming Facebook identity belongs to `state.uid` (**S1 — P0**) |
| `oauth-tiktok.ts` | any valid JWT | same as meta | same as meta |
| `oauth-tiktok-callback.ts` | **anyone on the internet** | same as meta callback | same (**S1**) |
| `sync.ts` | any authenticated user | `POST` + bearer JWT `:10-12`; accounts scoped by `user_id` `:18` — **tenant isolation here is correct** | no rate limit, no `last_synced_at` throttle, no per-user cap (**S10**) |
| `sync-cron.ts` | Netlify scheduler only (platform-enforced, not code-enforced) | **nothing** | no in-code auth; unbounded, unordered, unpaged query over all tenants (**S5a, S11**) |
| `ai.ts` | any authenticated user | bearer JWT `:21`; `ANTHROPIC_API_KEY` present `:24` | `uid` is checked and then **never used** — the system prompt and the whole conversation come from the request body (**S2 — P1**); no quota |
| `share.ts` GET | **anonymous, by design** | slug lookup only `:19-28` | no expiry, no revocation, no rate limit, no `noindex`, no cache header (**S8**) |
| `share.ts` POST | any authenticated user | bearer JWT `:32`; `snapshot.v === 1` `:40` | validation is bypassable entirely via direct PostgREST writes (**S5b**); no size cap, no per-user limit |

Note the shape of the whole table: **`uid` is used for tenant scoping in exactly one place (`sync.ts:18`)**. Everywhere else authentication is a turnstile — it proves *someone* is signed in, and then the request body or the signed state decides what happens. That is the single structural weakness behind S1, S2 and S10.

---

# Ranked summary

| # | Finding | Sev | Conf |
|---|---|---|---|
| S1 | OAuth state is replayable and not browser-bound → attacker captures a victim's Page/IG tokens into the attacker's tenant | **P0** | CONFIRMED |
| S6a | `OAUTH_STATE_SECRET` silently defaults to `"dev-insecure-secret"` — forgeable state for any uid | **P0** | CONFIRMED |
| S2 | `/api/ai` system prompt is client-supplied — free Claude proxy + budget DoS on the org key | **P1** | CONFIRMED |
| S5a | Client-writable `social_accounts` + unbounded unordered cron query → one free account starves every tenant's daily sync | **P1** | CONFIRMED |
| S7 | README tells operators to disable email confirmation → identity squatting, impersonation, free attacker accounts at scale | **P1** | CONFIRMED |
| S8 | No CSP/HSTS/frame-ancestors/Referrer-Policy + session tokens in `localStorage` | **P1** | CONFIRMED |
| S10 | No per-tenant quota on any expensive endpoint; shared Meta quota, Anthropic budget and cron are all burnable | **P1** | CONFIRMED |
| S3 | Caption-borne prompt injection into the Assistant (agency/multi-admin case only; no tools, no XSS) | **P2** | LIKELY |
| S5 | `alter default privileges … grant all to anon, authenticated` makes any future table world-writable on one forgotten RLS line | **P2** | CONFIRMED |
| S5b | `report_shares` client-writable — arbitrary payloads and chosen slugs published on the app's own domain | **P2** | CONFIRMED |
| S6b | Access tokens sent in Graph API **query strings** | **P2** | CONFIRMED |
| S7b | Password floor 6 chars client-side only; no MFA; account enumeration; no CAPTCHA | **P2** | CONFIRMED |
| S9 | 6 npm advisories; build process sees every runtime secret | **P2** | CONFIRMED |
| S11 | `javascript:` permalink not scheme-checked; provider errors reflected into redirects; `owns_account` executable by anon; no cache headers on `/api/share`; `sync-cron` unauthenticated in code | **P3** | mixed |

## Corrections to the two earlier passes
- `LAUNCH-AUDIT#6` — the session JWT does **not** leak to facebook.com via `Referer` (browsers carry the original referrer through a 302). It leaks via history, Netlify request logs and TLS-terminating proxies. Severity stands, mechanism does not.
- `LAUNCH-AUDIT#10` — the share payload contains **no** audience demographics (`src/lib/snapshot.ts:14-25`). It contains totals, per-platform counts, ten verbatim post captions, best-window labels and anomaly dates.
- `LAUNCH-AUDIT#P3` "grant all" concern — not a live cross-tenant read path; RLS is default-deny and every table has it enabled. The real risk is the *default privileges* clause, which is forward-looking.
- `DATA-INTEGRITY#D5` — correct, and I verified the formula-injection class does **not** extend to the printable report or the share page (both render through React text nodes).
- Neither pass identified S1, S2, S5a, S5b or S6a, which are the findings that matter most for the stated threat model.

## Sequencing
1. **Before anything else:** fail-closed on `OAUTH_STATE_SECRET`; make OAuth state single-use and cookie-bound (S1, S6a). Until this lands, one phishing link takes a creator's Page and Instagram tokens.
2. **Before real accounts:** build the AI summary server-side and quota it (S2); tighten the three `for all` RLS policies to `for select` and move writes to the service role (S5a, S5b); add the headers block (S8); delete the README's confirmation-off advice (S7).
3. **Before scale:** per-tenant rate limits on sync/ai/share (S10); `npm audit fix` and scope build-time secrets (S9); token encryption at rest (`LAUNCH-AUDIT#8`).
