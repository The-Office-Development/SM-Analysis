# PulseBoard — project brief for Claude Code sessions

Read this before changing anything. It records what exists, why several
non-obvious things are the way they are, and which invariants must not be
"simplified" back into defects.

---

**New session? Read `docs/PROJECT-STATE.md` §0 first** — it holds the current
position, the company details, what is blocked on a human right now, and the
environment gotchas. This file is the technical brief; that one is what to do next.

## 1. What has been built

**The product.** A multi-tenant social analytics dashboard. Clients connect their
Instagram Business accounts (and Facebook Pages / TikTok, secondary) via official
read-only OAuth; a scheduled sync pulls daily metrics, posts and audience
breakdowns into Supabase; the app renders dashboards, a planner, a grounded AI
assistant, CSV/PDF exports and public read-only share links.

- **Frontend** — React + TypeScript + Vite, `src/`. Hand-built SVG charts, no chart library.
- **Backend** — Netlify Functions, `netlify/functions/`. Holds every platform secret.
- **Data** — Supabase Postgres, isolated `pulseboard` schema, RLS default-deny on every table.
- **Hosting** — Netlify: static frontend, serverless functions, two scheduled functions.

**The audit.** A multi-domain pre-launch audit found 24 P0 findings. Full record in
`docs/COMPLETE-AUDIT.md` (single file) with the seven specialist reports under
`docs/audit/`, the proven data defects in `docs/DATA-INTEGRITY.md`, the Jordan
analysis in `docs/JORDAN-CONTEXT.md`, and a corrections register listing eight
claims that later passes overturned.

**The remediation.** 19 of 24 P0s fixed, 1 mitigated, 4 partly done or
organisational. Per-finding status in `docs/REMEDIATION-STATUS.md`. Headlines:

- Graph API moved v19.0 (expired 21 May 2026) to v25.0, pinned once
- removed metrics replaced (`views`, `page_media_view`, `page_follows`, `post_media_view`)
- TikTok's success envelope no longer read as an error — it had never worked at all
- the sync can no longer write fabricated zeros over real client history
- days no longer freeze at a few hours of data; a trailing window is re-fetched
- calendar days derived correctly at every UTC offset
- OAuth state bound to the browser, closing an account-takeover
- `business_management` dropped; tokens encrypted at rest; secrets fail closed
- disconnect revokes at the platform and deletes; token refresh under a lock
- data-deletion and deauthorize callbacks, legal pages, consent capture, data export
- a test suite that can actually fail: 50 assertions, mutation score 22/22, gating CI

---

## 2. The goal

Serve **large Jordanian creator and agency Instagram accounts** with analytics
they can trust well enough to show a sponsor. The operator, the software and the
clients are all in Jordan (UTC+3, no DST).

Two constraints shape every decision:

1. **A wrong number is worse than an outage.** Nobody notices a wrong number, and
   a client who catches one stops trusting the product permanently. Correctness
   beats features, and honest "unknown" beats a confident zero.
2. **These accounts are valuable and must not be put at risk.** Reading analytics
   through the official API does not get accounts banned — credential-based and
   automation tools do. The one real risk is holding write-capable credentials
   insecurely, which is why `business_management` was dropped and tokens are
   encrypted.

---

## 3. Where it currently stands

Code is on `main`, all green: typecheck, build, 50 tests, mutation 22/22.

**Nothing has ever run against the live Instagram API.** Every test runs against
a mock built on Meta's *documented* conventions. The correctness fixes are
validated against that model, not against real responses. The first real
connection is an experiment, not a formality.

**No client account can connect yet.** Until App Review passes, OAuth only works
for accounts holding a role on the Meta app. That is a platform rule, not a
limitation of this code.

Not yet done by anyone: migrations `0001`–`0007` have not been applied, secrets
are not set (the code fails closed without them), the Meta app is not configured
for the new callbacks, and nothing is deployed.

---

## 4. What is left

> Commercial and strategic decisions — build vs buy, web vs native, the pilot
> route, pricing and positioning — live in `docs/PROJECT-STATE.md`, which also
> holds the current two-track plan. The data-source comparison is
> `docs/VENDOR-OPTIONS.md`. The step-by-step deployment path is
> `docs/DEPLOY-RUNBOOK.md`.

**Blocking, technical (about a day):**
- apply `supabase/migrations/0001` → `0007` in order
- set `TOKEN_ENC_KEY` and `OAUTH_STATE_SECRET`; scope Netlify env vars to the production context
- register the data-deletion and deauthorize callback URLs; turn on Require App Secret
- set `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` (distinct from `META_APP_*`)
- see `docs/SETUP-META.md` for the full administrative path
- deploy, connect a real Instagram account, then run
  `node verify/reconcile.mjs --account <id>` and **compare settled days against the
  account's own Instagram insights** — this is the gate that matters most, and no
  client sees the product until the numbers agree

**Blocking, administrative (not code, start first — it runs in parallel):**
- Business Verification (10 minutes to 14 working days; Jordanian commercial registration,
  stamped English translation if needed)
- App Review with a screencast, Data Use Checkup, Data Protection Assessment

**`online_followers` and `follower_count` are REQUESTABLE after all — the
documentation check was wrong, and a live call proved it.**
The 2026-08-26 pass read the insights metrics table, found neither metric listed,
and concluded both were removed. On 2026-09-04 the first live call this project
has ever made requested both and **both answered**, with a `values` array and a
localised title. Documentation absence is not API absence, and this is the
cleanest demonstration in the repo of why the reconciliation gate exists.

Consequences, all open:
- The `online_followers` hour-key timezone question is **re-opened**, not moot.
- `follower_count` may be able to replace the reconstructed follower line, which
  is the most visible number in a sponsor-facing media kit.
- Both are **undocumented but working**. That is not the same as supported —
  Meta removes such metrics without notice, so anything built on them needs the
  `optional()` treatment and a fallback, never a hard dependency.

See `docs/API-VERIFICATION.md` §2 and §6.

**Decided and built: Instagram API with Instagram Login is the primary path.**
It requires no linked Facebook Page — on the Facebook Login path a creator
without one cannot connect at all — and needs a smaller, entirely read-only
permission set (`instagram_business_basic`, `instagram_business_manage_insights`,
no `pages_*`). The Facebook Login path is retained unchanged for Facebook Pages.

**Its endpoints are verified against the documentation, not against a live
response.** Every URL, scope and field name lives in the `IG` block at the top of
`netlify/functions/_instagram.ts`, deliberately in one place, because they were
originally assembled from secondary sources. They were checked against
`developers.facebook.com` on 2026-08-26 and three of the four daily metrics were
found wrong; the finding, the citations and the fix are in
`docs/API-VERIFICATION.md`. **Documentation agreement is not a live call** — the
reconciliation gate below still stands, and if a name is wrong it is wrong only
there.

**Organisational.** DPO question under Jordan's PDPL, cross-border transfer file
(Supabase, Netlify and Anthropic are all outside Jordan), region choice, alerting
and on-call, counsel sign-off on the PDPL analysis and the draft legal pages.

**Deferred.** Share-link expiry and revocation; a retention purge job; a real
queue-backed sync for scale; remaining optimistic claims in `src/lib/setupGuides.ts`.

---

## 5. Notes for future Claude and AI sessions

### Run this before you claim anything works
```bash
npm test        # typecheck, build, 50 assertions, then the mutation gate
```
The mutation check injects 22 real defects and requires every one to be caught.
**If you fix a defect the suite would not otherwise catch, add a mutation for it.**

### Invariants — do not "simplify" these back into bugs

Each of these looks like it could be tidier. Each is deliberate, and each was a
P0 finding. There is a test and a mutation guarding every one.

- **Never write a fabricated zero into a metric column.** `null` means the
  platform did not report it. `?? 0` in the sync path is how a single rate-limit
  response once erased 30 days of a client's real history.
- **Never narrow the trailing re-fetch.** `TRAILING_REFETCH` in `_sync.ts` exists
  because fetching only the gap froze every day at a few hours of data.
- **Never take the date with `end_time.slice(0, 10)`.** `dayKeyFromEndTime`
  derives the account's offset from `end_time` itself, because `end_time` is
  local midnight of the *following* day. Slicing filed every day one day late for
  every account at UTC offset ≤ 0 — the whole of the Americas.
  **Confirmed live 2026-09-04:** the first real account returned `end_time` of
  `2026-08-29T07:00:00+0000` — midnight *US Pacific*, not midnight Amman.
- **Never take the day boundary from the platform's own bucketing.** Reading
  Meta's buckets via `dayKeyFromEndTime` is correct; *defining* a day from them
  is not. `accountOffsetHours()` returns the account's stored
  `tz_offset_minutes` (default 180 — Asia/Amman, no DST), and every per-day
  window is built from it. The live call above proved why: deriving the boundary
  from `end_time` gave a Jordanian account US Pacific days, so every figure
  covered 10:00→10:00 Amman under a label saying otherwise. Nothing errors —
  the numbers are simply for a different day. Fixed in **both** Instagram paths,
  because one insights reference governs both. Two mutations guard it.
- **Never accept an OAuth state without the cookie nonce.** The signature alone
  lets an attacker replay their own state into a victim's browser and attach the
  victim's accounts to the attacker's tenant.
- **Never re-add `business_management`**, `instagram_business_content_publish`, or any
  other write-capable scope. Guarded by a mutation.
- **Never let a secret fall back to a default.** `OAUTH_STATE_SECRET` once
  defaulted to a constant published in this repository.
- **Never put caller-supplied text into the system prompt** in `ai.ts`. The
  dashboard snapshot goes in a user turn; captions are data, not instructions.
- **Never swallow a throttle or auth error** in the sync. Degrading silently is
  what turned platform rate limiting into data loss.

### Things that look wrong but are not
- `metrics_daily` columns are nullable *on purpose*.
- Days are re-fetched repeatedly *on purpose*; upserts are idempotent.
- The cron is hourly and stops early *on purpose* — Netlify caps scheduled
  functions at 30s and they cannot be background functions.
- `buildCsv` uses `seriesByDay(..., "followers")` while the dashboard uses
  `followersByDay()`. These agree: the primary key is `(account_id, date)`.

### Testing
- `verify/tests/` is the suite that counts. `tests/mock-graph.mjs` knows each
  day's **true** value, so tests assert against an oracle rather than the absence
  of a crash. `tests/fake-supabase.mjs` actually applies filters.
- `verify/proofs/` demonstrates the original defects; kept as documentation.
- **The older `verify/*.mjs` scripts are printers, not tests.** No assertions,
  always exit 0, runners `grep` for a `RESULT` line without reading it. They
  reported PASS throughout the period the sync was writing wrong numbers. Never
  cite them as evidence that anything works.

### Schema changes
`supabase/schema.sql` is `create table if not exists` throughout, so **re-running
it after an edit does nothing**. Every change goes in a new numbered file in
`supabase/migrations/`, applied in order. Keep a record of what has been applied.

### Epistemic status of the documentation
`developers.facebook.com` and `developers.tiktok.com` were unreachable from the
audit environment, so **every claim about platform API behaviour and platform
policy rests on secondary sources**, as does the Jordanian law analysis. Each
document flags what a human must confirm. Verify before acting on any of it, and
say so when you are relying on it.

### Working style that fits this project
- Prefer proving a claim numerically over asserting it. `verify/proofs/` exists
  because a worked example beat an argument.
- Correct yourself in writing when a later pass overturns an earlier claim; the
  corrections register in `docs/COMPLETE-AUDIT.md` is part of the deliverable.
- Platform deprecation is a permanent tax on this product, not a one-off
  migration. Meta expires API versions roughly every two years and removes
  metrics between them. A standing watch on the deprecation schedule is the
  cheapest insurance available and its absence is what caused most of this.
