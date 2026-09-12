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
- a test suite that can actually fail: 65 assertions, mutation score 24/24, gating CI

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

Code is on `main`, all green: typecheck, build, 65 tests, mutation 24/24.

**It is deployed, and one real account is connected.** As of 2026-09-04
`app.theoffice.it.com` serves the app and its functions, and `@heath_ens21`
authorised through PulseBoard's own OAuth flow — the first time `exchangeCode`
has executed against Meta. `verify/probe-live.mjs` reports **11 of 11** against
the live API: every endpoint, scope and field name in the `IG` block is correct.

**The first reconciliation ran on 2026-09-05 and found three things.** The most
important is about oracles, not numbers: **Meta serves pre-conversion insight
data over the API while its own app refuses to display it**, so an account
converted *for testing* yields API figures with nothing to check them against. A
valid oracle is an account that has been Business or Creator for **months**.

It also found that the stored follower series contradicts its own deltas — one
follower vanishes on a day whose recorded change is zero — and that `unfollows`
and `reach_non_followers` have been null on every day ever stored, which means
**churn and the discovery split have never held real data.** Both panels are
unproven. Full record in `docs/DATA-INTEGRITY.md`.

The mock is still the only oracle the tests have. Until a months-old
professional account is connected, correctness of the day windows, the discovery
split and the follower series remains unverified.

**No client account can connect yet.** Until App Review passes, OAuth only works
for accounts holding a role on the Meta app. That is a platform rule, not a
limitation of this code.

Done 2026-09-04: migrations `0001`–`0008` applied to a Frankfurt Supabase
project, secrets set, the Meta app configured, deployed to
`app.theoffice.it.com`, and one Instagram account connected end to end.

Not done: the reconciliation gate (needs an account with real posts), Business
Verification (blocked on a utility bill in the company's name), and App Review.

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
npm test        # typecheck, build, 65 assertions, then the mutation gate
```
The mutation check injects 24 real defects and requires every one to be caught.
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
- **Never leave a Supabase write unchecked.** supabase-js does not throw on a
  PostgREST error — `.upsert()` resolves with `{ error }` and the next line runs
  — so a call site that ignores `error` reads an unapplied migration, a missing
  grant, an RLS refusal or a constraint violation as success. The audience
  snapshot did exactly that: until `0015` is applied, every LinkedIn demographic
  was fetched, refused and reported as stored, presenting as an empty Audience
  page that looks identical to a platform with nothing to report. Use
  `writeFailed()` from `_lib.ts`, or `requireWrite()` where losing the write
  changes what the caller may then claim. Three mutations guard it.
- **Never record a deletion as completed without checking that it deleted.** The
  count of accounts reached is identical whether every delete succeeded or every
  one was refused, because the loop runs to the end either way. `deletionStatus()`
  in `_lib.ts` holds the rule for both endpoints: a failure outranks everything,
  because there is no "partly deleted" for a data subject. Meta's callback
  response has no failure channel — it documents `url` and `confirmation_code`
  and nothing else — but it does require the confirmation URL to give "a
  human-readable explanation of the status of their request, including a
  legitimate justification for any refusal to delete", so the status page is
  where the truth goes. Needs migration `0017`. Two mutations guard it.
- **Never delete the sign-in record when the erasure failed.** `account-data.ts`
  keeps it deliberately: rows we could not delete, orphaned from the only
  identity tying them to a person, become data about someone we can no longer
  identify, cannot erase on request, and cannot let sign in to retry. An
  incomplete erasure is recoverable; one with the key thrown away is not.
- **Never add `paidFollowerCount` to `organicFollowerCount`** in LinkedIn's
  follower demographics. The field is named for one thing and documented to hold
  another: "results are rolled up as a total of both organic and paid followers
  in the `organicFollowerCount` field. Do not refer to the `paidFollowerCount`
  field for professional demographic statistics." Summing them counts every paid
  follower twice, and it looks exactly like a fix. Guarded by a mutation.
- **Never total an empty series into a displayed figure.** `seriesByDay` drops
  days the platform said nothing about, so a metric it does not report at all
  yields an EMPTY series — and `sum([])` is `0`. That put "Video views · 0" on
  the Overview KPI card and "VIEWS 30D · 0" on the Platforms tile for a LinkedIn
  page, which has no page-level views at all. Use `totalReported()`, which
  returns null, and render it with `metric()`. A day on which nobody watched IS
  a zero; a metric nobody reports is unknown. Guarded by a mutation.
- **Never seed a "best" scan below the range of the data.** The Overview peak
  window scanned the activity grid with `bv = -1`, so a grid of ZEROS matched its
  first cell and the product advised posting **Sunday at midnight** — to any
  account with no hourly data, which is every LinkedIn page and every Facebook
  Page connected after 14 March 2024. Use `bestTimes()`, which returns nothing
  for an empty grid. It now lives in `insights.ts` precisely so it can be tested;
  `analytics.ts` cannot be compiled for a test because it pulls in the Supabase
  client and the React tree.
- **Never decide whether a panel has data from the arithmetic on its shares.**
  The Audience gender panel derived "other" as `1 - female - male` and drew
  itself whenever the three summed above zero, so an account the platform
  reported nothing for rendered "Other 100%". Absence comes from whether the
  platform reported a bucket. `genderSplit` in `insights.ts`, with a mutation.
- **Never show a single-bucket count as a share.** LinkedIn's
  `followerCountsByAssociationType` has one bucket; normalising it gives 1.0 and
  renders "Employee 100%" for every page. It is deliberately not stored.
- **Never ask for LinkedIn demographics with a `timeIntervals` parameter.** A
  date range makes the endpoint return aggregates with every facet absent, at
  HTTP 200 — indistinguishable from a page whose followers have no recorded
  industry. Demographics are lifetime-only. Guarded by a mutation.

### Things that look wrong but are not
- `metrics_daily` columns are nullable *on purpose*.
- Days are re-fetched repeatedly *on purpose*; upserts are idempotent.
- The cron is hourly and stops early *on purpose* — Netlify caps scheduled
  functions at 30s and they cannot be background functions.
- `buildCsv` uses `seriesByDay(..., "followers")` while the dashboard uses
  `followersByDay()`. These agree: the primary key is `(account_id, date)`.

### The demo is part of the product, not a fixture
`src/lib/demoData.ts` is what a prospective client sees before they believe any
of this, so it must not promise a panel the platform cannot fill. Each account
carries a `reports` block naming what its platform actually makes available, and
the generators write `null` where it does not — LinkedIn has no page views, no
follower churn, no discovery split, no per-post reach and no hourly activity.

**Adding LinkedIn to it found three defects in a day**, all of them the same
shape and none LinkedIn-specific: a zero displayed where nothing was measured.
Generating demo data for a platform with genuine gaps is the cheapest test of
null handling this repo has, and it should be done for the next platform too.

### Keep the arithmetic reachable from a test
`analytics.ts` and `snapshot.ts` could not be compiled for a test until
2026-09-12, because they imported `api.ts` (the Supabase client) and
`platforms.tsx` (the React tree) for nothing but pure selectors and a platform's
display name. **Three defects lived in them and all three were found by looking
at a rendered page**, not by the suite: a posting window invented from a grid of
zeros, a sponsor-facing report carrying another platform's posting times, and
the AI assistant grounded on a "0" for a metric the platform does not report.

The pure halves now live in `series.ts` (selectors over metric rows) and
`platformNames.ts` (names and order, no JSX); `api.ts` and `platforms.tsx`
re-export them so callers are unchanged. `snapshot.ts` declares its own
`SnapshotInput` rather than borrowing `ReturnType<typeof useDash>` — a type-only
import still has to resolve, and that one resolved to a `.tsx`.

**Do not reintroduce an import of `api.ts`, `platforms.tsx` or a React context
into these modules.** `verify/tests/grounding.test.mjs` and three mutations guard
what they compute; an import that breaks the test build takes all of it away.

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
`supabase/migrations/`, applied in order.

**Applying one:** `npm run db:apply <name>` — it prints the SQL, runs it through
`supabase db query --linked`, and then re-runs the schema check rather than
trusting the response. The service role key cannot do this; DDL needs the control
plane, which the linked CLI reaches with no extra secret.

**Do not claim a migration is applied without running `npm run verify:schema`.**
It probes for the columns each migration adds, cross-checks the
`pulseboard.schema_migrations` ledger and the files on disk, and exits non-zero
when it fails *or when it cannot check*. Every migration from 0016 onward ends by
inserting its own row; the ledger alone is not proof, since a row can be inserted
without the DDL running, which is why the columns are probed too.

**The failure this replaced is worth remembering.** The only check available was
a PostgREST read with the anon key, and it answered `42501 permission denied` —
which is exactly what a correctly locked-down database returns for a column that
DOES exist, because permission is resolved before the column is. A missing column
and a healthy refusal were the same response. A check that cannot fail cannot
pass, and reporting it as reassurance is the same mistake as citing the old
`verify/*.mjs` printers.

### Epistemic status of the documentation
`developers.facebook.com` and `developers.tiktok.com` were unreachable from the
audit environment, so **every claim about platform API behaviour and platform
policy rests on secondary sources**, as does the Jordanian law analysis. Each
document flags what a human must confirm. Verify before acting on any of it, and
say so when you are relying on it.

**Updated 2026-09-12: from a local session the platform docs ARE reachable.**
`learn.microsoft.com/en-us/linkedin` opens, and reading it directly found four
defects in a LinkedIn plan that had been written from a summary — including two
that would have produced confidently wrong percentages on a client's dashboard.
Check reachability before assuming the sandbox limit still applies, and prefer
the primary page over anything in this repository that paraphrases it, including
this file. Documentation agreement is still not a live call.

### Working style that fits this project
- Prefer proving a claim numerically over asserting it. `verify/proofs/` exists
  because a worked example beat an argument.
- Correct yourself in writing when a later pass overturns an earlier claim; the
  corrections register in `docs/COMPLETE-AUDIT.md` is part of the deliverable.
- Platform deprecation is a permanent tax on this product, not a one-off
  migration. Meta expires API versions roughly every two years and removes
  metrics between them. A standing watch on the deprecation schedule is the
  cheapest insurance available and its absence is what caused most of this.
