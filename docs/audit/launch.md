# R2 Launch Procedure Audit — PulseBoard

Started 2026-08-23. Appending continuously.

## Scope & method

Followed README.md §1–§5 step by step as an operator would, cross-checking every instruction
against `supabase/schema.sql`, `netlify/functions/*`, `src/lib/setupGuides.ts`,
`src/pages/Connections.tsx`, `src/pages/AuthPage.tsx`, `.env.example`, `netlify.toml`.
Prior passes: `docs/LAUNCH-AUDIT.md`, `docs/DATA-INTEGRITY.md`, `docs/JORDAN-CONTEXT.md`.
No repo file modified. `npm run build` run once; `dist/` is gitignored (`.gitignore:2`).

Severity: P0 blocks launch · P1 before any real client account connects · P2 before scale · P3 hardening.
Confidence: CONFIRMED (read in this repo / reproduced) · LIKELY · UNVERIFIED.

---

# 1. Following the README end to end

## L1. §1.2 "run the whole of supabase/schema.sql" is not a migration strategy — the 2nd and 3rd edits silently do nothing. P0, CONFIRMED.

`supabase/schema.sql` is built almost entirely from `create table if not exists`
(lines 31, 51, 69, 86, 111, 129, 147) and `create index if not exists` (159-162).

Re-running it is *safe* but not *effective*:
- **Tables**: `if not exists` means any added column, changed `check` constraint, changed
  default or changed `unique(...)` in a later edit is **never applied** to an existing
  project. The script returns "Success. No rows returned" and the operator believes the
  migration landed. The app then fails at runtime with PostgREST `PGRST204` ("column not
  found in schema cache") — at sync time, in a serverless function, on a client's account.
  Concretely: adding the `expires_at` column to `report_shares` that LAUNCH-AUDIT §10
  requires, or the `token_ciphertext`/`timezone_id` columns that §8 and D2 require, will
  appear to succeed and will not exist.
- **Policies**: genuinely idempotent (`drop policy if exists` + `create policy`,
  lines 46-48, 81-83, 106-108, 124-126, 139-141, 154-156). Good.
- **Function**: `create or replace` (line 63). Idempotent.
- **Grants**: idempotent, but re-running line 166-167 *re-grants* anything a later hardening
  step revoked — so a hand-run of the script silently undoes manual privilege tightening.
- **`create schema if not exists`** (line 20): idempotent.

So the script is idempotent in the "won't error" sense and **not** idempotent in the
"converges the database on the file" sense. That distinction is the whole risk.

**Corrected step for README §1.2:**
> 2. Open **SQL Editor** and run `supabase/schema.sql`. This script only ever *creates* —
>    it cannot alter an existing table. From this point on, never edit `schema.sql` to change
>    an existing table: add a numbered file under `supabase/migrations/NNN_*.sql` containing
>    the explicit `alter table` and run those in order. Record the highest applied migration
>    number in a `pulseboard.schema_version` table so the next operator can tell what a
>    project is on. Verify after every run with
>    `select column_name from information_schema.columns where table_schema='pulseboard' and table_name='<t>';`

## L2. §1 "Exposed schemas" — the README does not mention the step at all, and the step it omits is the one that grants `anon` reach into the data. P1, CONFIRMED.

The requirement is buried in a SQL comment (`schema.sql:13-17`) that the README never
repeats. README §1.2 says only "run the whole of `supabase/schema.sql`". An operator who
follows the README literally gets `PGRST106 "schema must be one of ..."` on first sign-in
and has no idea why. This is the single most likely place for the launch to stall.

What adding `pulseboard` to Exposed schemas actually exposes: **every table in the schema
becomes reachable over the public PostgREST endpoint by anyone holding the anon key** —
which is shipped in the browser bundle by design. What stops them reading rows is RLS
*alone*. In this schema that holds up today:
- `account_secrets` — RLS on, **zero policies** (`schema.sql:59-60`) → no anon/authenticated
  access at all. Correct.
- `metrics_daily` / `content` / `audience_snapshots` — RLS on, **SELECT-only** owner policies
  (82, 107, 125) → reads gated, writes blocked (no policy = deny).
- `social_accounts` / `goals` / `report_shares` — `for all` owner policies.

But the safety margin is thinner than it looks, because of L3.

**Corrected step for README §1, insert as new step 3:**
> 3. **Project Settings → API → Exposed schemas**: add `pulseboard` alongside `public` and
>    `graphql_public`, then Save. Without this every query returns `PGRST106`. Note that this
>    publishes the whole `pulseboard` schema on the public REST endpoint — the anon key in the
>    browser can reach it, and only row-level security stands between a stranger and the rows.
>    Before going live run the RLS smoke test in the pre-launch checklist below.

## L3. `grant all ... to anon` plus `alter default privileges ... to anon` makes any future table world-writable the moment someone forgets one line. P1, CONFIRMED.

`schema.sql:24-28` and again `166-167`:
```
grant all on all tables in schema pulseboard to anon, authenticated, service_role;
alter default privileges in schema pulseboard grant all on tables to anon, authenticated, service_role;
```
`anon` is granted `all` (select/insert/update/delete/truncate/references/trigger) on every
present and **future** table in the schema. The only thing preventing an unauthenticated
internet caller from truncating `metrics_daily` is that RLS is enabled with restrictive
policies. Any future `create table` in this schema that omits
`enable row level security` — one forgotten line in a hand-run script with no CI — is
immediately readable and writable by anyone with the anon key.

`anon` needs **no** grants here at all: every policy in the file keys off `auth.uid()`, which
is null for `anon`, so `anon` can never match a row anyway.

**Corrected grants:**
```sql
grant usage on schema pulseboard to authenticated, service_role;
grant select, insert, update, delete on all tables in schema pulseboard to authenticated;
grant all on all tables in schema pulseboard to service_role;
alter default privileges in schema pulseboard grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema pulseboard grant all on tables to service_role;
-- no grants to anon; revoke any that exist:
revoke all on all tables in schema pulseboard from anon;
revoke usage on schema pulseboard from anon;
```
(The public share page does not need anon table access — `share.ts` reads with the service
role, exactly as `schema.sql:144-146` says.)

## L4. §2.1 "Business type" — the app-type step is out of date. P2, LIKELY.

README §2.1 and `setupGuides.ts:35` both say "Create an app … **Business** type". Meta's
current dashboard asks you to pick one or more **use cases** first, with app type derived
(the "Other" path is what surfaces the classic type picker)
(https://developers.facebook.com/docs/development/create-an-app/). An operator looking for a
"Business" radio button in 2026 will not find the screen the README describes.

**Corrected step:**
> 1. Create an app at developers.facebook.com/apps. When asked what you want your app to do,
>    choose the use case that offers **Facebook Login** + Page/Instagram access (or pick
>    **Other → Business** to get the classic type picker). The end state you need is a
>    **Business**-type app connected to a Meta **Business Portfolio** — connect the portfolio
>    on App Dashboard → Settings → Basic before requesting any permission, because Business
>    Verification is attached to the portfolio, not the app.

## L5. §2.2 "Add the Facebook Login and Instagram Graph API products" — both product names are stale. P1, LIKELY.

- "Instagram Graph API" is no longer the product name; Instagram integrations are now under
  the **Instagram** product, split into *Instagram API with Facebook Login* (what this code
  actually uses — Page-linked, `/{ig-user-id}/insights`) and *Instagram API with Instagram
  Login*. The Basic Display API was shut down 4 Dec 2024
  (https://www.keyapi.ai/blog/instagram-basic-display-api/).
- For a server-side app custodying other people's business assets, Meta now steers you to
  **Facebook Login for Business**, not consumer Facebook Login
  (https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business).
  This matters because Login for Business is what produces the business-scoped, longer-lived
  tokens and the asset-selection dialog this product needs (see O4 — no Page chooser today).

**Corrected step:**
> 2. Add the **Facebook Login for Business** product and the **Instagram** product, and under
>    Instagram choose **API setup with Facebook login** (the Page-linked path — this is what
>    PulseBoard's code calls). "Instagram Graph API" and "Instagram Basic Display" no longer
>    exist as products.

## L6. §2.3 redirect URI — incomplete and will fail on first attempt. P2, CONFIRMED.

README §2.3 gives one URI: `https://YOUR-SITE.netlify.app/api/oauth-meta-callback`. But
README §Local development tells the operator to run `npx netlify dev` on
`http://localhost:8888`, and `_lib.ts:12` builds the redirect from `VITE_SITE_URL`, so the
local flow sends `http://localhost:8888/api/oauth-meta-callback` — which is not registered,
producing Meta's opaque "URL blocked" error. Also unmentioned: Netlify **deploy previews**
get `https://<hash>--site.netlify.app` origins that will never match, and a custom domain
later needs adding.

**Corrected step:**
> 3. Facebook Login for Business → Settings → **Valid OAuth Redirect URIs**: add *both*
>    `https://YOUR-SITE.netlify.app/api/oauth-meta-callback` and, for local work,
>    `http://localhost:8888/api/oauth-meta-callback`. They must match byte for byte including
>    scheme and trailing path. Deploy-preview URLs will not match — do OAuth testing only on
>    the production URL or on localhost. Add your custom domain's URI on the day you cut over,
>    *before* changing `VITE_SITE_URL`.

## L7. §2.5 permission list is wrong in two directions. P1, CONFIRMED (code) / LIKELY (review impact).

README §2.5 lists six permissions; `oauth-meta.ts:15-23` actually requests seven (it adds
`public_profile`); `setupGuides.ts:50` advertises a third, shorter list (three permissions);
and `setupGuides.ts:75` a fourth (two). **Four different permission lists across the repo.**

- `business_management` (`oauth-meta.ts:22`) is requested but nothing in `_sync.ts` calls a
  Business Manager endpoint. It drags in Business Verification and a much harder review, and
  widens the blast radius of a stolen token. (LAUNCH-AUDIT §11.)
- `public_profile` is granted automatically and does not need requesting.
- Missing and now required for the Instagram side: the Instagram product's own permissions.
  Requesting `instagram_basic`/`instagram_manage_insights` without the Instagram product
  configured is a common rejection.

**Corrected step:**
> 5. Request exactly: `pages_show_list`, `pages_read_engagement`, `read_insights`,
>    `instagram_basic`, `instagram_manage_insights`. Do **not** request `business_management`
>    or `public_profile`. Then submit for App Review — required before any account other than
>    an app role-holder can connect. Advanced Access to other people's data additionally
>    requires **Business Verification**, the annual **Data Use Checkup**, and — because this
>    app stores Platform Data server-side — a **Data Protection Assessment**. Budget weeks.
>    (See LAUNCH-AUDIT §5: the privacy / terms / data-deletion artefacts App Review demands
>    do not exist in this repo, so §2.5 as written cannot be completed today.)

## L8. §2 omits "Require App Secret", and turning it on breaks the app. P1, CONFIRMED.

Nowhere does the README mention App Dashboard → Settings → Advanced → **Require App Secret**
/ `appsecret_proof`. LAUNCH-AUDIT §7 confirms no Graph call in `netlify/functions/_sync.ts`
sends `appsecret_proof`. So the correct security setting for a server-side app custodying
influencer tokens is one the operator must be told *not* to enable until the code is fixed —
otherwise every sync starts failing after launch with no obvious cause.

**Corrected step — add to §2:**
> 7. **Do not yet enable** Settings → Advanced → *Require App Secret*. PulseBoard does not
>    currently send `appsecret_proof`, so enabling it makes every Graph call fail. Add
>    `appsecret_proof` to `_sync.ts` (LAUNCH-AUDIT §7) and then enable it — for a server-side
>    app holding other people's tokens it should be on.

## L9. §2 pins a dead API version and the README never says which version to use. P0, CONFIRMED (inherited).

`_sync.ts:3` and `oauth-meta-callback.ts:37` pin `graph.facebook.com/v19.0`;
`oauth-meta.ts:25` pins the `v19.0` login dialog. v19.0 expired 21 May 2026 — **three months
ago as of today**. Following the README end to end today produces an app where every single
Graph call errors. The README's §2 gives no version guidance at all, so an operator has no
signal that this is the problem. (LAUNCH-AUDIT §1; v22.0 changelog is the current reference
point for the metric removals in §2.)

**Corrected step — add to §2 and to the deploy checklist:**
> Before deploying, confirm the Graph version in `netlify/functions/_sync.ts`,
> `oauth-meta.ts` and `oauth-meta-callback.ts` is a **currently supported** version
> (v25.0 as of Feb 2026 — skip v20.0, which expires 24 Sep 2026). Move it to one exported
> constant with an env override, and diarise a bump at each version's release + 18 months.

## L10. §2.6 "Instagram must be a Business/Creator account linked to a Facebook Page" is correct but incomplete. P2, CONFIRMED.

True and still required. But it omits the two things that most often make the Audience page
stay blank after a technically successful connect: IG `follower_demographics` needs roughly
100 followers, and the account must have been converted long enough for insights to exist.
`setupGuides.ts:76` states the 100-follower limit; the README does not — so the operator
reading only the README will diagnose an empty Audience page as a bug.

## L11. §3 TikTok steps miss the two things that actually block a TikTok launch. P1, LIKELY.

README §3 (and `setupGuides.ts:84-94`) list app creation, Login Kit, scopes, redirect URI,
review. Missing:
- **`video.list` is a scope that requires review with a working demo video**, and TikTok's
  audit is stricter than Meta's about the app being fully functional at submission time.
- **Sandbox vs production**: TikTok's sandbox only serves data for accounts explicitly added
  to the sandbox — the same trap as Meta dev mode (see O1).
- **Token lifetime is 24 hours** (`expires_in` 86400) and there is **no refresh code in this
  repo** (LAUNCH-AUDIT §3). So even a fully approved TikTok integration breaks daily and
  README §3 gives the operator no warning.
- **Jordan**: JORDAN-CONTEXT §5 flags that TikTok's country restrictions on *developer app
  registration* are not publicly documented and this is the one item that could be a hard
  blocker rather than a delay. The README should say so.

**Corrected step — add to §3:**
> 5. Note before you start: TikTok access tokens expire after **24 hours**. PulseBoard does
>    not refresh them (see LAUNCH-AUDIT §3), so until refresh is implemented every TikTok
>    connection dies daily and the client is asked to re-authorise. Do not connect a client's
>    TikTok account before that is fixed.
> 6. Confirm with TikTok that a **Jordan-registered developer account** can create a
>    production app before committing to a TikTok timeline.

## L12. §5 Deploy is missing every guardrail. P1, CONFIRMED.

README §5 is four sentences: import from Git, build `npm run build`, publish `dist`, set env
vars, deploy. Absent:
- **which branch**. `netlify.toml` sets none. Importing today would build
  `claude/analysis-35bck4` or whatever is default — the audit branch.
- **the scheduled function**. `sync-cron.ts:34` registers `schedule("0 6 * * *")`. The README
  never tells the operator to verify it appears under Netlify → Functions → Scheduled, or
  that 06:00 UTC = **09:00 Amman** (JORDAN-CONTEXT §2).
- **region**. JORDAN-CONTEXT §3: Supabase and Netlify default to US regions and under
  Jordan's PDPL region choice is a compliance decision. Must be chosen deliberately at
  project-creation time — Supabase region **cannot be changed** after creation without a
  migration.
- **`VITE_SITE_URL` must be set before the first deploy**, because `_lib.ts:75`
  (`backToApp`) falls back to `""` and would redirect OAuth callbacks to a relative URL.
- **no security headers** in `netlify.toml` (LAUNCH-AUDIT P3).
- **deploy previews are public by default** and will carry production env vars — anyone with
  a preview URL gets a fully-functional instance pointed at the production database.

**Corrected §5:**
> ### 5. Deploy
> 1. Choose your Supabase **and** Netlify regions deliberately and record the reason
>    (PDPL cross-border transfer — see docs/JORDAN-CONTEXT.md §3). Supabase's region is fixed
>    at project creation.
> 2. Netlify → Add new site → Import from Git. Set **Production branch = `main`**. Build
>    `npm run build`, publish `dist`, functions auto-detected.
> 3. Set every variable from §4 in Netlify → Site configuration → Environment variables,
>    scoped to **Production only** (not Deploy previews / Branch deploys), *before* the first
>    build. Netlify's *All scopes* default hands production secrets to every preview build.
> 4. Set **Deploy previews to "Private"** (or disable them) — a public preview is a live
>    instance of your app against the production database.
> 5. Deploy, then verify: `/` loads, `Functions → Scheduled` lists `sync-cron` at `0 6 * * *`
>    (= 09:00 Amman), and `curl -i https://YOUR-SITE/api/sync` returns 405 (proving the
>    `/api/*` redirect in `netlify.toml` resolves to the function and not the SPA fallback).
> 6. Add security headers to `netlify.toml` before any client connects (LAUNCH-AUDIT P3).

---

# 2. Dangerous advice in the documentation

## D-A. README §1.4 "For a smoother demo you can turn *Confirm email* off". P0, CONFIRMED.

Verbatim: `README.md:35`. In a production multi-tenant system that custodies platform tokens
for high-value influencer accounts, the concrete consequences are:

1. **Anyone can create a workspace under any email address, including a client's.** With
   confirmation off, Supabase implicitly marks the address confirmed at signup
   (https://supabase.com/docs/guides/auth/general-configuration). `AuthPage.tsx:70-90` +
   `AuthContext.tsx:33-38` call `supabase.auth.signUp` with no other gate, no allowlist, no
   invite. The site is public. So the tenant boundary — which is `auth.uid()`, the sole basis
   of every RLS policy in `schema.sql` — is now anchored to an unverified string.
2. **Password reset becomes the takeover primitive.** The account is confirmed but the
   address was never proven to belong to the signer. If the real owner of that address later
   requests a password reset, they take over an existing workspace; conversely an attacker who
   pre-registers a client's address owns the workspace that client is later told to sign in to.
   Whoever holds the workspace can start an OAuth flow (`Connections.tsx:37-46`) and cause the
   backend to store live Page tokens under their `user_id`.
3. **No recovery, because there is no email trust anywhere.** There is no email-change
   verification path in this app, no MFA, no admin console, no audit log (LAUNCH-AUDIT §12).
   Once a workspace is wrong there is no way to detect or unwind it.
4. **Unbounded free signup against a service-role backend.** Every signup can call
   `/api/sync` and `/api/ai`. `/api/ai` spends the operator's `ANTHROPIC_API_KEY`;
   `/api/sync` spends the Meta app's *shared, app-level* rate budget
   (LAUNCH-AUDIT §9) — so an anonymous signup can degrade every real client's sync.
5. **Compliance.** Under Jordan's PDPL (JORDAN-CONTEXT §3) the operator is the controller for
   these accounts; "we could not verify who created the account" is not a defensible position
   for a data-subject complaint, and it makes the deletion obligation unimplementable.
6. **Duplicate-signup ambiguity.** Supabase deliberately returns a *successful-looking*
   response for a signup on an existing address to prevent enumeration
   (https://github.com/orgs/supabase/discussions/29327). `AuthPage.tsx:36` then shows
   "Account created. If email confirmation is on, check your inbox, then sign in." — so a
   client whose address is already taken by someone else is told their account was created,
   then cannot sign in, with no explanation.

**Corrected README §1.4:**
> 4. **Authentication → Providers → Email**: enable it and **leave "Confirm email" ON**.
>    Turning it off means anyone on the internet can create a workspace under any address,
>    including a client's, and the address is implicitly treated as verified — the tenant
>    boundary in `schema.sql` is `auth.uid()` and nothing else. Configure the SMTP sender
>    (Authentication → Emails) before launch; the built-in Supabase sender is rate-limited to
>    a handful of messages an hour and is not for production.
> 5. **Authentication → URL Configuration**: set Site URL to your production origin and add
>    only that origin to Redirect URLs, so confirmation links cannot be pointed elsewhere.
> 6. Before real clients: restrict who can sign up at all. Either disable open signup
>    (Authentication → Providers → Email → *Allow new users to sign up* = off) and create each
>    client's workspace yourself, or gate signup behind an invite. This is a client-custody
>    product, not a self-serve one.
> 7. Set a real password policy (Authentication → Policies: minimum 12 characters + leaked-
>    password protection). `AuthPage.tsx:83` currently enforces `minLength={6}` client-side.

## D-B. "Password: At least 6 characters" is the only strength requirement. P1, CONFIRMED.

`AuthPage.tsx:83` — `minLength={6}`, no server-side policy configured anywhere in the setup
guide. Six characters guards a workspace holding live Facebook Page tokens. Supabase's own
minimum default is 6; the README never tells the operator to raise it or enable HIBP leaked-
password protection. See corrected step 7 above.

## D-C. `OAUTH_STATE_SECRET` "any long random string" — and the code has an insecure default. P0, CONFIRMED.

`README.md:68` describes it as "any long random string" with no warning. `.env.example:28`
ships the literal placeholder `change-me-to-a-long-random-string`. And `_lib.ts:17`:
```ts
STATE_SECRET: process.env.OAUTH_STATE_SECRET ?? "dev-insecure-secret",
```
If the operator forgets this one variable in Netlify, **nothing breaks and nothing warns** —
OAuth works perfectly, signed with a secret that is published in this repository. Anyone who
reads the repo can then mint a valid `state` for an arbitrary `uid`
(`_lib.ts:44-48`, `signState({uid, provider})`) and drive `oauth-meta-callback.ts:80` into
calling `saveAccount(db, state.uid, ...)` — i.e. **attach a victim's freshly-authorised Page
tokens to the attacker's workspace, or their own account to a victim's workspace**. This is
the account-takeover JORDAN-CONTEXT §6 refers to, and its trigger is a *missing environment
variable*, not a bug.

Contrast the neighbouring handling: `admin()` (`_lib.ts:25-27`) *throws* when Supabase creds
are missing, and `oauth-meta.ts:12` returns `meta_not_configured` when the app id is missing.
Only the security-critical secret fails open.

**Fix (code):** delete the fallback — `if (!process.env.OAUTH_STATE_SECRET) throw new Error(...)`,
and reject at module load rather than per-request.
**Corrected README row:**
> `OAUTH_STATE_SECRET` | backend | **secret** — 32+ bytes of real entropy
> (`openssl rand -base64 48`). Never the placeholder. If it is unset the app silently signs
> OAuth state with a hard-coded default that is public in this repo, which allows an attacker
> to bind their own connected accounts into another user's workspace. Rotate it if it ever
> leaks (in-flight OAuth flows will fail for 15 minutes; that is the whole blast radius).

## D-D. `setupGuides.ts:31` "Development Mode is enough … App Review is only needed to read other people's Pages" — convenient, and wrong for this business. P1, CONFIRMED.

Shown **in the app, on the Connections page**, to whoever is looking at it. Two problems:

1. It is a *client-facing* screen (`Connections.tsx:100` renders `SetupPanel` to any signed-in
   user) that gives *operator* instructions — "Create an app of type Business", "copy the App
   ID and App Secret into the environment variables below", "add yourself as Administrator".
   A client cannot do any of this and has no business being told to. See §6/O2.
2. The claim itself misleads the operator about the launch gate. PulseBoard's entire premise
   is reading **clients'** Pages. That is "other people's Pages" in every case, so App Review
   is required from day one — plus Business Verification, Data Use Checkup and a Data
   Protection Assessment (LAUNCH-AUDIT §5). The line invites the operator to onboard a client
   in Development Mode by adding them as a "Tester", which technically works and is
   **a Platform Terms violation to run a service on**, and it silently caps them at ~5 testers.

**Corrected `setupGuides.facebook.summary`:**
> "One Meta app covers both Facebook and Instagram. You can connect Pages **you personally
> administer** in Development Mode for testing. Reading any client's Page requires the app to
> pass **App Review** with Advanced Access, plus Business Verification and a Data Protection
> Assessment — Development Mode is not a route to production."

## D-E. `setupGuides.ts:51` "these holds usually clear within 24–48h". P3, UNVERIFIED.

An unsourced timing promise about Meta account-quality holds, presented as fact in the
product. Meta gives no such SLA. Reword to "may clear on their own; if not, appeal from
business.facebook.com/accountquality — there is no published resolution time."

## D-F. `Connections.tsx:64` banner tells the user an auth error "is expected". P2, CONFIRMED.

> "Until your Meta and TikTok developer apps pass review and the backend keys are set, the
> connect buttons will return an auth error — that's expected."

This trains both operator and client to ignore OAuth failures. Once live, a *genuine* failure
(expired secret, revoked app, `bad_state`, `no_pages_found`) presents identically and will be
dismissed as "that's expected". It also cannot be right in production, where the banner should
not appear at all. Gate the banner on a build-time flag, and once live replace it with the
specific error.

## D-G. README §1.2 tells the operator to run the schema in an existing shared project. P2, CONFIRMED.

`schema.sql:4-7` positions schema isolation as a feature: "it can safely share a Supabase
project with your other apps". For a system holding influencer OAuth tokens, sharing a
Postgres instance with unrelated apps means every one of those apps' service-role keys, every
one of their SQL-console users, and every one of their backups reaches `account_secrets` —
which stores tokens in **plaintext** (`schema.sql:53`, LAUNCH-AUDIT §8). Schema separation is
not a security boundary against the service role.

**Corrected note:** "Use a dedicated Supabase project for PulseBoard. The `pulseboard` schema
prevents *name* collisions, not *access*: any service-role key issued for the project reads
`account_secrets` regardless of schema."

## D-H. README §Local development: `VITE_SITE_URL=http://localhost:8888` against production keys. P2, CONFIRMED.

`README.md:86` tells the operator to point `VITE_SITE_URL` at localhost, and `.env.example:13`
defaults to it. Nothing anywhere tells the operator to use a **separate Supabase project and
separate Meta/TikTok apps** for local work. The path of least resistance — copy the Netlify
values into `.env.local` — has an unencrypted `.env.local` on a laptop holding the production
service-role key and both platform app secrets, and local OAuth writing real client tokens
into the production database. See §5/R2.
