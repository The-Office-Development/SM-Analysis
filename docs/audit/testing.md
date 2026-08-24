# R2 — Audit of the PulseBoard verification harness (verify/)

Date: 2026-08-23 · Branch: claude/analysis-35bck4
Status: IN PROGRESS — findings appended as established.

## §0. Headline

Passing `verify/` certifies exactly one thing: **the sync and OAuth code do not throw, and do not
produce `NaN`, `Infinity`, `undefined` or a negative counter, when fed a hand-written fiction of the
2024-era Graph API.** It certifies nothing about correctness, nothing about the database, nothing
about Facebook/TikTok/cron/API routes, and — decisively — **it cannot fail.**

---

## F-1. No script in `verify/` can fail. Every suite exits 0 unconditionally. P0, CONFIRMED.

There is not one `process.exit(1)`, `assert`, or non-zero exit path in the whole harness:

```
$ grep -rn "process.exit" verify/          -> (no matches)
```

- `verify/ig-sync.test.mjs:130-135` — collects anomalies into `bad[]`, prints them, prints a
  `RESULT` line containing `anomalies=N`, and ends. Falls off the end of the module ⇒ exit 0.
- `verify/empty-account.test.mjs` (last line) — prints
  `RESULT: ${bad === 0 ? "PASS …" : "FAIL — N problem(s)"}`. **A FAIL is printed and the process
  still exits 0.**
- `verify/mixed-series.test.mjs:29-37` — `attempt()` catches every throw and prints
  `<-- CRASH`. A crash is a log line, not a failure.
- `verify/oauth.test.mjs` — prints `RESULT <name>: ok | …` for every scenario; `ok` is a literal,
  not a computed verdict (see F-8).
- `verify/run-all.sh:18`, `run-oauth.sh:20` end in `grep -h "^RESULT" …` — greps for the *presence*
  of the line, never its content. `run-frontend-empty.sh:19-20` even appends `|| true` so grep's
  own exit code is discarded.

Measured, this run: **all three suites exit 0**, and `run-all.sh`'s own summary prints
`RESULT scenario D: threw=YES` — a scenario in which `syncAccount()` threw — as part of a green run.
`set -euo pipefail` in the runners is decorative: it only catches a `tsc` failure or a Node syntax
error, i.e. it is a *compile* check, not a *test* run.

**Consequence.** This harness cannot be wired into CI even if CI existed. Whoever runs it must read
~55 KB of printed output by eye and know what the right numbers are. That is not a safety net;
it is a logging exercise wearing the word PASS.

**Fix.** Every script must `process.exitCode = 1` on any flagged condition, and every runner must
drop the trailing `grep` in favour of real exit-status propagation.

---

## F-2. `verify/mock-graph.mjs` models a Graph API version that expired 21 May 2026. P0, CONFIRMED.

`netlify/functions/_sync.ts:3` pins `https://graph.facebook.com/v19.0`. The mock hard-codes the
same string in its route matcher — `mock-graph.mjs:162` `/^\/v19\.0\/\d+$/` — and in its fake paging
URLs (`:59`). So the mock is *built to agree with the bug*: the one thing that will actually happen
in production on the first live call (an unsupported-version error) is the one thing the mock is
structurally incapable of producing, because it matches on `v19.0` and returns 200.

Worse, `installMockGraph`'s router (`mock-graph.mjs:151-184`) **returns `{ ok: true, status: 200 }`
for every request, including the error scenarios** (`:178` falls through to `metaError(...)` but
still with `ok:true, status:200`). Real Meta version-deprecation and permission failures arrive as
HTTP 400 with an `error` envelope. `_sync.ts:312-317` `getJson()` never reads `res.status` or
`res.ok`, so the harness never exercises the (nonexistent) status handling — a defect the mock
conceals by construction.

**Specific shape divergences from the live 2026 API:**

| Mock returns | Reality in 2026 |
|---|---|
| `metric=reach,impressions` → both series 200 OK (`mock-graph.mjs:56-57`, `164`) | `impressions` was removed for IG in the impressions→**views** consolidation; requesting it errors the *whole* call, taking `reach` down with it |
| `total_interactions` as `period=day` series (`:61`) | now served under `metric_type=total_value`; a plain `period=day` request is rejected |
| `online_followers` `period=lifetime` 7×24 maps (`:76-81`) | deprecated for IG; `_sync.ts:145` still requests it |
| `follower_demographics` with `breakdown=` (`:171`) | current param is `breakdown` on `metric_type=total_value` with `timeframe`; mock accepts whatever `_sync.ts` sends and never validates |
| every response `ok:true, status:200` (`:183`) | 400/403/429 with `error.code` 4/17/32/613 for rate limits, 190 for expired tokens |

**Consequence.** Scenario A ("populated account, everything works") is unreachable in production.
The suite's flagship green result describes an API that no longer exists. The single most likely
real-world outcome — every Instagram sync failing at the first insights call — is **not covered by
any scenario**, and `_sync.ts:82` swallows it with `.catch(() => ({ data: [] }))`, which the harness
would score as "no anomalies, 30 rows written, PASS" (see F-6 probe).

**Fix.** Replace the hand-written fixture with responses **recorded from the live API** at the
version production targets, keyed by version, with a contract test that fails when the recorded
fixture is older than N days or the version is past its sunset date.

---

## F-3. `verify/fake-db.mjs` is not a database. It models no constraint that matters. P0, CONFIRMED.

`fake-db.mjs:13-85` is a ~70-line recorder. Enumerating what a real PostgREST/Supabase call can do
that the fake cannot:

- **Upsert conflict semantics (`:53-67`).** `upsert()` pushes rows into an array and returns
  `{data: rows.map(r => ({id: 'table-generated-N', ...r})), error: null}`. The `onConflict` option is
  *recorded and never applied*. Nothing dedupes; nothing overwrites. The suite therefore cannot
  observe the behaviour D1's fix depends on ("the upsert overwrites, so re-fetching a trailing
  window is cheap"), and cannot catch an `onConflict` column list that does not match a real unique
  index — the exact failure mode that makes a live upsert 42P10-error instead of updating.
- **Row limits.** `.limit(n)` (`:39`) is pushed onto `filters` and ignored; `rowsFor()` returns the
  entire seed. PostgREST's default 1000-row cap and any `?limit` are unmodelled — so a sync that
  silently truncates in production reads as complete here.
- **Filters do not filter.** `.eq(c,v)` (`:37`) records and returns `this`. Seeded rows come back
  regardless of `account_id`. **A cross-tenant read — the single worst bug this product could
  have — is indistinguishable from a correct one in this harness.**
- **Error shapes.** The only error ever produced is `{ message: "no rows" }` (`:40`). Real PostgREST
  errors carry `{code, details, hint, message}` (`PGRST116`, `23505`, `42501`, `22P02`…). `_sync.ts`
  ignores the `error` field on **every** write (`:48`, `:54`, `:65`, `:72` all destructure nothing) —
  a total absence of error handling that the fake makes invisible because it never returns an error.
- **RLS: not modelled at all.** No policy evaluation, no `auth.uid()`, no service-role vs anon key
  distinction. `supabase/schema.sql` policies are never executed by anything in this repo.
- **Types/NULL/constraints.** No NOT NULL, no CHECK, no FK, no numeric range. A row of the wrong
  shape is accepted and printed back.

**Consequence.** Green here says nothing about whether a single row can actually be written to
Postgres, nor whether one tenant can read another's rows.

**Fix.** Contract-level DB tests must run against a real Postgres (Supabase CLI local stack or
Testcontainers) with `supabase/schema.sql` applied and RLS **on**, asserted with two distinct JWTs.

---

## F-4. MUTATION EVIDENCE: 11 deliberate defects injected, 11 survived. Mutation score 0/11. P0, CONFIRMED.

The strongest available evidence. Method: the repo was copied to a scratchpad sandbox
(`scratchpad/full/`, repo untouched), a defect was introduced into the **real TypeScript source**,
and the suite was run through its own runner script. Results:

### Through `bash verify/run-all.sh` (real `netlify/functions/_sync.ts` recompiled by the runner)

| # | Injected defect | Runner exit | `RESULT` line |
|---|---|---|---|
| S1 | `reach` multiplied by 10 — every stored number 10× wrong | **0** | byte-identical to baseline |
| S2 | `MAX_BACKFILL` 30→3 — 27 days of history silently lost | **0** | `metrics_daily=3` (printed, not failed) |
| S3 | Date key shifted **+5 days** — every row misfiled | **0** | **byte-identical to baseline** |

S3 is decisive: it is a strict generalisation of D2 (the CONFIRMED ±1-day shift). A five-day
misfiling of the entire dataset is invisible to this suite.

### Through `node verify/ig-sync.test.mjs A` (mutating compiled `verify/build/_sync.js`)

| # | Injected defect | exit | `RESULT` |
|---|---|---|---|
| M1 | `reach` ×10 | 0 | identical |
| M2 | `followers` forced to 0 on every row | 0 | identical |
| M3 | `reach := engagements` (columns swapped) | 0 | identical |
| M4 | **rows written under `account_id: "SOMEONE-ELSES-ACCOUNT"`** | 0 | identical |
| M5 | `onConflict` option removed (upsert degenerates to insert) | 0 | identical |
| M6 | `reach` hard-coded 0 — all flow data destroyed | 0 | identical |
| M7 | `GRAPH` bumped v19.0→v23.0 (mock 404s the route) | **0** | `threw=YES metrics_daily=0` — a total sync failure, still exit 0 |

M4 is the one to show a stakeholder: **the harness cannot tell whether one influencer's metrics were
written into another influencer's account.**

### Through `bash verify/run-frontend-empty.sh` (real `src/lib/*` recompiled)

| # | Injected defect | exit | `RESULT` |
|---|---|---|---|
| F1 | `engagementRate` ×1000 (returns e.g. 4200 % instead of 4.2 %) | 0 | `PASS` |
| F2 | `bestTimes` weekday shifted +3 | 0 | `PASS` |
| F3 | `bestTimes` label: wrong day **and** wrong hour | 0 | `PASS` |
| F4 | every row's `engagements` inflated by +999 | 0 | `PASS` |

F2/F3 are exactly D3 ("best time to post names the wrong weekday"), injected in a larger and cruder
form, and the suite still prints **PASS**.

**Mutation score: 0/11 killed.** A suite with a mutation score of zero has, by definition, no
detection power. The rational read is that `verify/` provides **negative** value: it converts "we
have not tested this" into "we ran the tests and they passed", which is how an operator gets talked
into connecting a high-value account.

**Fix.** Adopt mutation testing as the acceptance criterion for the replacement suite (StrykerJS
against `src/lib` and `netlify/functions`); a suite that does not kill S1/S3/M3/M4/F1/F2 is not
finished.

---

## F-5. The OAuth suite prints `ok` when the CSRF check is removed. P0, CONFIRMED.

`verify/oauth.test.mjs` is the best-engineered script here — it drives a **real** supabase-js client
and intercepts at the HTTP layer (`:157-168`), so `saveAccount()`'s real PostgREST query builder,
`Prefer` headers and `on_conflict` are exercised. That makes its lack of assertions more dangerous,
not less: it *looks* rigorous.

`verify/oauth.test.mjs:333` is commented `// ---- assertions / derived facts ----`. There are no
assertions. It computes strings (`fb_row=YES`, `location=…`) and prints them. The literal `ok` in
`RESULT ${name}: ${threw ? … : "ok"}` (`:359-361`) means only **"the handler did not throw"**.

Two mutations of `netlify/functions/oauth-meta-callback.ts`, run through `bash verify/run-oauth.sh`:

| Injected defect | Result |
|---|---|
| `:12` — a bad/forged `state` returns `backToApp("connected","meta")` instead of `"bad_state"` | every negative scenario prints `RESULT …: ok \| location=…?connected=meta`; **exit 0** |
| `:11` — `verifyState()` replaced by `q.state ? {uid: <victim uid>} : null` — the HMAC signature check deleted outright | `RESULT bad-state-same-length: ok \| fb_row=YES \| ig_row=YES` — a **forged state successfully bound an attacker's Meta Page and access token to a victim's account** — and the suite still prints `ok` and **exits 0** |

The README (`verify/README.md:41-42`) explicitly claims this suite "locks down" the malformed-state
regression. It does not lock down anything: it prints the current behaviour, whatever that is.

**Fix.** Each scenario must declare its expected `location` header, expected row set and expected
Graph call sequence up front, and the runner must exit non-zero on any mismatch.

---

## F-6. COVERAGE MAP: 4 of 13 production paths are exercised at all; 0 are asserted.

"Covered" below means *executed by some script*, which — per F-4 — is not the same as tested.

| Production path | File | Exercised? | Risk if wrong | Rank |
|---|---|---|---|---|
| Instagram sync | `_sync.ts:76-137` | partially (scenarios A–D) | wrong numbers on every chart; D1/D2/D3 all live here | **1** |
| **Facebook sync** | `_sync.ts:158-204` | **NO — zero coverage** | `page_fans`/`page_impressions` are deprecated Page metrics; the `carried` back-fill loop at `:198-202` fabricates a flat follower series and nothing checks it | **2** |
| **RLS / tenant isolation** | `supabase/schema.sql` | **NO — nothing in the repo ever executes a policy** | one client sees another's data; probe M4 proves the harness is blind to it | **3** |
| **Token refresh** | *does not exist in production* | **NO** | `expires_at` is stored (`_lib.ts:110`) and never acted on; every connection dies silently at ~60 days and the only signal is `sync.ts:32` regex-matching an error string | **4** |
| **Cron path** | `sync-cron.ts` | **NO** | selects **all** connected accounts with no `.limit()`/pagination (`:57`) → PostgREST's 1000-row default silently truncates; also Netlify's 10 s/26 s function timeout vs N accounts × ~7 Graph calls | **5** |
| **Rate limits / error envelopes** | `_sync.ts:312-317` | **NO** | `getJson()` never reads `res.ok`/`res.status`; mock always returns `status:200` (`mock-graph.mjs:183`); Meta codes 4/17/32/613 and HTTP 429 are unmodelled and unhandled | **6** |
| **TikTok sync** | `_sync.ts:231-261` | **NO** | writes one synthetic "today" row with lifetime video totals as *daily* reach — a category error nothing checks | **7** |
| **Audience sync** | `_sync.ts:139-155`, `206-228` | IG only, shape printed not checked | `bucketOnline()` `getUTCDay()` bug (D3) lives here | **8** |
| **`/api/sync`** | `sync.ts` | **NO** | auth (`userIdFromToken`), 401/405, partial-failure message; `syncAccount` reached only via a direct import | **9** |
| **`/api/share`** | `share.ts` | **NO** | public, unauthenticated read surface — a token/scoping bug leaks a client's data publicly | **10** |
| **`/api/ai`** | `ai.ts` | **NO** | prompt/PII passthrough, key handling, cost | 11 |
| **Disconnect / revoke** | `Connections.tsx:48-53` | **NO** | sets `status:"revoked"` client-side only — **the platform token is never revoked at Meta and `account_secrets` is never deleted**, so PulseBoard keeps a live token for an account the user believes is disconnected | **P0 product bug, also untested** |
| **OAuth callback (Meta)** | `oauth-meta-callback.ts` | yes, executed, **not asserted** (F-5) | account takeover via forged state | — |
| **OAuth (TikTok)** | `oauth-tiktok*.ts` | **NO** | same class as Meta, zero coverage | 12 |

Frontend: only `src/lib/{api,analytics,snapshot,reports,format}` and 6 chart/presentational components
are compiled (`verify/tsconfig.fe.json:18-31`). Every page (`src/pages/*`), every context
(`DashboardContext`, `AuthContext`), and `src/lib/supabase.ts` are outside the harness entirely.

---

## F-7. Assertion strength: the anomaly scanner is a type-checker wearing a test's clothes. P0, CONFIRMED.

`verify/ig-sync.test.mjs:32-43` — the entire verdict logic:

```js
if (Number.isNaN(v)) bad.push(...)
else if (!Number.isFinite(v)) bad.push(...)
else if (v < 0 && /followers|reach|.../.test(p)) bad.push(...)
else if (v === undefined) bad.push(...)
```

That is the complete set of things this suite can detect. It asks *"is this a finite non-negative
number?"* — a question TypeScript's `number` type nearly answers for free. It never asks *"is it the
right number?"* No expected value appears anywhere in `ig-sync.test.mjs`; the mock knows the answer
(it generated the series at `mock-graph.mjs:56` with `900 + ((i*137)%700)`) and the test never
compares against it. `empty-account.test.mjs:71` is the same idea with a regex,
`/NaN|Infinity|undefined|null%|-%/`, over rendered strings.

Every wrong-but-plausible number is, by construction, a pass. Probes M1/M2/M3/M6/F1/F4 confirm it.

### Why each CONFIRMED defect in `docs/DATA-INTEGRITY.md` walked straight through

**D1 (days frozen at ~6 h) — three independent reasons, all structural:**
1. `mock-graph.mjs:144-145` computes `start = addDays(today, -29)` and generates a **complete** 30-day
   fixture on **every** invocation. The mock has no concept of "today is incomplete" — day *N* is as
   full as day *N−29*. The condition the defect consists of cannot be represented in the fixture.
2. The suite runs `syncAccount()` **once per process**. `run-all.sh:15` does add a
   `--latest=2026-07-24` "incremental gap-fill probe", but that is a *single* sync against a *seeded*
   row, not two consecutive syncs with the first's output feeding the second. Nothing ever asks
   "on day 2, was day 1's value corrected?" — the only question that exposes D1.
3. `fake-db.mjs:53-67` does not apply `onConflict`, so even a two-run test would not model the
   overwrite the fix depends on. `verify/proofs/p3-frozen-days.mjs:1-11` **re-implements**
   `backfillStart()`/`enumerateDays()` by copy-paste rather than importing the real ones — so it
   demonstrates the defect but would not detect a divergence in the real function.

**D2 (every day filed one day late at UTC offset ≤ 0):**
`mock-graph.mjs:21` `endTimeFor = (D) => addDays(D,1) + "T07:00:00+0000"` and `_sync.ts:292`
`v.end_time.slice(0,10)` **contain the same off-by-one, so they cancel**. The mock hands back
`2026-08-24T07:00:00+0000` for day `2026-08-23`; `slice(0,10)` yields `2026-08-24`; the test then
compares… nothing. There is no oracle. `mock-graph.mjs:5-7` documents the convention correctly in a
comment and then never asserts on it. Probe S3 (+5-day shift) proves the class: **any** date-keying
error produces a byte-identical `RESULT` line. The suite is structurally incapable of detecting date
misfiling because it has no independent notion of which day a value belongs to.

**D3 (best time to post names the wrong weekday):**
The only frontend fixture is `empty-account.test.mjs:59-67` with `audience: []`. `activeGrid()`
therefore returns an all-zero 7×24 grid, `bestTimes()` hits `analytics.ts:33` `if (max <= 0) return []`,
and the test asserts `bestTimes(...).length` is… printed. **The weekday-bucketing code path is never
executed with non-zero data anywhere in the harness.** `mixed-series.test.mjs` supplies no audience
either. Probes F2/F3 (weekday shifted +3; wrong day *and* wrong hour) both print `PASS`.

**The common root cause — and the thing to fix, rather than patching three tests:** every script in
`verify/` derives its expectations from the same code it is testing, or from nothing. There is no
**oracle** — no independently-computed correct answer. A suite without an oracle can only detect
crashes and type violations, which is precisely and exactly what this one detects.

---

## F-8. The verify build pipeline diverges from the production build in ways that can mask defects. P1, CONFIRMED.

The harness does **not** run what Netlify/Vite run. It runs a fourth, harness-only build.

| | Production | Harness |
|---|---|---|
| Functions | `netlify.toml:7` `node_bundler = "esbuild"` — esbuild transpiles, **never type-checks** | `run-all.sh:8` / `run-oauth.sh:9` — `tsc -p verify/tsconfig.emit.json` (`strict:true`) then `sed -i` on the emitted JS (`run-oauth.sh:13`) |
| Frontend | `package.json` `"build": "tsc -b && vite build"` with `tsconfig.app.json` | `run-frontend-empty.sh:12` — `tsc -p verify/tsconfig.fe.json`, then `verify/fixup-fe.mjs` rewrites specifiers and **overwrites `lib/supabase.js`** |
| Target / lib | `tsconfig.app.json`: `ES2021`, `lib: [ES2021, DOM, DOM.Iterable]`, `useDefineForClassFields`, `isolatedModules`, `moduleDetection: force`, `noFallthroughCasesInSwitch` | `verify/tsconfig.fe.json:3-16`: `ES2022`, `lib: [ES2022, DOM]`, **`types: ["node"]`**, none of the above flags |
| Module graph | Vite bundles + tree-shakes the whole app | 12 hand-listed files (`tsconfig.fe.json:18-31`) |

Concrete divergence risks:
- **`types: ["node"]` on frontend code** (`tsconfig.fe.json:7`). Browser code that touched `process`,
  `Buffer`, `__dirname` or Node's `setTimeout` return type would compile and run in the harness and
  break at runtime in the browser. The harness is *more permissive* than production on the very code
  it is supposed to protect.
- **ES2022 vs ES2021** — different downleveling of class fields, `.at()`, `Object.hasOwn`, top-level
  await. A syntax/semantic difference between the two is invisible here.
- **No `isolatedModules`/`moduleDetection`** in the harness config, which is precisely the flag set
  that catches the type-only-import and ambient-module mistakes esbuild/Vite cannot recover from.
- **esbuild never type-checks the functions.** Production ships whatever `_sync.ts` transpiles to
  regardless of type errors; the harness's `tsc -p` step is the only type gate and it is not run in CI
  (there is no CI). `npm run typecheck:functions` exists in `package.json` and nothing invokes it.
- **`sed -i 's#from "./_lib"#from "./_lib.js"#'`** (`run-oauth.sh:13`) is a blunt textual rewrite over
  emitted JS. It is benign today, but it means the artefact executed is not the artefact deployed.

Whether these transforms currently mask a real defect: **UNVERIFIED** (I found no live case). That
they *could*, and that nothing detects it, is CONFIRMED.

### F-8b. `verify/zero-account.test.mjs` — the most adversarial script in the repo — cannot run at all. P1, CONFIRMED.

13.9 KB, five adversarial scenarios including `Z1` "every insights call errors" and **`Z5` "insight
`end_time` lands on the `until` boundary date"** — i.e. the one script that pokes at D2's territory.
It imports `./build-ui/api.js` (`zero-account.test.mjs:20-22`). `verify/build-ui/` **does not exist**:

```
$ node verify/zero-account.test.mjs Z1
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/verify/build-ui/api.js'
```

Nothing builds it. `verify/tsconfig.ui.json` (which would emit `build-ui`) and `verify/fix-ext.mjs`
(which would fix its extensions) are referenced by **no** runner script and by no `package.json`
script — `grep -rn "fix-ext\|tsconfig.ui\|zero-account" *.sh *.json` returns nothing outside the
files themselves. Three files, ~15 KB, entirely dead. Note also `tsconfig.ui.json:10` sets
`"strict": false` — laxer than both production and the rest of the harness.

Because nothing fails, nobody noticed. This is F-1 compounding: a suite that cannot fail cannot
notice that a third of itself has rotted off.

---

## F-9. The README claim is false as written. P1, CONFIRMED.

> `verify/README.md:7` — "Only `globalThis.fetch` is faked. Nothing under `netlify/`, `src/`, or
> `supabase/` is touched."

Sentence 2 is true in the narrow sense (no repo file is edited in place — I re-verified with
`git status` after every run). Sentence 1 is false, and the pair together create a stronger
impression of fidelity than the harness earns:

1. **A real `src/` module is replaced wholesale.** `verify/fixup-fe.mjs:29-37` overwrites
   `build-fe/lib/supabase.js` with a stub whose every property access throws. That is the compiled
   form of `src/lib/supabase.ts`. The file on disk is untouched; the module the test runs is not
   the module production runs.
2. **The consequence is much bigger than "a network boundary".** With `supabase.js` a throwing
   Proxy, the *nine* exported data-access functions in `src/lib/api.ts:17-129` — `fetchAccounts`,
   `fetchMetrics`, `fetchContent`, `fetchAudience`, `fetchGoals`, `createGoal`, `deleteGoal`,
   `createShare`, `fetchShare`, `triggerSync`, `askAI` — **can never be executed by any test.** The
   FE suites import only the 7 pure helpers (`empty-account.test.mjs:16-18`). D4 in
   `docs/DATA-INTEGRITY.md` ("`fetchContent()` selects top 200 across all time, no date predicate")
   lives at `api.ts:38` — in code the harness has architecturally excluded.
3. **Environment is faked too.** `verify/oauth.test.mjs:36-45` writes six `process.env` keys and
   `delete`s two before importing the code under test. Reasonable, but not "only fetch".
4. **The emitted JS is textually rewritten** by `run-oauth.sh:13`, `fixup-fe.mjs:19-23` and
   `fix-ext.mjs:8`.
5. **`supabase/schema.sql` is never executed by anything**, so "nothing under `supabase/` is touched"
   is true in the least useful way: nothing under `supabase/` is *tested* either.

**Fix.** Replace line 7 with an honest inventory, and add a "What this suite does NOT establish"
section stating plainly: no assertions, no database, no RLS, no Facebook/TikTok/cron/API-route
coverage, and fixtures modelling a Graph API version that expired 2026-05-21.

---

## F-10. What a real suite looks like. (Recommendation, not a defect.)

**Framework.** Vitest — already Vite-native, zero extra build config, runs `.ts`/`.tsx` directly, so
the whole `verify/` compile-and-`sed` pipeline (F-8) disappears. `@vitest/coverage-v8` for coverage,
**StrykerJS for mutation score**, which is the only metric that would have caught this situation.

**Layer 1 — pure-function unit tests (`src/lib/*`, `_sync.ts` helpers).** Fast, no I/O, with real
oracles. Export the currently-private helpers (`seriesFromInsight`, `backfillStart`,
`reconstructFollowers`, `bucketOnline`, `enumerateDays`) from `_sync.ts` so they can be tested
directly instead of only through a 7-HTTP-call integration path.

**Layer 2 — contract tests against RECORDED REAL fixtures.** Record once from live accounts, commit
as JSON, replay with MSW. Fixtures that must be recorded, each at the *current* Graph version:
- IG: `?fields=followers_count,media_count`; `insights?metric=reach&period=day` (and whatever
  replaced `impressions`); `total_interactions` under `metric_type=total_value`; `follower_count`;
  `follower_demographics` × {age,gender,country}; whatever replaced `online_followers`;
  `media?fields=…insights.metric(…)`.
- FB Page: `page_impressions`, `page_post_engagements`, `page_fans`; `/posts`;
  `page_fans_gender_age`/`page_fans_country`/`page_fans_online`.
- TikTok: `user/info`, `video/list`.
- **Error fixtures** (the ones that decide launch): 400 unsupported-version; `(#10)` permission;
  `(#4)`/`(#17)`/`(#32)` rate limit with `X-App-Usage`/`X-Business-Use-Case-Usage` headers; HTTP 429;
  `(#190)` expired/invalidated token; empty `data: []`.
- **Record the account timezone alongside every insights fixture** — without it D2/D3 have no oracle.
Add a scheduled CI job that re-fetches and diffs the fixtures, failing on drift, plus a static check
that fails the build when the pinned Graph version is within 30 days of sunset.

**Layer 3 — DB/RLS against a real Postgres.** Supabase CLI local stack (or Testcontainers) with
`supabase/schema.sql` applied and RLS enabled. Minimum assertions: user A's JWT cannot read/update
any of user B's `social_accounts`, `metrics_daily`, `content`, `audience_snapshots`,
`account_secrets`; the anon key cannot read `account_secrets` at all; `on_conflict` targets match
real unique indexes; a second upsert of the same `(account_id, date)` **overwrites**; PostgREST's
1000-row cap is hit deliberately and pagination asserted (covers the `sync-cron.ts:57` unbounded
select). Probe M4 is the regression test to write first.

**Layer 4 — end-to-end OAuth.** Playwright against a Meta test app: full redirect → callback → rows
written → sync → dashboard. Plus, at minimum, an assertion-bearing version of today's callback
scenarios, expected `location` and expected row set declared up front (probe O2 is that test).

**CI wiring** (there is none today): GitHub Actions on push/PR — `npm run typecheck`,
`typecheck:functions`, `vitest run --coverage`, RLS suite against a service container, Stryker on a
nightly with a score threshold. Branch protection requiring green.

**The specific regression test each known defect demands:**

| Defect | Test |
|---|---|
| D1 frozen days | Run `syncAccount()` **twice** against a fake DB that *actually applies* `onConflict`, with day *N*'s fixture incomplete on run 1 and complete on run 2. Assert day *N*'s stored value is **corrected**. Also assert a missing day is not written as a fabricated `0`. |
| D2 date shift | For each of ≥4 timezones, plant reach *R(d)* on local day *d*, sync, assert `row[d].reach === R(d)` for all 30 days. Promote `verify/proofs/p1-date-shift.mjs` (see below). |
| D3 wrong weekday | Plant an audience peaking Saturday 20:00 local; assert `bestTimes()[0].label` starts with `Sat` for every timezone. Promote `p2-best-time.mjs`. |
| D4 all-time content | Assert `fetchContent(range)` emits a `published_at` predicate and that `buildCsv`/`buildSnapshot` contain no post outside the window. |
| D5 CSV injection | Property test: a caption of `=cmd|'/c calc'!A1` must be exported prefixed with `'`. |
| Version sunset | Assert `_sync.ts`'s pinned Graph version is current and not past sunset. |

### Promoting `verify/proofs/` to assertions — concretely

The three proof scripts already contain the missing oracles; they only lack a verdict. For each:
1. **Import the real functions instead of copying them.** `p3-frozen-days.mjs:1-11` re-implements
   `backfillStart()`/`enumerateDays()` by copy-paste; it therefore cannot detect drift in the real
   code. Export those from `_sync.ts` and import them.
2. **Turn the printed comparison into `expect()`.** `p1` already computes `stored` vs `true` per day
   and prints `WRONG`; replace the print with `expect(stored).toBe(truth)`. `p2` already knows the
   truth is Saturday 20:00; replace the table with `expect(advice.day).toBe("Sat")`. `p3` already
   counts writes per day; replace with `expect(writes[d].length).toBeGreaterThan(1)`.
3. **Invert the polarity and mark them.** Land them today as `it.fails(...)` / `test.todo` so they
   are red-by-design and CI records the known-defect state; flip to plain `it()` in the same commit
   that fixes each defect. That converts three documents into three tripwires.
4. **Keep p1/p2's stated caveat as a test.** `verify/proofs/README.md:23-26` correctly flags that
   p1/p2 assume Meta's documented `end_time` convention. Make that a **contract test against a
   recorded real response**, so the assumption is verified by CI rather than by a footnote.

---

## Verdict

**Does passing this suite mean anything?** It means the code compiles under `strict`, and that on one
hand-written fiction of a retired API it does not crash or emit `NaN`. That is real but small.

**What does it certify that is not true?** By its own README it certifies: that the sync is
"verified end to end" (`README.md:3`); that six named regressions are "locked down"
(`README.md:33-43`); that "only `globalThis.fetch` is faked" (`:7`); and, by printing `PASS` and
exiting 0, that it is safe to connect an account. Measured: **0 of 13 injected defects were caught**,
including metrics written under another tenant's id and the OAuth CSRF check deleted outright. None
of the six "locked down" regressions is asserted anywhere — they are *demonstrated* in printed output,
which protects against nothing once the output stops being read by the person who wrote it.

The correct action before connecting a high-value influencer account is to treat `verify/` as
**unverified**, and to say so at the top of `verify/README.md` today, before the suite is fixed —
because the false confidence is doing damage right now and the fix is a paragraph of text.
