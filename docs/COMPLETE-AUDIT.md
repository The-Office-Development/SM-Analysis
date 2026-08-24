# PulseBoard — complete pre-launch audit

Single-file consolidation of every finding from the audit of PulseBoard's platform integrations,
commissioned because the operator is about to onboard high-value creator accounts from Jordan.

- **Audited commit:** branch `claude/analysis-35bck4`, on top of `9dcd93f`
- **Date:** 2026-08-23
- **Scope:** how the system connects to, authenticates against, reads from and retains data for
  clients' Facebook, Instagram and TikTok accounts — plus the correctness of the numbers it shows,
  the security of the credentials it holds, its behaviour at scale, its legal position under
  Jordanian law, its setup procedure, and whether its own test suite works.

Everything below also exists as separate documents in `docs/` and `docs/audit/`; this file is the
complete record in one place. Cross-references between those documents are preserved verbatim
inside the appendices.

## How to read this

Findings carry a severity and a confidence:

- **P0** blocks launch · **P1** before a real client account connects · **P2** before scale ·
  **P3** hardening
- **CONFIRMED** (verified in code or against an authoritative source) · **LIKELY** · **UNVERIFIED**

**Verification burden.** `developers.facebook.com` and `developers.tiktok.com` were unreachable from
the audit environment, so every claim about platform API behaviour and platform policy rests on
secondary sources, as does the Jordanian law analysis. Each section flags what a human must confirm
before acting on it. The highest-priority confirmation is the Instagram `online_followers` timezone
question, because the fix for the Planner depends on the answer.

**What is proven rather than asserted.** Three data-integrity defects are demonstrated numerically
by runnable scripts in `verify/proofs/`, which drive the real `syncAccount()` against mocks whose
correct answer is known in advance. The test-suite findings are demonstrated by mutation testing
against the real source. Those are the strongest claims in this document.

---

# Part I — Verdict

**The product is achievable. This build is not launchable, and no real client account should be
connected to it.**

Twenty-four P0-class findings. The shape of the problem is not that there are bugs; it is that
**every layer that should have caught a bug is blind.**

Two of the three integrations cannot function at all right now. Meta fails because the pinned API
version expired in May 2026 and the metrics requested were removed by Meta in 2025. TikTok has never
worked at all, because a success envelope is misread as an error. The sync's error handling then
converts those failures into zeros and writes them over real client history permanently, marking the
day synced so it is never refetched. And the test suite that should have caught any of it has a
measured mutation score of 0/13.

The consequence is that the system cannot report its own failure. Monitoring returns HTTP 200 while
Meta has been broken for three months. Tests print PASS while the code stores wrong numbers. The
dashboard shows "connected" for a TikTok account that has never stored a single metric.

**On achievability.** Nothing this product needs is unavailable, and comparable products exist. The
architecture is a sound, conventional choice, and several instincts in it are good: the isolated
Postgres schema, RLS default-deny on every table, and tokens held in a policy-less table the client
can never reach. The audit found a great deal because the system has never faced a real client, not
because the foundation is wrong.

**On effort.** The engineering is ordinary work, estimated at six to ten weeks for a small focused
team, with wide error bars. Only the sync scheduling needs rework rather than repair. Note that the
bug fixes are the small part; the bulk is rebuilding the test suite around a real oracle and adding
observability, and that ratio should be resisted if it starts to invert.

**On what actually gates launch.** Not the code. Meta App Review, Business Verification, the Data
Use Checkup and the Data Protection Assessment, plus TikTok's review — weeks to months, partly
outside the operator's control, with real rejection risk. There is a sequencing trap here: a review
screencast cannot be recorded today, because it would show a dashboard full of zeros. The critical
path is therefore to fix the integrations far enough to demonstrate truthfully, submit for review,
and complete the remaining engineering while review is pending. Legal runs in parallel and needs
Jordanian counsel now.

**The two structural risks.**

1. *Deprecation is a permanent tax, not a one-off migration.* Meta removed impressions in 2025,
   removed Page metrics in November 2025, expires API versions roughly every two years, and made
   `page_fans_*` unavailable for Pages connected after March 2024. A standing watch on the platform
   deprecation schedules must be a funded, recurring function of the business. It is the cheapest
   item in this entire audit and it is what would have prevented the current state.
2. *`business_management` should be dropped before anyone connects.* Every other scope requested is
   read-only; that one is not. It is the difference between a database breach being a data leak and
   being business-asset compromise across clients' Meta estates. For a business whose plan is
   custodying tokens for major accounts, removing it has the highest ratio of existential-risk
   reduction to effort anywhere here.

**Recommendation.** Launch narrower than planned: one platform (Instagram via Facebook Login is the
highest-value for influencers), a handful of friendly accounts, and a hard gate that the numbers are
reconciled against those accounts' native insights before any paying client sees anything. That
single reconciliation step would have caught the frozen days, the date shift and the zero-overwrite,
all three, without any of this audit.

The thing most likely to kill this is not any bug listed below. It is putting the product in front
of a large client while the system still cannot tell you it is wrong, so that the next silent
failure is discovered by the client rather than by the operator.

**On "zero chance of problems."** That target is not reachable, and aiming at it directly is how the
expired API version went unnoticed for three months: nobody was watching a calendar. What is
reachable is no known unmitigated risk class, an oracle-backed test suite that can actually fail,
logging good enough to scope an incident inside the PDPL's 24-hour window, and a standing watch on
platform deprecations.

---

# Part II — The P0 findings

## Cannot function at all

**1. Graph API v19.0 expired 21 May 2026.** Pinned in `netlify/functions/_sync.ts:3`,
`oauth-meta-callback.ts:37`, and separately in `oauth-meta.ts:25` (the login dialog, on a different
host — easy to miss when bumping). Current version is v25.0. CONFIRMED.

**2. TikTok has never worked.** `getJson` (`_sync.ts:312-317`) throws on any truthy `body.error`,
but every TikTok v2 response carries `error:{code:"ok"}` on success. `syncTiktok` calls it as its
first statement with no `.catch()`. `postJson` immediately below guards correctly with
`j.error.code !== "ok"`; `getJson` never got the same guard. Nothing is written — no metrics, no
content, no `last_synced_at` — and because the thrown text does not match the `/token|expired/`
regex, the account displays as "connected" and healthy. CONFIRMED.

**3. The metrics requested no longer exist.** Instagram `impressions` and `plays` were removed in
April 2025; Facebook `page_impressions`, `page_fans` and `post_impressions` in November 2025. Their
replacements are `views`, `page_media_view`, `page_follows` and `post_media_view`. Additionally
`page_fans_gender_age` and `page_fans_country` are unavailable for Pages connected after March 2024,
so **the Facebook Audience page can never work for a new creator**, whatever else is fixed.

## Destroys or falsifies client data

**4. One rate-limit response permanently erases 30 days of history.** Every insights call is wrapped
in `.catch(() => ({data:[]}))`; `?? 0` converts the empty result into zeros; the upsert overwrites
the real stored values; `last_synced_at` then advances so `backfillStart` never refetches them. The
schema cannot express "unknown" (`bigint not null default 0`). Meta throttling the app destroys
customer data. CONFIRMED.

**5. Every day is frozen at partial data.** After the first sync each day is written exactly once,
at 06:00 UTC (09:00 Amman), and never revisited. Proven in `verify/proofs/p3-frozen-days.mjs`.
CONFIRMED.

**6. Days are filed under the wrong date for accounts at UTC offset ≤ 0.** 30/30 rows wrong for Los
Angeles and New York; 0/30 for Amman, London (BST) and Tokyo. Proven in
`verify/proofs/p1-date-shift.mjs`. Latent rather than absent for a Jordanian roster: the trigger is
the account's platform timezone, which a client can change at any time. CONFIRMED.

**7. "Best time to post" names the wrong weekday** for affected accounts, and states no timezone at
all next to the recommendation. Proven in `verify/proofs/p2-best-time.mjs`. CONFIRMED, with the
caveat in Part V that Instagram's hour keys may use a fixed timezone, which would mean Jordan's
offset does not rescue this one.

## Security

**8. A free signup can steal a client's Pages and Instagram tokens into their own tenant.** The
OAuth `state` (`_lib.ts:44-65`) is signed but not bound to a browser session, not single-use, and
valid for 15 minutes. The attacker starts a connect flow, reads their own state from the URL, and
sends the victim a platform dialog URL carrying it; if the victim has ever authorised the app,
the platform returns the code with no interaction. `saveAccount(db, state.uid, …)` then writes every
one of the victim's Pages and linked Instagram accounts, with live tokens, under the attacker's
`user_id`. Identical and worse on the TikTok path. CONFIRMED.

**9. `OAUTH_STATE_SECRET` falls back to a constant published in this repo** (`_lib.ts:17`). Unset in
Netlify, anyone can forge a state for any uid. Fails open, silently — unlike `admin()`, which fails
closed on missing credentials. CONFIRMED.

**10. `/api/ai` is an uncapped proxy on the org key.** The client supplies the entire system prompt
and the full message history including fabricated assistant turns; `uid` is checked once and never
used again; there is no quota. $0.094 per request; one abuser at five requests per second is roughly
$40k/day, against open signup with email confirmation disabled per the README. CONFIRMED.

## Operational

**11. The cron dies at about 8 accounts.** Netlify caps scheduled functions at 30 seconds and a
scheduled function cannot be `-background`. Measured cost per account against the real call counts
gives roughly 6 Instagram or 8 mixed accounts before the invocation is killed. The fifth Page of a
single agency stops the platform. CONFIRMED.

**12. `fetchMetrics` truncates the newest days.** No `.limit()`, ordered by date *ascending*, so
PostgREST's 1000-row cap drops the most recent data — at roughly 11 accounts over 90 days. It
poisons the dashboard, CSV, PDF, share links and the AI's grounding simultaneously. CONFIRMED.

**13. Deploy Previews run with the production service-role key against the production database.**
No `[context.*]` block in `netlify.toml`, and per the README env vars are global. CONFIRMED.

**14. `schema.sql`'s second edit is a silent no-op.** `create table if not exists` throughout: the
migration appears to succeed with exit 0, deployed code then hits `PGRST204`, and syncing stops
estate-wide with no error anywhere. The third edit produces undiagnosable drift. CONFIRMED.

**15. Zero logging in all eight functions**, and the cron returns HTTP 200 on `0/450`. The absence
of a run produces no artefact at all. Proof that this is P0 rather than P2: the v19.0 expiry has
been breaking Meta for three months and the system reports success. CONFIRMED.

## Jordan PDPL (Law No. 24 of 2023, fully in force since 17 March 2025)

**16. No lawful basis for the follower demographics, and none for the captions.** Consent is the
default basis under the PDPL and there is no legitimate-interests limb. LIKELY — counsel to confirm.

**17. No consent capture anywhere in the product.** CONFIRMED.

**18. The 24-hour breach-notification deadline is unmeetable.** With no logging and no audit trail,
the scope of a breach could not be established at all. CONFIRMED.

**19. A DPO is likely required** on the cross-border limb alone. LIKELY — counsel to confirm.

**20. Supabase, Netlify and Anthropic are all cross-border transfers** with no adequacy assessment,
no documented basis and no transfer file. Region selection is therefore a compliance decision, not a
latency one. CONFIRMED.

## Platform review blockers

**21. No privacy policy, terms, data-deletion instructions, data-deletion callback, or deauthorize
callback exist.** Data-deletion problems are among the most common App Review rejection reasons, and
an endpoint that acknowledges without deleting is itself an enforcement risk.

**22. Disconnect neither revokes nor deletes** — it flips a status column (`Connections.tsx:51`).
The token stays live and stored, the collected data stays, and the platform still shows the app as
authorised. Worse, the revocation **cannot be implemented as designed**, because the long-lived
*user* token is never persisted (`oauth-meta-callback.ts:65`). Storing it is a prerequisite for
revocation, refresh and Page re-discovery alike. CONFIRMED.

**23. No token refresh anywhere.** `refresh_token` and `expires_at` are written and never read.
TikTok access tokens expire in 24 hours and can be refreshed without user consent; instead the app
lets them die and asks the user to redo the full OAuth flow. Repeated authorisation churn across
many creator accounts is itself a pattern that draws platform attention. CONFIRMED.

## The safety net

**24. Mutation score 0/13.** Thirteen defects injected into real source — including reach ×10,
followers forced to 0, the date key shifted five days, `onConflict` removed, and rows written under
`account_id:"SOMEONE-ELSES-ACCOUNT"` — all survived, eleven with byte-identical output. There is no
`process.exit(1)` or assertion anywhere in `verify/`; `empty-account.test.mjs` prints
`RESULT: FAIL — N problem(s)` and exits 0; runners end in `grep -h "^RESULT"`, testing that the line
exists rather than what it says. The OAuth suite prints `ok` with the CSRF check deleted. The most
adversarial script in the directory imports a build target nothing produces and has never run.
Root cause: **there is no oracle anywhere** — nothing compares against a known-correct answer, which
is why fixing three tests would be the wrong response. CONFIRMED by mutation testing.

---

# Part III — Corrections register

Claims made earlier in this audit that later passes overturned. Recorded because a reader who acted
on the earlier version would be misled.

| Claim | Status |
|---|---|
| Session JWT leaks to facebook.com via `Referer` | **Wrong mechanism.** Browsers carry the original referrer through a 302. It leaks via browser history, Netlify request logs and TLS-terminating proxies. Severity stands. |
| Share links expose audience demographics | **Wrong.** The payload holds totals, per-platform counts, ten verbatim captions and anomaly dates. Expiry and revocation are still needed; the privacy exposure is narrower than stated. |
| Broad `grant all` is a live cross-tenant read path | **Wrong.** RLS is default-deny and enabled on every table. The real risk is the forward-looking `alter default privileges` clause, which makes any future table world-writable on one forgotten line. |
| `ai.ts` model pin is a defect | **Overstated.** `claude-opus-4-8` is current and valid at identical pricing. The real defect is a non-streaming 900-token call behind a 10s limit with thinking disabled, which makes responses longer rather than shorter. |
| A cron killed mid-loop permanently loses a day for everyone | **Wrong.** Gaps self-heal, because the next run refetches them as complete days. Permanent only for TikTok (always), gaps over 29 days, and the zero-overwrite case (P0 #4). |
| `DELETE /{user-id}/permissions` is the disconnect fix | **Not implementable as written** — the user token is never stored. Store it first. |
| Converting `end_time` to the account timezone fixes the day shift | **Insufficient and possibly harmful.** Evidence suggests Instagram's `online_followers` uses a fixed timezone while Facebook follows the Page's; a single blanket conversion would make Instagram rows newly wrong. Verify before writing the fix. |
| `sync-cron` is publicly invokable | **Wrong.** Netlify blocks URL invocation of scheduled functions (which is why they do not work on password-protected sites). One residual check remains: whether the `/api/*` rewrite in `netlify.toml` bypasses it. Test once against the deployed site. |

---

# Part IV — Sequenced remediation

Order matters; several fixes are unsafe if landed before their prerequisites.

1. **Stop the bleeding.** Fail closed on a missing `OAUTH_STATE_SECRET`. Add logging and an alert on
   cron failure. Stop writing fabricated zeros — distinguish "the platform returned 0" from "the
   platform returned nothing", and make the schema able to express unknown.
2. **Close the account-takeover.** Nonce-bind the OAuth state on both providers (random nonce in the
   state and in an HttpOnly, SameSite=Lax cookie, required to match, then cleared), and refuse to
   attach an `external_id` already owned by another tenant.
3. **Make the integrations function.** Graph v25.0 at all three pins, the `views` migration, the
   TikTok `getJson` envelope guard, and error classification by numeric code rather than message
   regex.
4. **Verify the timezone semantics** against one real API response per platform, then fix the day
   boundary and re-fetch a trailing window on every sync instead of only the gap.
5. **Make credential custody safe.** Persist the user token; add locking to `account_secrets`
   *before* adding token refresh (two concurrent TikTok refreshes would otherwise consume the
   rotating refresh token twice and leave the account unrecoverable); then refresh,
   revoke-and-delete on disconnect, `appsecret_proof`, and encrypted token storage.
6. **Build the legal surface.** Consent capture, deletion and export paths, a retention schedule,
   audit logging, privacy/terms/deletion pages, the data-deletion and deauthorize callbacks, the
   cross-border transfer file and a deliberate region posture. Jordanian counsel to sign off.
7. **Replace the safety net.** Real assertions with an oracle; promote `verify/proofs/` to tests;
   mutation score as the acceptance gate; CI that runs it.
8. **Then scale.** Fan out the cron, paginate every query (internal and `/me/accounts`), handle rate
   limits and backoff, per-tenant quotas, share-link expiry, indexes, PITR.

**Do not connect a real client account before step 5. Do not onboard an agency before step 8.**

---


---


# Known gaps in this audit

Three specialist passes were cut short by an infrastructure limit before completing their briefs.
Their partial reports are included in full and are substantial, but the following was never reached
and remains unaudited:

- **TikTok** (Appendix B) — Display Requirements and branding rules, the sandbox-to-production
  review process, and the TikTok-specific data-correctness analysis (§5-§7 of its brief). Also
  unresolved: whether TikTok's developer programme accepts app registration from a Jordanian entity.
  Jordan is a supported TikTok location for Ads Manager, but developer registration is not publicly
  documented. **This is the one open item that could be a hard blocker rather than a delay** —
  confirm it with TikTok directly before committing to a TikTok launch date.
- **Privacy** (Appendix F) — controller/processor roles, the AI feature as an onward transfer, data
  subject rights mechanics, the retention schedule, share-link exposure, the platform-terms/PDPL
  interaction, the required transparency artefacts, and breach readiness (§4-§11 of its brief).
- **Launch procedure** (Appendix G) — the ordered pre-launch checklist (§7 of its brief), which was
  intended to be the operator's day-to-day runbook.

Additionally, no pass covered frontend accessibility, mobile behaviour, or internationalisation
(including right-to-left support, which may matter for a Jordanian client base).

---

# Part V — Operating from Jordan

# Operating from Jordan: what changes

Context: the operator, the software and the clients are all in Jordan. The origin of the clients'
connected social accounts is not known. This note records what that changes in
[`LAUNCH-AUDIT.md`](LAUNCH-AUDIT.md) and [`DATA-INTEGRITY.md`](DATA-INTEGRITY.md).

Net effect: one P0 is de-escalated (conditionally), one is unchanged, and a **new body of law
applies that no earlier pass considered**.

---

## 1. The date-shift defect (D2/D3) does not bite at Jordanian time — conditionally

Jordan is **UTC+3 year-round**; daylight saving was abolished in October 2022, so there is no
seasonal offset change ([Time in Jordan](https://en.wikipedia.org/wiki/Time_in_Jordan),
[The National](https://www.thenationalnews.com/mena/2022/10/05/jordan-scraps-clocks-moving-to-winter-time/)).

D2 shifts a day only when the account's UTC offset is **≤ 0**. Re-running
`verify/proofs/p1-date-shift.mjs` with an Amman account:

```
### Amman page (Asia/Amman, UTC+3)   rows wrong: 0/30   window error: 0 (0.00%)
### Amman, incremental (cron path)   rows wrong: 0/1
```

> **Caveat added after the Meta API review — this result covers the *daily insights* path only.**
> The Meta audit finds evidence that Instagram and Facebook use *different* day boundaries: Facebook
> follows the Page's own timezone, while Instagram's `online_followers` hour keys appear to be in a
> **fixed Pacific time**, not account-local. If that holds, the best-time-to-post defect (D3) is
> **not** resolved by Jordan's +3 offset — an Amman account's heatmap would be shifted by ~10 hours
> regardless — and a naive "convert everything to account timezone" fix would make Instagram rows
> newly wrong. This is the single highest-priority item to verify against a real Graph API response
> before any timezone fix is written. Treat section 1's clean result as applying to `reach` /
> `impressions` / `follower_count` day series, not yet to the Planner.

**The condition is the account's timezone as configured on the platform, not where the company or
the client sits.** That means:

- A Page created or administered from abroad, or one left on a US default, is at a negative offset
  and every one of its days is wrong.
- A client can change their Page timezone at any time, silently flipping their data between correct
  and incorrect with no signal in the product.
- A mixed roster is the worst case: some clients correct, some wrong, no way to tell which from the
  dashboard — harder to detect than a uniform bug.

**Therefore the fix is still required**, and is unchanged: read each account's `timezone_id` /
`timezone_offset_hours_utc` at connect time, convert `end_time` into that zone before taking the
date, and store the zone on the row. Until then, audit the timezone of every connected account and
treat any non-positive offset as producing invalid history.

Severity for a roster confirmed to be entirely Amman-configured: **P2** (latent, one Page change
away from returning). For any roster including a non-positive-offset account: **P0**, unchanged.

## 2. The frozen-day defect (D1) is unaffected

D1 depends on the cron schedule, not on geography. `sync-cron.ts` fires at `0 6 * * *` UTC = **09:00
Amman**, so each Jordanian calendar day is written once holding roughly its first nine hours, then
never revisited. Still **P0**, still the highest-priority correctness fix.

## 3. Jordan's PDPL applies, and it is fully in force

Personal Data Protection Law **No. 24 of 2023**: effective 17 March 2024, with the one-year grace
period ending **17 March 2025** — so it is fully enforceable now
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/),
[Digital Watch Observatory](https://v45.diplomacy.edu/resource/jordans-personal-data-protection-law-no-24-of-2023)).

Two provisions bear directly on this architecture:

**Cross-border transfer.** Personal data may not be transferred outside Jordan to a recipient
offering protection lower than the PDPL requires. Every piece of infrastructure here is outside
Jordan — Supabase (database and tokens), Netlify (hosting and function logs), Anthropic (the AI
assistant). Each is a cross-border transfer of Jordanian data subjects' personal data and needs a
documented basis and an adequacy assessment.

**Data Protection Officer.** A DPO is required in specified cases, and cross-border transfer is one
of the named triggers. On the current design, one is very likely required.

Also unchanged from the earlier pass and now doubly relevant: there is no deletion path, no
retention policy, no export, and no audit log — the PDPL expects data-subject rights and complaint
handling, and none of the code supports them.

**Region selection is now a compliance decision, not a latency one.** Supabase and Netlify default
to US regions; deliberately choose the region and record why.

## 4. GDPR is not automatically out of scope

Being outside the EU does not settle it. The product processes audience demographics — including
country breakdowns — describing the clients' **followers**, who are third parties with no
relationship to PulseBoard and who may be in the EU or UK. Whether that constitutes monitoring
under GDPR Article 3(2) is a question for counsel, not for this document, but it must be asked
rather than assumed away.

## 5. Platform verification is practical but adds friction

- **Meta Business Verification** accepts a national business registration document where the country
  is not specifically listed, so a Jordanian commercial registration should work. Documents not in a
  supported language need an English translation carrying an official stamp from a recognised
  translation agency — budget time for this
  ([requirements overview](https://singhamandeep.com/meta-business-verification-documents-required/)).
- **TikTok**: Jordan is a supported location in TikTok's MENA list. Country restrictions on
  *developer app registration* specifically are not publicly documented — **verify directly with
  TikTok before committing to the TikTok integration timeline**, as this is the one item here that
  could be a hard blocker rather than a delay.

## 6. Nothing else in the two audits changes

Every other finding — the expired Graph API version, removed metrics, absent token refresh, the
OAuth state-replay account-takeover, disconnect not revoking, the missing deletion endpoint, rate
limiting, and a test suite with a mutation score of 0/13 — is geography-independent and stands as
written.


---

# Part VI — Proven data-integrity defects

# Data-integrity defects in the sync

Companion to [`LAUNCH-AUDIT.md`](LAUNCH-AUDIT.md). That document covers whether the integration is
*allowed* to run and whether it is *safe*. This one covers a separate and equally serious question:
**when it does run, are the numbers right?**

They are not. Three defects are demonstrated numerically by the scripts in
[`verify/proofs/`](../verify/proofs/), each of which drives the real `syncAccount()` against a mock
whose correct answer is known in advance. All three are silent — nothing errors, no test fails, and
the dashboard renders a confident, wrong chart.

These matter more than they look. A client comparing PulseBoard against the native Instagram or
Facebook insights app will find that every single day disagrees. That is how trust is lost, and it
is not recoverable by fixing the bug afterwards — the historical rows stay wrong until backfilled.

---

## D1. Every day after connection is frozen at ~6 hours of data. P0, CONFIRMED.

`backfillStart()` in `netlify/functions/_sync.ts` fetches only days *after* the newest stored row.
`verify/proofs/p3-frozen-days.mjs` replicates it across four consecutive cron runs:

```
cron on 2026-08-20: start=2026-07-22 -> refetches 30 days   (initial backfill: complete days)
cron on 2026-08-21: start=2026-08-21 -> refetches 1 day
cron on 2026-08-22: start=2026-08-22 -> refetches 1 day
cron on 2026-08-23: start=2026-08-23 -> refetches 1 day

each day written exactly 1x, on the day itself
```

`sync-cron.ts:34` fires at `0 6 * * *`. So each day is written once, at 06:00 UTC, holding at most
the first six hours of that day — and is never revisited. Platform insight values also keep settling
for hours or days after the fact, so even those six hours are provisional.

Worse branch: days are built as `reach: reachByDate[date] ?? 0` (`_sync.ts` ~line 117). Any day the
platform does not return a value for — very likely including the current, incomplete day — is
written as a fabricated **0** and frozen at 0 permanently.

**What the client sees.** Thirty complete days of backfilled history, then a cliff at the moment they
connected, with every subsequent day at a fraction of truth or zero. The anomaly detector
(`src/lib/analytics.ts:51`) fires "Reach dropped" at that boundary, and the AI assistant repeats it
as fact. A client reasonably concludes their reach collapsed the day they started using PulseBoard.

**Fix.** Always re-fetch a trailing window (at least 7 days) on every sync rather than only the gap;
the upsert overwrites, so this is cheap and self-healing. Separately, never write a fabricated `0`:
distinguish "the platform returned 0" from "the platform returned nothing", and mark the current
day provisional so the UI can render it as incomplete rather than as a drop.

---

## D2. Every daily metric is filed under the wrong date for accounts at UTC offset ≤ 0. P0, CONFIRMED*

`seriesFromInsight()` (`_sync.ts`) keys each value by `v.end_time.slice(0, 10)`. Meta's `end_time`
is the **end** of the period — local midnight at the start of the *following* day, expressed in UTC.
For an account at a non-positive UTC offset that instant falls on the next calendar date, so day D's
value is stored under D+1.

`verify/proofs/p1-date-shift.mjs` plants a known reach value per day and reports what was stored:

| Account timezone | Offset | Rows wrong |
|---|---|---|
| America/Los_Angeles (PDT) | −7 | **30 / 30** |
| America/New_York (EDT) | −4 | **30 / 30** |
| UTC (Accra, London in winter) | 0 | **30 / 30** |
| Europe/London (BST) | +1 | 0 / 30 |
| Asia/Tokyo (JST) | +9 | 0 / 30 |

```
2026-08-23: stored reach=1022  true=1023  WRONG (this is the value for 2026-08-22)
```

So the entire Americas — where most large creator accounts are — gets every day shifted by one.
Window totals stay almost right (they differ only at the edges, 0.00% here), which is exactly why
this survives review: the headline number looks fine while every point on the chart is wrong.

**Consequences.** Day-level charts are off by one; anomaly alerts fire on the wrong date; day-of-week
analysis is shifted; and every day disagrees with the client's native insights app. It also compounds
D1: on the incremental path the single day written holds the *previous* day's value under today's
date.

**Fix.** Read each account's timezone (`timezone_id` / `timezone_offset_hours_utc` on the Page,
and the IG account's own setting), convert `end_time` to that timezone before taking the date, and
store the account timezone alongside the row so the frontend can label it. Decide explicitly whether
the product reports in account-local time (right for "best time to post") or a single reporting
timezone, and state it in the UI.

\* CONFIRMED against Meta's *documented* `end_time` convention, which the proof models. Validate
against one real Graph API response before acting — see `verify/proofs/README.md`.

---

## D3. "Best time to post" tells US accounts the wrong day. P0, CONFIRMED*

The same day-boundary error propagates through `bucketOnline()` (`_sync.ts`, which buckets by
`getUTCDay()` and uses the hour keys verbatim) into `activeGrid()` / `bestTimes()`
(`src/lib/analytics.ts:15-39`). `verify/proofs/p2-best-time.mjs` plants an audience that genuinely
peaks **Saturday 20:00 local** and asks the Planner what it advises:

| Account | Truth | App advises |
|---|---|---|
| America/Los_Angeles (PDT) | Saturday 8pm | **Sunday · 8pm** |
| Asia/Tokyo (JST) | Saturday 8pm | Saturday · 8pm ✓ |
| Europe/London (BST) | Saturday 8pm | Saturday · 8pm ✓ |

Note also the spurious `12am` / `1am` windows that appear in every account's top three — an artifact
of summing across the day boundary — and that the UI states no timezone at all next to the
recommendation, so even a correct hour is ambiguous.

This is the most action-driving feature in the product: it is advice a client will actually follow,
and for US accounts it names the wrong day.

**Fix.** As D2, plus label every recommendation with the timezone it is expressed in, and suppress
windows whose support comes from fewer than N observed days.

---

## D4. Content is never filtered by the selected date range. P1, CONFIRMED.

`fetchContent()` (`src/lib/api.ts:38`) selects the top 200 posts by views **across all time**, with
no date predicate, and `Content.tsx:32` then filters by platform only. The range control does not
reach it. So:

- the Content page shows all-time posts while the header says "Last 7 days";
- `buildCsv()` writes `Window,7 days` and then lists all-time content (`src/lib/reports.ts`);
- `buildSnapshot()` puts all-time top posts under a "last 7 days" heading — including in the
  **public share link** (`src/lib/snapshot.ts:194`);
- `summarizeForAI()` feeds them to the assistant as the window's top performers
  (`src/lib/analytics.ts:128`), so it will attribute a post from eight months ago to this week.

A client sends a sponsor a seven-day report headlined by last year's viral post.

**Fix.** Filter content by `published_at` against the active range everywhere the range is claimed,
and fetch content per range rather than all-time.

---

## D5. CSV export is open to formula injection. P1, CONFIRMED.

`esc()` (`src/lib/reports.ts:108`) wraps in quotes and doubles inner quotes. Quoting does **not**
stop Excel or Google Sheets evaluating a field beginning with `=`, `+`, `-`, `@`, tab or CR. Post
titles come from platform captions, and these exports get emailed to sponsors and brands — so the
blast radius is the client's commercial contacts, not the client.

**Fix.** On export, prefix any value starting with those characters with a `'`, in addition to
quoting.

---

## D6. Checked and NOT a defect

Recorded so it is not re-raised: `buildCsv` uses `seriesByDay(..., "followers")` while the dashboard
uses `followersByDay()`. These look inconsistent but agree, because `metrics_daily`'s primary key is
`(account_id, date)` — exactly one row per account per day — so both reduce to the same per-day sum.

---

## Why the existing test suite passes anyway

`verify/` asserts on shape, not truth: it scans for `NaN`, `Infinity`, negatives and thrown errors.
Every defect above produces a clean, plausible, finite number. D1 additionally passes because the
suite tests a *first* sync (30 complete days) and never simulates the second day's incremental run.

Any fix should land with the corresponding proof script promoted to an assertion, plus a test that
runs two consecutive syncs and checks that day one's value is corrected on day two.


---

# Part VII — First-pass launch audit

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

> **See also [`DATA-INTEGRITY.md`](DATA-INTEGRITY.md)** — a separate class of defect found in a
> later pass and proven numerically in [`verify/proofs/`](../verify/proofs/): once the integration
> is fixed and running, the numbers it stores are still wrong. Three further P0s live there
> (days frozen at ~6 hours of data, every day filed under the wrong date for US accounts, and
> "best time to post" naming the wrong day).

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


---

# Appendix A — Meta platform compliance (full report)

# R2 — Meta platform correctness & compliance audit (PulseBoard)

Branch `claude/analysis-35bck4`. Date of audit: 2026-08-23. Domain: Meta (Facebook Graph +
Instagram) API correctness, platform policy, review readiness, rate limits, account safety.

Extends `docs/LAUNCH-AUDIT.md` (L-numbers) and `docs/DATA-INTEGRITY.md` (D-numbers). Findings
are numbered **M1..Mn**. Where I contradict or narrow an earlier finding I say so explicitly.

Severity: P0 blocks launch · P1 before any real creator account · P2 before scale · P3 hardening.
Confidence: CONFIRMED (read in code / stated by ≥2 independent sources) · LIKELY · UNVERIFIED.

> **NETWORK CAVEAT.** `developers.facebook.com` was unreachable from this environment. Every
> API/policy claim below is sourced from secondary documentation (vendor docs, changelog
> mirrors, community threads) and is marked with the verification burden. **Every row of the
> migration table in §1/§2 must be re-checked against the official Graph API changelog and
> reference pages before code is changed.** Treat this as the checklist, not the proof.

---

## §1 — Complete inventory of Meta API calls

15 distinct Meta HTTP calls exist in the codebase. All pinned to **v19.0**.

### 1a. OAuth / connect path

| # | Site | Method + endpoint | Params / fields | Permission | Response shape assumed by code |
|---|---|---|---|---|---|
| O1 | `oauth-meta.ts:25` | `GET https://www.facebook.com/v19.0/dialog/oauth` | `client_id`, `redirect_uri`, `state`, `scope`, `response_type=code` | n/a (dialog) | browser redirect w/ `?code=` |
| O2 | `oauth-meta.ts:15-23` | scope string | `public_profile, pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights, business_management` | — | — |
| O3 | `oauth-meta-callback.ts:53` | `GET {GRAPH}/oauth/access_token` | `client_id, client_secret, redirect_uri, code` | n/a | `{access_token, token_type, expires_in}` — code reads only `.access_token` |
| O4 | `oauth-meta-callback.ts:60` | `GET {GRAPH}/oauth/access_token` | `grant_type=fb_exchange_token, client_id, client_secret, fb_exchange_token` | n/a | `{access_token, expires_in}` → `expires_at` computed at :66 |
| O5 | `oauth-meta-callback.ts:69` | `GET {GRAPH}/me/accounts` | `fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}` | `pages_show_list` (+`instagram_basic` for the IG edge) | `{data:[{id,name,access_token,instagram_business_account:{...}}]}` — **`paging` ignored** (:73-79) |

### 1b. Instagram sync (`syncInstagram`, 6 call sites → 9 HTTP calls/sync)

| # | Site | Endpoint | Fields / metrics | Params | Permission | Assumed response shape |
|---|---|---|---|---|---|---|
| I1 | `_sync.ts:77` | `GET /{ig-user-id}` | `fields=followers_count,media_count` | — | `instagram_basic` + `pages_read_engagement` | `{followers_count, media_count}` |
| I2 | `_sync.ts:82` | `GET /{ig-user-id}/insights` | `metric=reach,impressions` | `period=day`, `since`, `until` | `instagram_manage_insights` | `{data:[{name,values:[{value,end_time}]}]}` via `seriesFromInsight` (:288) |
| I3 | `_sync.ts:85` | `GET /{ig-user-id}/insights` | `metric=total_interactions` | `period=day`, `since`, `until` | `instagram_manage_insights` | same `values[]` shape |
| I4 | `_sync.ts:87` | `GET /{ig-user-id}/insights` | `metric=follower_count` | `period=day`, `since`, `until` | `instagram_manage_insights` | same `values[]` shape |
| I5 | `_sync.ts:93` | `GET /{ig-user-id}/media` | `fields=id,caption,media_type,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,plays)` | `limit=25` | `instagram_basic` (+ `instagram_manage_insights` for the nested insights) | `{data:[{...,insights:{data:[{name,values:[{value}]}]}}]}` via `normInsights` (:329) |
| I6a-c | `_sync.ts:141` ×3 | `GET /{ig-user-id}/insights` | `metric=follower_demographics` | `period=lifetime`, `timeframe=this_month`, `breakdown=age\|gender\|country`, `metric_type=total` | `instagram_manage_insights` | `data[0].total_value.breakdowns[0].results[].{dimension_values,value}` (:335) |
| I7 | `_sync.ts:145` | `GET /{ig-user-id}/insights` | `metric=online_followers` | `period=lifetime` **(no `since`/`until`)** | `instagram_manage_insights` | `data[0].values[] = [{end_time, value:{"0".."23": n}}]` → `bucketOnline` (:352) |

### 1c. Facebook Page sync (`syncFacebook`, 4 HTTP calls/sync)

| # | Site | Endpoint | Fields / metrics | Params | Permission | Assumed response shape |
|---|---|---|---|---|---|---|
| F1 | `_sync.ts:159` | `GET /{page-id}` | `fields=fan_count,followers_count` | — | `pages_read_engagement` | `{fan_count, followers_count}` |
| F2 | `_sync.ts:164` | `GET /{page-id}/insights` | `metric=page_impressions,page_post_engagements,page_fans` | `period=day`, `since`, `until` | `read_insights` | `{data:[{name,values:[{value,end_time}]}]}` |
| F3 | `_sync.ts:169` | `GET /{page-id}/posts` | `fields=id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true),insights.metric(post_impressions)` | `limit=25` | `pages_read_engagement` + `read_insights` | `{data:[{shares:{count}, likes:{summary:{total_count}}, comments:{summary:{total_count}}, insights:{data:[...]}}]}`; `pickInsight` (:324) accepts **either** `values[0].value` **or** `total_value.value` |
| F4 | `_sync.ts:207` | `GET /{page-id}/insights` | `metric=page_fans_gender_age,page_fans_country,page_fans_online` | `period=lifetime` | `read_insights` | `data[].values[last].value` = object map (:346); `page_fans_online` → `values[].value{hour:n}` (:352) |

**Calls per sync:** IG account = **9**; FB Page = **4**. A creator with 1 Page + 1 linked IG =
**13 Graph calls per sync**, plus 3 more (O3/O4/O5) at connect time. Used in §4.

---

## §2 — Migration checklist: every call against v25.0 (Feb 2026)

Legend: ✅ works · ⚠️ works but wrong/fragile · ❌ errors today.

### M1. STRUCTURAL: one dead metric in a comma list kills the whole request, and `.catch()` turns it into a fabricated zero. **P0, CONFIRMED (code) / LIKELY (API behaviour).**

Every Insights call in `_sync.ts` bundles several metrics into one `metric=` list and is wrapped in
`.catch(() => ({ data: [] }))` (`_sync.ts:82,85,87,93,164,169,207`). Meta returns a single
`(#100) invalid metric` error for the *whole* request when any one metric in the list is
deprecated — the valid metrics in the same call return nothing.

Then `seriesFromInsight` yields `{}`, and `days` is built with `?? 0`
(`_sync.ts:115-119`, `191-195`), so **API errors are written to the database as real zeros.**
`hasAudience()`/`try{}catch{}` (`:61-70`) does the same for demographics.

Consequences with today's API (see M2–M12): the IG daily call (I2) fails on `impressions`, so
`reach` is lost too and 30 rows of `reach=0, impressions=0, views=0` are persisted; the IG media
call (I5) fails on `plays`, so `posts=[]` *and* the engagement fallback at `:125-135` produces
`engagements=0`; the FB daily call (F2) fails on `page_impressions` **and** `page_fans`, so
`page_post_engagements` is lost too and the Page gets an all-zero chart with followers carried
flat from `prof.followers_count`.

This directly falsifies the README's headline promise ("**No mock data.** Every number comes from
a connected, synced account"): a total API failure renders as a confident chart of zeros, and
`docs/DATA-INTEGRITY.md` D1's anomaly detector then reports it to the client as a reach collapse.

**Fix (do this before any metric migration):**
1. Split every insights call to one metric per request, or at minimum catch the error and
   *retry per-metric* to isolate the failure.
2. `getJson` (`_sync.ts:312`) must check `res.ok` and surface `body.error.code` /
   `error_subcode` / `error_user_title`; never `.catch(() => ({data:[]}))` a Graph error.
3. Never write `?? 0`. Make `metrics_daily` columns nullable and write `null` for "not
   returned", so the UI can render a gap instead of a zero.
4. Add a per-sync `sync_log` row recording which metrics errored, so a deprecation is visible
   within 24h instead of after a client complains.

### M2. IG account `impressions` — REMOVED. **P0, CONFIRMED.**
`_sync.ts:82` `GET /{ig}/insights?metric=reach,impressions&period=day`.
`impressions` was deprecated for IG media *and* user insights on **21 Apr 2025** and is not
requestable on v22.0+. Requests error rather than omit.
**Replacement:** `views`. Split into two calls:
`.../insights?metric=reach&period=day&since=..&until=..` and
`.../insights?metric=views&period=day&metric_type=total_value&since=..&until=..`.
⚠️ **VERIFY:** whether account-level `views` returns a per-day `values[]` series or only a single
`total_value` for the window. If it is `total_value`-only, a daily views series is *not obtainable*
at account level and the product must say so rather than invent one.
Sources: [Emplifi](https://docs.emplifi.io/platform/latest/home/instagram-insights-metrics-deprecation-april-2025),
[Brandwatch](https://social-media-management-help.brandwatch.com/en/articles/12767947-deprecation-of-instagram-impressions-plays-and-video-views),
[Metricool](https://help.metricool.com/en/article/instagram-replaces-impressions-with-views-what-you-need-to-know-ustr2f/).

### M3. IG account `total_interactions` returns `total_value`, not `values[]` — the parser reads the wrong field. **P1, LIKELY.**
`_sync.ts:85` requests `metric=total_interactions&period=day` with **no `metric_type`**.
`total_interactions` is one of the metrics that only supports `metric_type=total_value`; the
response carries `data[0].total_value.value` and **no `values[]` array**. `seriesFromInsight`
(`:288-296`) reads `row.values` only → always `{}` → `engByDate` is always empty → the code
**always** takes the "fallback" branch at `:125`, attributing the *lifetime* engagement of the
25 most recent posts to their publish dates.
So the documented primary path for IG engagement has never executed, and IG "engagements" is in
fact a lifetime-to-date post metric filed under publish date — it keeps changing retroactively as
old posts accrue likes, and the upsert overwrites history each sync.
**Fix:** either accept that `total_interactions` is window-total-only (and stop drawing a daily
engagement line for IG), or request it with `metric_type=total_value` and a 1-day window per day.
Also handle `total_value` in `seriesFromInsight`, which today silently ignores it — note
`pickInsight` (`:324`) *does* handle both shapes, so the codebase is internally inconsistent.

### M4. IG media `plays` — REMOVED; and the metric set is invalid for non-video media anyway. **P0, CONFIRMED / LIKELY.**
`_sync.ts:93` `...&fields=...,insights.metric(reach,saved,shares,plays)&limit=25`.
`plays` was removed in the same 21 Apr 2025 change. Additionally `plays`/`shares` are not valid
for every `media_type`, so even after replacing `plays` a single request spanning images, carousels
and reels can error per-object.
**Replacement:** `insights.metric(views,reach,saved,shares,total_interactions)`, and branch by
`media_product_type` (`REELS`|`FEED`|`STORY`) rather than sending one metric list for all media.
Add `media_product_type` to `fields` — the current mapping `media_type === "VIDEO" ? "Reel"`
(`_sync.ts:99`) mislabels ordinary feed videos as Reels. **P2, CONFIRMED.**
Also `views: ins.plays ?? ins.reach ?? 0` (`:102`) silently reports **reach as views** whenever the
video metric is missing — same defect the earlier audit flagged at `:118`, but on the content table,
and it is not mentioned in `LAUNCH-AUDIT.md`.

### M5. IG `follower_demographics` — wrong `metric_type` value. **P0, LIKELY.**
`_sync.ts:141` sends `metric_type=total` but `parseDemographics` (`:335`) parses
`data[0].total_value.breakdowns[0].results[]` — the shape returned by `metric_type=**total_value**`.
The request parameter and the parser disagree; `total` is not the documented enum value for
demographic breakdown metrics.
**Fix:** `metric_type=total_value`. Keep `period=lifetime`, keep `timeframe=this_month`
(valid values are `last_14_days|last_30_days|last_90_days|prev_month|this_month|this_week`),
keep `breakdown=age|city|country|gender`.
Additional constraints the code does not handle:
- **Minimum 100 followers.** Meta returns no follower demographics below 100 followers. Caught and
  discarded at `:70` — the user sees an empty Audience tab with no explanation. **P2.**
- **Three separate HTTP calls** for age/gender/country (`:144`) where `breakdown=age,gender`
  can be combined — 3× the rate-limit cost of the demographics fetch (see §4). But note
  `parseDemographics` joins `dimension_values` with `" · "`, and `normalizeGender` (`:372`) then
  regex-matches `/^f/i` against `"25-34 · F"` → everything lands in `other`. **So combining the
  breakdowns without fixing the parser would corrupt the gender split.** **P2, CONFIRMED (code).**
- Demographics are a **point-in-time snapshot with no history** regardless of `timeframe`, yet
  `audience_snapshots` is keyed `captured_on` and the UI presents it as a dated observation.
Sources: [Phyllo](https://www.getphyllo.com/post/instagram-audience-demographics-for-influencer-marketing-platforms),
[Metricool](https://help.metricool.com/en/article/instagram-metrics-12vpkyb/).

### M6. `online_followers`: the hour keys are almost certainly NOT in the account's timezone — this changes the fix prescribed by DATA-INTEGRITY D2/D3. **P0, LIKELY — HIGHEST VERIFICATION PRIORITY.**
`_sync.ts:145` `GET /{ig}/insights?metric=online_followers&period=lifetime` (no `since`/`until`);
`bucketOnline` (`:352-361`) then does `new Date(entry.end_time).getUTCDay()` for the weekday and
uses the map keys `0..23` **verbatim** as local hours.

Three separate errors stack here:
1. **Weekday** is taken with `getUTCDay()` from `end_time`, which is the *end* of the period —
   exactly the D2 off-by-one, so for any account whose day boundary is at a non-positive UTC
   offset the whole row is filed one weekday late.
2. **Hour keys.** Multiple independent secondary sources state that Meta's Insights *API* reports
   in **Pacific time (UTC-8/-7)** while the Instagram app shows the viewer's local timezone. If
   that holds for `online_followers`, the hour keys are PT hours, and the app is presenting PT
   hours as if they were the creator's local hours — a **7–8 hour** error on top of the day error.
   `docs/DATA-INTEGRITY.md` D3 prescribes "convert `end_time` to the account timezone"; if the
   series is fixed-PT that fix is *wrong* and would leave the hours off by (account offset − PT).
3. **Window.** `online_followers` data exists only for the **last 30 days** and the call sends no
   `since`/`until`, so what is actually returned (one day? the whole 30?) is unspecified by the
   code's expectations; `bucketOnline` sums whatever it gets into a 7×24 grid with no
   normalisation by the number of observed days per weekday — a weekday that appears 5 times in
   the window outweighs one that appears 4 times purely by count.

**Fix:** (a) pin the timezone empirically — request `online_followers` for one known account and
compare the peak hour against the Instagram app's Most Active Times for the same account; (b)
store the raw hourly map plus the timezone it is expressed in, and convert once at render time;
(c) label every "best time" recommendation with that timezone in the UI; (d) pass explicit
`since`/`until` within 30 days and divide each weekday bucket by the number of days observed.
⚠️ Also verify `online_followers` still exists at all in v25.0 — it survived the Jan-2025 and
Apr-2025 IG deprecation rounds in the sources I could reach, but it is a legacy metric and the
equivalent Facebook metric (`page_fans_online`) was already removed.
Sources: [Power My Analytics — FB/IG Insights timezone mismatch](https://support.powermyanalytics.com/portal/en/kb/articles/instagram-insights-time-zone-mismatch),
[eDigital](https://www.edigitalagency.com.au/instagram/time-zone-instagram-insights-use/),
[Supermetrics — good to know about IG Insights](https://docs.supermetrics.com/docs/good-to-know-about-instagram-insights).

### M7. CHALLENGE to DATA-INTEGRITY D2: the day boundary differs between IG and FB, so one fix cannot serve both. **P1, LIKELY.**
D2 prescribes a single remedy: read the account timezone and convert `end_time`. That is right for
**Facebook Page** insights, whose day boundary follows the Page's own configured timezone
(`timezone` / `timezone_id` on the Page node). It appears to be **wrong for Instagram**, where the
Insights API day boundary is reported to be fixed Pacific time regardless of the account's
setting. If PulseBoard applies the account-timezone conversion uniformly, IG rows for non-PT
creators become *newly* wrong by (account offset − PT) instead of correct.
**Fix:** determine the boundary per platform, empirically, before changing `seriesFromInsight`;
store `reporting_timezone` on `metrics_daily` (or on `social_accounts`) so the two platforms can
disagree and the UI can say which basis a chart uses. Do not ship D2's fix as written for IG.

### M8. IG `follower_count` window constraints. **P2, LIKELY.**
`_sync.ts:87` requests `follower_count&period=day&since=..&until=addDays(today,1)`.
`follower_count` supports only the **last 30 days and excludes the current day**, and Meta rejects
insight ranges longer than 30 days. `backfillStart` (`:279`) starts at `today-29` and `until` is
`today+1` → a **31-day span** on the first sync of every account. If that trips the range check,
the call errors → caught → `deltaByDate = {}` → `reconstructFollowers` (`:298`) returns the
*current* total for all 30 days → a perfectly flat, entirely fictional followers curve on day one.
**Fix:** `since = today-30`, `until = today` (exclusive), and clamp the span to 30 days.

### M9. FB `page_impressions` and `page_fans` — BOTH REMOVED 15 Nov 2025. **P0, CONFIRMED.**
`_sync.ts:164` requests `page_impressions,page_post_engagements,page_fans` in one call. Two of the
three are gone; per M1 the third dies with them.
**Replacements:** `page_impressions` → **`page_media_view`** (profile-level "Media views");
`page_fans` → **`page_follows`**. Verify `page_post_engagements` is still live — it is not named in
the Nov-2025 removal list I could reach, but it was in earlier removal rounds for some Page types.
Note also that `views` ≠ `impressions` semantically (views count media consumption incl. replays;
impressions counted feed appearances), so **backfilled history will not be comparable to new
rows** — a step change in the chart on the migration date that must be labelled, not hidden.
Sources: [Meta for Developers blog, 15 Aug 2025](https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/) (must be read directly — I could not fetch it),
[Sprout Social](https://support.sproutsocial.com/hc/en-us/articles/39899335524493-Facebook-Metric-Deprecation-November-2025),
[Yext](https://www.yext.com/blog/facebook-is-deprecating-metrics-what-to-know).

### M10. FB `post_impressions` — REMOVED; and it is written into BOTH `views` and `reach`. **P0, CONFIRMED.**
`_sync.ts:169` requests `insights.metric(post_impressions)`; `:176` and `:181` assign the same
number to `views` and to `reach`. Impressions are neither views nor reach. Even once the metric is
migrated, the Content page will report identical views and reach for every Facebook post, which is
obviously wrong to any client who opens Meta Business Suite alongside.
**Replacement:** `post_media_view` for views; there is no post-level reach in this field set —
either request the surviving unique/reach metric explicitly or leave `reach` NULL rather than
duplicating. `LAUNCH-AUDIT.md` flags the IG reach→views conflation but not this one.

### M11. FB audience: every metric in `audienceFacebook` is dead or restricted for newly connected Pages. **P0, LIKELY.**
`_sync.ts:207` requests `page_fans_gender_age,page_fans_country,page_fans_online&period=lifetime`.
- `page_fans_online` was removed in the Sep-2024 Page Insights round.
- `page_fans_gender_age` / `page_fans_country`: Meta **removed age/gender/country audience data for
  Pages connected after 14 Mar 2024**. Every creator connecting to PulseBoard today is "connected
  after" that date.
- `page_fans_*` as a family is additionally implicated in the Nov-2025 "page fans" deprecation.
Result: the call errors, is caught at `:70`, and **Facebook Audience is silently and permanently
empty** — while the README advertises "Audience (age/gender/country + weekday×hour best-time
heatmap) syncs from IG `follower_demographics` and FB `page_fans_*`". That claim is not deliverable.
**Fix:** delete the FB audience path, state in the UI that Facebook audience demographics are no
longer available via the API for newly connected Pages, and correct the README.
Sources: [Rival IQ](https://help.rivaliq.com/en/articles/9114638-facebook-insights-metrics-deprecation-march-2024),
[Slidebeast](https://help.slidebeast.com/en/articles/9127856-update-on-deprecated-facebook-metrics-for-facebook-reports).

### M12. `fan_count` on the Page node. **P2, UNVERIFIED.**
`_sync.ts:159` requests `fields=fan_count,followers_count`. With Meta removing "likes" from Pages
and from the Insights API, `fan_count` is likely to follow. `followers_count` is the survivor and is
already the code's first choice (`:187`), but `fan_count` sits in the same `fields` list, and an
invalid field errors the **whole** node request — which would take `followers_count` down with it
and leave `currentFollowers = 0`. **Fix:** request `followers_count` only.

### M13. Graph version pin. **P0, CONFIRMED — extends LAUNCH-AUDIT #1.**
`_sync.ts:3`, `oauth-meta-callback.ts:37`, `oauth-meta.ts:25` pin `v19.0`, expired 21 May 2026.
The earlier audit says move to v25.0. One addition it misses: the **login dialog** URL
(`oauth-meta.ts:25`, `https://www.facebook.com/v19.0/dialog/oauth`) is a *separate* pin on a
*different host* and is easy to miss when bumping `GRAPH`. Both must move, plus the same constant
must be used by any new webhook/deletion endpoints. Put it in `_lib.ts` as
`export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v25.0"`.
---

## §3 — OAuth, tokens, pagination, and which Instagram product this is

### M14. `/me/accounts` is read without pagination — Pages beyond the first page are silently never connected. **P1, CONFIRMED (code).**
`oauth-meta-callback.ts:69-79` requests `/me/accounts` with **no `limit`** and iterates
`pages.data` only; `pages.paging.next` is discarded. The Graph API paginates edges (commonly 25
items by default) and returns a `paging.cursors`/`next`. A creator or agency user who administers
more than one page of Pages connects only the first slice — with **no error and no UI signal**;
`backToApp("connected", ...)` reports success (`:96`).
For the target user (managers of multiple high-value accounts) this is a silent data-loss bug at
the exact moment of onboarding.
**Fix:** `fields=...&limit=100` and loop `paging.next` until absent (cap the loop, e.g. 10 pages),
or use `/me/accounts?fields=...&after=<cursor>`. Report the count connected back to the UI.
Source: [Graph API pagination](https://reintech.io/blog/facebook-graph-api-pagination-techniques).

### M15. The long-lived **user** token is discarded — so refresh AND revocation are impossible with what is stored. **P1, CONFIRMED (code). This invalidates LAUNCH-AUDIT #4's proposed fix.**
`oauth-meta-callback.ts:65` computes `userToken`, uses it for `/me/accounts`, and never persists it.
Only **Page** tokens are stored (`:82`, `:89`). Consequences the earlier audit did not draw out:
- `DELETE /{user-id}/permissions` — the revoke call LAUNCH-AUDIT #4 prescribes — **requires the
  user token**, which no longer exists. As written, that fix cannot be implemented. Either store
  the user token (encrypted) or accept that PulseBoard can never revoke its own grant.
- Re-running `/me/accounts` later to pick up newly created Pages, or to detect Pages the user has
  since lost admin rights on, is impossible without sending the user through OAuth again.
- Refreshing (`fb_exchange_token` on a long-lived token) is impossible.

### M16. Token expiry semantics are recorded wrongly. **P2, CONFIRMED (code) / LIKELY (API).**
`oauth-meta-callback.ts:66` derives `expiresAt` from the **long-lived user token's** `expires_in`
(~60 days) and stores it against **Page** tokens (`:82`, `:89`). A Page token obtained via
`/me/accounts` using a *long-lived* user token is itself long-lived/non-expiring — it does not
die on that date. So `account_secrets.expires_at` is neither the Page token's expiry nor the user
token's (the user token isn't stored). It is a misleading value, and any future refresh logic keyed
on it will fire on the wrong schedule.
What actually kills a Page token: the user changes their password, removes the app, revokes a
permission, Meta invalidates the session, the user loses admin rights on the Page, or Meta expires
it for inactivity. **None of these are detectable from `expires_at`** — they surface only as Graph
error code 190 with a subcode. This refines LAUNCH-AUDIT #3, which frames Meta's failure as a
60-day clock; the real requirement is *event*-driven (webhook + error-code handling), not
timer-driven.
⚠️ VERIFY the non-expiring-Page-token claim against Meta's Access Token docs before relying on it.

### M17. Declined permissions are not detected; the user is told "connected" regardless. **P1, CONFIRMED (code).**
Facebook's login dialog lets the user deselect individual Pages and individual permissions. The
callback never calls `GET /me/permissions`, never checks for `denied` entries, and never uses
`auth_type=rerequest` to ask again. A user who declines `instagram_manage_insights` (or simply
does not tick the Instagram box) still lands on a green "Instagram connected" toast
(`Connections.tsx:27-31`), and then every insights call fails forever, is swallowed by
`.catch()`, and is stored as zeros (M1).
**Fix:** after the token exchange, `GET /me/permissions`; if any required scope is missing, do not
save the account — redirect back with `auth_type=rerequest` and an explicit explanation.

### M18. Every Page the user administers is connected, with no chooser. **P1, CONFIRMED (code).**
`oauth-meta-callback.ts:79-93` loops all returned Pages and calls `saveAccount` for each — plus
each linked IG account. There is no selection UI. A user who administers 12 Pages (including
dormant or client-owned ones) has all 12 tokens stored and all 12 synced daily forever. This is:
(a) a data-minimisation failure that the Data Protection Assessment will ask about;
(b) a rate-limit multiplier (§4) — and the dormant Pages are exactly the ones with near-zero
    Business-Use-Case budget, so they are the ones that will start returning throttle errors;
(c) combined with `sync.ts:132` / `sync-cron.ts:167` classifying *any* error message matching
    `/token|expired|oauth|session/i` as "expired", those throttle errors can mark healthy Pages as
    needing reconnection, producing exactly the repeated-OAuth-churn signal that draws Meta's
    attention.
**Fix:** show the returned Pages and let the user pick; store tokens only for the chosen ones.

### M19. The IG account row stores a **duplicate copy of the Page token**. **P2, CONFIRMED (code).**
`oauth-meta-callback.ts:89` writes `page.access_token` into a second `account_secrets` row for the
Instagram account. One credential, two plaintext copies, two rows to find and delete on
revocation — and deleting one leaves the other live. Store a reference to the Page's secret row
instead (`extra.page_id` is already there at `:89`).

### M20. Which Instagram product this is, and whether it survives. **INFORMATIONAL / P2, LIKELY.**
This code is **"Instagram API with Facebook Login"**: Facebook Login → `/me/accounts` →
`instagram_business_account.id` → `graph.facebook.com/{ig-user-id}/...` with a **Page** token, and
the `instagram_basic` / `instagram_manage_insights` scope family. That path **is still supported in
2026** and remains the recommended route for apps managing multiple accounts through Pages.
It is *not* "Instagram API with Instagram Login", which uses `graph.instagram.com`, Business Login,
and the `instagram_business_*` scopes (the old `business_basic` etc. were retired 27 Jan 2025).
So the earlier audits' implicit assumption is correct — but note two consequences:
- Every connected IG account **must** be a Professional account linked to a Facebook Page. The code
  never checks and never explains; a Creator account not linked to a Page simply produces
  `no_pages_found` (`:74`) or a Page with no `instagram_business_account`, and the user sees
  "Facebook connected" with no Instagram and no reason given.
- The permission set for this product is `instagram_basic` + `instagram_manage_insights` +
  `pages_show_list` + `pages_read_engagement` (+ `read_insights` for Page insights). That is what
  should be submitted. `business_management` is not part of it.
Sources: [Meta — IG API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/),
[keyapi.ai](https://www.keyapi.ai/blog/what-is-the-instagram-api/).

### M21. Content is capped at 25 items with no paging and no date window. **P2, CONFIRMED (code).**
`_sync.ts:93` (`limit=25`) and `:169` (`limit=25`) fetch only the 25 most recent items and ignore
`paging`. `src/lib/api.ts` then selects "the top 200 posts". So on first connect the Content page
covers only the last 25 posts regardless of the advertised 30-day backfill, and a prolific creator
posting >25 items between daily syncs permanently loses the ones in between.
**Fix:** page through `/media` and `/posts` with `since`/`until` matching the backfill window
(IG `/media` supports `since`/`until` on `timestamp`), with a hard cap.

---

## §4 — Rate limits: which apply, and the exact number of accounts at which this breaks

**Three independent limiters apply to these calls:**

| Limiter | Formula | Applies to | Header |
|---|---|---|---|
| Platform / app-level | **200 × (app daily active users)** calls per rolling hour, app-wide | every call in this codebase | `X-App-Usage` → `{call_count, total_time, total_cputime}` as % of limit |
| BUC — Pages | **4800 × (Page engaged users in prior 24h)** calls per 24h, per app+Page pair | F1–F4, O5 | `X-Business-Use-Case-Usage` → per business-id, incl. `estimated_time_to_regain_access` |
| BUC — Instagram | **4800 × (impressions on that IG account's content in prior 24h)** calls per 24h, per app+IG-user pair | I1–I7 | `X-Business-Use-Case-Usage` |

**Nothing in this repo reads either header.** `getJson` (`_sync.ts:312-317`) does not check
`res.ok`, does not read response headers at all, has no retry and no backoff — confirming
LAUNCH-AUDIT #9 and adding that the headers are *available on every response* and would cost
nothing to record.

**Call budget consumed by this code (from §1):**
- Facebook Page: **4** calls/sync · Instagram account: **9** calls/sync
- Typical creator (1 Page + 1 linked IG): **13** calls/sync
- Plus **3** calls at connect time (O3, O4, O5).

**Where it breaks — computed:**

1. **Netlify function timeout, not Meta, is the first wall.** `sync-cron.ts:161-171` loops every
   account in the system **serially** in one invocation. At a conservative 400 ms per Graph call,
   one creator = 13 × 0.4 s ≈ **5.2 s**. A scheduled Netlify function is subject to the standard
   function execution cap (10 s default, 26 s max for synchronous functions; background functions
   get 15 min). **At the 26 s cap the cron dies after ~5 creators.** Even as a background
   function (15 min) it caps at **~170 creators**, after which later accounts silently never sync —
   compounding the PostgREST 1000-row cap the earlier audit noted. ⚠️ Netlify's exact scheduled-
   function limit must be confirmed. **P1.**

2. **App-level (Platform) limit — the cron is the risk, because it runs when nobody is active.**
   Budget = 200 × DAU per hour. The cron fires at 06:00 UTC (`sync-cron.ts:176`) and spends
   13 × U calls in that single hour, where U = connected creators. The inequality that must hold is
   **13·U ≤ 200·DAU**, i.e. **U/DAU ≤ 15.4**.
   A weekly-check-in analytics dashboard typically runs DAU/MAU of 5–15%. At 10% (U/DAU = 10) there
   is headroom; **at 6.5% (U/DAU ≈ 15.4) the daily cron alone saturates the entire app's hourly
   budget**, and on a quiet Sunday — the realistic worst case — it exceeds it outright and every
   user's sync starts failing, including users who *are* active. There is no fixed account count:
   **the limit is a ratio, and it is breached by inactivity, not by growth.** This is exactly the
   "one user's behaviour harms every other connected account" mechanism, and the fix is to spread
   the cron across the hour/day (hash account id into a slot) and to check `X-App-Usage.call_count`
   before each account, pausing at 75%. **P1.**

3. **On-demand `/api/sync` is unthrottled and app-wide-destructive.** `sync.ts` has no minimum
   interval and no per-user cap. One scripted caller issuing a sync every 5 s spends
   13 × 720 = **9,360 calls/hour**. With 50 DAU the whole app's budget is 10,000/hour — **a single
   user exhausts the entire app in ~64 minutes and locks out every connected creator**. Enforce a
   server-side minimum interval against `social_accounts.last_synced_at` (15 min) before doing any
   work. **P1.**

4. **BUC bites the small Pages, not the big ones.** The target users are high-engagement creators,
   whose BUC budget (4800 × engaged users) is enormous — a Page with 1,000 engaged users/day gets
   4.8 M calls. But M18 means PulseBoard also connects every *dormant* Page the user administers,
   and a Page with ~0 engaged users has a near-zero budget. Those Pages will throttle (Graph codes
   4/17/32/613, or `X-Business-Use-Case-Usage` at 100%), the error will be swallowed or
   mis-classified as "expired" (M18c), and the user will be told to reconnect a healthy account.
   **P2.**

5. **Retry pressure.** With no backoff and a daily cron, a throttled account is retried at the same
   time every day indefinitely, and any user-triggered sync retries immediately. Meta's throttle
   responses carry `estimated_time_to_regain_access`; honour it. **P1.**

**Minimum instrumentation to add:** log `X-App-Usage`, `X-Business-Use-Case-Usage` and
`x-fb-trace-id` for every call into `sync_log`; abort the run at 75% of any bucket; exponential
backoff with jitter on HTTP 429 and Graph codes 4, 17, 32, 613, 80001-80004.
Sources: [Meta rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/),
[bundle.social — the three FB limit systems](https://bundle.social/blog/facebook-api-rate-limits),
[Phyllo — IG rate limits 2026](https://www.getphyllo.com/post/instagram-api-rate-limits-explained----and-how-to-scale-beyond-them-2026).
---

## §5 — App Review and access: what is required, and what in this repo fails as written

To read **other people's** Pages and IG accounts, this app needs **Advanced Access** to
`pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`,
`instagram_manage_insights`. Standard Access only covers accounts with a role on the app itself —
which is why the Connections banner (`Connections.tsx:64`) is correct that nothing works until
approval. Gating items:

| Requirement | Status in this repo |
|---|---|
| Business Verification of the owning Business portfolio | Not addressed anywhere; must precede the Advanced Access submission |
| Privacy Policy URL (live, reachable, names deletion path) | **Missing** — no `/privacy` route (`src/pages/`) |
| Terms of Service URL | **Missing** |
| Data Deletion Callback URL **or** Data Deletion Instructions URL | **Missing** — neither route nor function exists |
| Deauthorize Callback URL | **Missing** (see M23) |
| Working test credentials for the reviewer | README §1.4 recommends turning **off** email confirmation to smooth the demo — do not ship that setting; create a dedicated reviewer account instead |
| Screencast showing each permission in use, end to end | Cannot be produced today: with v19.0 expired and the metrics removed, the reviewer would record a dashboard of zeros |
| Written justification **per permission** | `business_management` is requested (`oauth-meta.ts:22`) and **used nowhere** — an unjustifiable permission is a standard rejection, and it drags in extra verification |
| Data Use Checkup (annual) | Not addressed |
| Data Protection Assessment (required because Platform Data is stored server-side) | Would fail on at least four counts, below |
| Tech Provider designation (apps accessing other businesses' assets on their behalf) | Not addressed. ⚠️ VERIFY whether this app falls in scope |

### M22. The Data Protection Assessment would fail on the specific things it asks about. **P1, LIKELY.**
The DPA questionnaire covers prohibited data uses, deletion, sharing with third parties, and data
security. Against this codebase:
- **Encryption of Platform Data at rest beyond disk-level** — absent (`schema.sql:53`, plaintext
  `text` column). The README's "Tokens are encrypted at rest by Supabase" is a disk-encryption
  claim being used to answer an application-encryption question; answering the DPA that way is a
  misrepresentation risk, not just a technical gap.
- **Access control and logging** — no audit log of which token was used when, by which code path.
  The service-role key grants unrestricted read of every creator's tokens and metrics.
- **Deletion on request / on disconnect** — none (LAUNCH-AUDIT #4). `Connections.tsx:51` flips a
  status column client-side and stops there.
- **Third parties receiving Platform Data** — Supabase, Netlify **and Anthropic** (`ai.ts:53`).
  None are disclosed anywhere in the repo. See M25.
- **Data minimisation** — M18 (every Page connected) and the 30-day-then-forever retention of
  `metrics_daily`/`content` with no stated window.
Sources: [Meta DPA overview](https://developers.meta.com/horizon/resources/publish-data-protection-assessment/),
[Advanced Access guide](https://singhamandeep.com/what-is-meta-advanced-access/).

---

## §6 — Platform Terms / Developer Policy obligations not implemented

### M23. No Deauthorize Callback and no permission-revocation handling. **P0 for review, P1 for safety. CONFIRMED (absent from repo).**
Two distinct Meta callbacks are required/expected and neither exists in `netlify/functions/`:
- **Deauthorize Callback URL** — Meta POSTs a `signed_request` when a user removes the app from
  their Facebook settings. Without it, PulseBoard keeps a stored Page token, keeps calling with it
  daily, and keeps showing the account as "Connected". Repeatedly calling with a token the user has
  revoked is precisely the pattern that triggers app-level enforcement.
- **Data Deletion Callback URL** (or Instructions URL) — App Review will not complete without one.
  It must verify the `signed_request` HMAC with the app secret, actually delete, and return
  **JSON** `{ url, confirmation_code }`. Returning HTML fails review.
Additionally there is no subscription to the **`permissions` webhook field** on the `user` object,
which is what tells you a user revoked `instagram_manage_insights` specifically rather than the
whole app.
**Fix:** `netlify/functions/meta-deauthorize.ts` and `netlify/functions/meta-data-deletion.ts`,
both verifying `signed_request` (base64url `sig` = HMAC-SHA256 of the payload with the app secret,
`algorithm` must be `HMAC-SHA256`), both performing the full delete-token-and-data path, plus a
`/deletion-status/:code` page for the returned `url`. Subscribe the app to `user`→`permissions`
and, if you add Page webhooks later, request `pages_manage_metadata`.
Source: [Data deletion callback requirements](https://singhamandeep.com/facebook-data-deletion-callback-url/).

### M24. Error classification must be by numeric code, and the current regex will cause OAuth churn. **P1, CONFIRMED (code).**
`sync.ts:132` and `sync-cron.ts:167` mark an account `expired` when the *message text* matches
`/token|expired|oauth|session/i`. Meta's error messages for deprecated metrics, throttling and
permission problems routinely contain those words. Wrong classification → the UI prompts a
reconnect → the user re-runs OAuth on a healthy account → repeated authorisation churn across many
creator accounts.
**Correct classification (verify each against the Graph error reference):**
| Meaning | Codes |
|---|---|
| Token invalid / user revoked / password change | `190` (+ subcodes `458` app removed, `459` checkpoint, `460` password change, `463` expired, `464` unconfirmed user, `467` invalid) → mark `expired`, delete the secret, stop syncing |
| Permission missing | `10`, `200`-`299` → prompt re-consent for the specific scope, do **not** mark expired |
| Throttling | `4` (app), `17` (user), `32` (page), `613`, `80001`-`80004` (BUC) → back off, do **not** mark expired |
| Invalid metric / field (deprecation) | `100` with `error_subcode` / `error_user_title` → alert the operator, do **not** touch the user's account |
| Transient | `1`, `2` → retry with jitter |
Log `x-fb-trace-id` on every failure — Meta support will ask for it.

### M25. Onward transfer to Anthropic is real and undisclosed. **P1, CONFIRMED (code).**
`ai.ts:31` accepts an 8 KB `summary` and `:53` sends it to the Anthropic API. `src/lib/snapshot.ts`
and `src/lib/analytics.ts` build that summary from Platform Data: per-platform followers/reach/
views/engagements, engagement rate, best-posting windows derived from IG `online_followers`, and
top-post titles (which are **Instagram captions** — user-authored Platform Content) with
permalinks. So the claim in the README that "no raw rows... leave the browser" is true for rows but
not for content: captions and permalinks do leave.
Under Meta's Data Terms, a downstream processor is a **Service Provider** that must be contractually
bound, disclosed, and limited to processing on your behalf. Obligations not met here:
- Anthropic is named in **no** privacy policy (there isn't one).
- No DPA/sub-processor list, no contractual flow-down.
- ⚠️ **VERIFY against Meta Platform Terms §3 (prohibited practices):** I believe the Terms restrict
  using Platform Data to train or fine-tune ML/AI models. Anthropic's commercial API does not train
  on API inputs by default, which is the mitigating fact — but that has to be *stated*, not assumed.
**Fix:** disclose Supabase, Netlify and Anthropic as sub-processors in a real privacy policy; add
a per-user opt-out for the Assistant; strip captions/permalinks from the AI payload if you want the
"numbers only" claim to be literally true; confirm no-training in writing.
Source: [Meta Data Terms](https://www.facebook.com/legal/terms/data-terms).

### M26. Public share links publish Platform Data to an unauthenticated, permanent, indexable URL. **P1, CONFIRMED (code).**
`share.ts:18-29` serves `/api/share?slug=` with **no authentication**, `schema.sql:147` has no
`expires_at`, and `netlify.toml` sets no `X-Robots-Tag`. The payload includes derived audience
activity windows and post-level Platform Data. LAUNCH-AUDIT #10 frames this as a security gap; the
platform-policy framing is sharper: making Platform Data publicly available without the ability to
revoke it is a Platform Terms exposure as well as a client-confidentiality one — a creator's
sponsor-facing numbers stay live at a guessable-length URL forever, including after the creator
disconnects and after their Meta grant is revoked.
**Fix:** `expires_at` default 30 days enforced in the GET; delete all `report_shares` for an
account when it is disconnected or its data is deleted; `X-Robots-Tag: noindex, nofollow` on
`/r/*` and on `/api/share`; a revoke UI; a per-user creation cap.

### M27. No retention policy for Platform Data. **P2, CONFIRMED (absent).**
`metrics_daily`, `content` and `audience_snapshots` grow forever with no purge and no documented
window; nothing deletes on disconnect (LAUNCH-AUDIT #4). Meta's terms require deleting Platform
Data when it is no longer needed for the disclosed purpose, on user request, and on loss of access.
**Fix:** a stated window (e.g. 25 months, matching a plausible year-on-year reporting need), a
nightly purge job, and cascade deletion on disconnect/deauthorize/deletion-callback.

---

## §7 — Other things in this domain that could harm a connected account

### M28. `business_management` makes a leaked token catastrophic instead of merely bad. **P1, CONFIRMED (code).**
LAUNCH-AUDIT #11 treats `business_management` (`oauth-meta.ts:22`) as a review-speed problem. The
sharper point: every other scope requested here is **read-only**, so a leaked Page token can read
insights but cannot post, delete or reconfigure. `business_management` is not read-only — it is
broad Business-portfolio access. Combined with M15 (no revocation possible), M19 (two plaintext
copies of every credential), and no `appsecret_proof` (LAUNCH-AUDIT #7, so a stolen token is
replayable from anywhere), a database leak becomes a business-asset compromise across every
connected creator rather than an analytics-data leak. **Remove `business_management` before a
single real account connects** — this is the cheapest large risk reduction available.

### M29. Any Page admin can connect a client's Page to their own PulseBoard account. **P2, CONFIRMED (code).**
`saveAccount` keys on `(user_id, platform, external_id)`. Nothing checks that the connecting user
is the account's owner rather than one of its admins/editors. An agency staffer or a former
collaborator who still holds a Page role can connect the creator's Page and IG to their own
PulseBoard account, sync it daily, export CSV, and mint a permanent public share link (M26) — with
no notification to the creator and no way for the creator to see it. Meta considers a Page admin
legitimate, so this is not a platform violation; it is a product risk that matters precisely
because the users are high-value creators with staff.
**Fix:** show the creator a list of every PulseBoard connection to their assets; notify on connect;
and treat share-link creation as an action requiring the owning account to still be connected.

### M30. Provider error text is reflected into a redirect URL — including Graph error detail. **P3, CONFIRMED (code).**
`oauth-meta-callback.ts:42` and `:98` put `q.error_description` / `e.message` into the query string
via `backToApp` (`_lib.ts:253`), which `Connections.tsx:32` renders in a toast. Graph error
messages can contain identifiers and internal detail. Return opaque codes; log detail server-side.

### M31. `getJson` never checks `res.ok` and parses the body blind. **P2, CONFIRMED (code).**
`_sync.ts:312-317`. A 5xx HTML error page or an empty body from Meta throws a JSON parse error
whose message is *not* a Graph error, then hits the regex at `sync.ts:132`. Check `res.ok`, read
the rate-limit headers, and only then parse.

### M32. `page_engaged_users` is worth fetching for its own sake. **P3.**
The Pages BUC budget is `4800 × page_engaged_users`. Fetching that metric (if it survives the
Nov-2025 round — verify) lets the sync compute its own remaining budget per Page rather than
discovering the ceiling by hitting it.

### M33. The README overstates what the product can deliver, in ways a client will check. **P2, CONFIRMED.**
Three claims in `README.md` are not deliverable against the 2026 API and should be corrected before
a creator reads them: (a) "**No mock data**" — falsified by M1's fabricated zeros; (b) Audience
"syncs from IG `follower_demographics` and FB `page_fans_*`" — the FB half is dead (M11); (c)
"Tokens are encrypted at rest by Supabase" — disk-level only (M22).

---

## Verification burden — what a human must check against official docs before acting

Ordered by consequence. Every item below is sourced only from secondary documentation.

1. **M6** — the timezone basis of IG `online_followers` hour keys and of `end_time` day boundaries
   (fixed Pacific vs account-local). This decides whether DATA-INTEGRITY D2/D3's prescribed fix is
   correct or actively harmful. Test empirically against one real account.
2. **M9 / M10 / M11** — the exact surviving Page Insights metric names in v25.0
   (`page_media_view`, `post_media_view`, `page_follows`, and whether `page_post_engagements`,
   `page_fans_gender_age`, `page_fans_country`, `fan_count` still resolve). Read the
   [Meta Page Insights API Updates blog post](https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/)
   and the `/insights` reference directly.
3. **M2 / M3** — whether IG account-level `views` and `total_interactions` return `values[]` or
   only `total_value`, i.e. whether a daily series exists at all.
4. **M5** — `metric_type=total_value` and the legal `breakdown` combinations for
   `follower_demographics`.
5. **M16** — Page access token expiry semantics when derived from a long-lived user token.
6. **M8** — the maximum `since`/`until` span for IG insights and the current-day exclusion.
7. **M25** — Meta Platform Terms §3 on ML/AI training with Platform Data.
8. **§4** — Netlify's scheduled-function execution limit (affects the ~5-creator cron ceiling).


---

# Appendix B — TikTok platform compliance (full report, partial: killed at §3)

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


---

# Appendix C — Adversarial security review (full report)

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


---

# Appendix D — Reliability, scale and operations (full report)

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


---

# Appendix E — Verification harness audit (full report)

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


---

# Appendix F — Jordan PDPL and privacy (full report, partial: killed at §3.4)

# PulseBoard — Privacy, Data-Protection & Contractual Readiness Audit
**Primary legal frame: Jordan Personal Data Protection Law No. 24 of 2023 (PDPL)**
Repo: /home/user/SM-Analysis · branch `claude/analysis-35bck4` · Audit date 2026-08-23

> This is an engineering/compliance readiness review, **not legal advice**. Every point marked
> **[COUNSEL]** must be confirmed by a Jordanian-qualified lawyer before it is relied on.
> English-language primary sources for Jordanian law are thin; where I rely on secondary
> summaries (law-firm client alerts, IAPP/DataGuidance) I say so explicitly.

Severity: **P0** blocks launch · **P1** before real clients · **P2** before scale · **P3** hardening
Confidence: **CONFIRMED** (read in code / primary source) · **LIKELY** · **UNVERIFIED**

---

## 0. Sourcing note and method (read this first)

**Primary-source access failed.** The official English text of Law No. 24 of 2023 is published by
the Ministry of Digital Economy and Entrepreneurship at
`https://www.modee.gov.jo/ebv4.0/root_storage/en/eb_list_page/pdpl.pdf` — this audit environment's
egress proxy blocks that host (and `dlapiperdataprotection.com`, `securiti.ai`), so **every
article-level statement below is drawn from secondary English summaries** (law-firm alerts, Clyde &
Co, Digital Watch Observatory, IBA, Jordanian firms Karajah / Jaradat / Nsair, and privacy vendors).
Arabic is the authoritative language of the law; English translations diverge on terminology
("Council" vs "Unit", "Data Protection Officer" vs "Data Protection Supervisor").

**Consequence for this report:** article numbers are cited as *reported by* the sources named, marked
**LIKELY** rather than CONFIRMED. Before any of this is put in front of a client's advisers, a
Jordanian-qualified lawyer must (a) read the Arabic text, (b) confirm the article numbering, (c)
confirm the current status of implementing regulations/instructions issued by the Data Protection
Council, which change the operational duties (registration forms, breach-notice channel, DPO
notification) more than the statute does. Everything marked **[COUNSEL]** is such an item.

Code claims, by contrast, are CONFIRMED — I read the files at the cited lines.

---

## 1. DATA INVENTORY / RECORD OF PROCESSING (built from schema + sync code)

**Confidence: CONFIRMED** (read from `supabase/schema.sql` and `netlify/functions/_sync.ts`).

### 1.1 Category A — PulseBoard's own users (the clients: influencers, agency staff)

| Data | Where | Source |
|---|---|---|
| Email, password hash, auth metadata, last sign-in, IP-adjacent auth logs | `auth.users` (Supabase-managed; PulseBoard adds no triggers, `schema.sql:6`) | Supabase Auth |
| `user_id` linkage to every other table | `social_accounts.user_id`, `goals.user_id`, `report_shares.user_id` | app |
| Growth targets and due dates (business-sensitive, not special category) | `goals` (`schema.sql:129-137`) | user input |

### 1.2 Category B — the client's connected social identities

| Data | Where |
|---|---|
| Platform, external account ID, `username`, `display_name`, `avatar_url`, status, connect/sync timestamps | `social_accounts` (`schema.sql:31-43`) |
| **OAuth access token, refresh token, expiry, `extra` jsonb (page_id, scope)** | `account_secrets` (`schema.sql:51-58`) — Page tokens, IG Business tokens, TikTok tokens |
| Daily followers / reach / impressions / views / engagements | `metrics_daily` (`schema.sql:69-79`) |

`account_secrets` has **no RLS policy at all** (`schema.sql:59-60`) — correct design, service-role only.
But note `schema.sql:25-28` and `166-167` grant `all on all tables in schema pulseboard to anon,
authenticated` — RLS is the only thing standing between the anon key and the token table. That is
by design in Postgres, but it means a single future `create policy ... using (true)` mistake, or any
code path that runs as `authenticated` with RLS disabled, exposes live platform credentials for
large creator accounts. **P1 / CONFIRMED:** revoke table-level grants on `account_secrets`
explicitly (`revoke all on pulseboard.account_secrets from anon, authenticated;`) so RLS is not the
sole control (defence in depth), and add a schema test asserting it.

### 1.3 Category C — the clients' POSTS (personal data of the client, and of third parties named in them)

`content` (`schema.sql:86-104`) stores per post: `title`, `media_type`, `permalink`,
`published_at`, views/likes/comments/shares/saves/reach, watch seconds, retention.

`title` is **not** a title. It is the verbatim post body, truncated to 120 characters:
- Instagram: `title: (m.caption ?? "Instagram post").slice(0, 120)` — `_sync.ts:98`
- Facebook: `title: (m.message ?? "Facebook post").slice(0, 120)` — `_sync.ts:172`
- TikTok: `title: (v.title || "TikTok video").slice(0, 120)` — `_sync.ts:243`

Captions routinely contain third-party personal data: @-mentions of real people, client and brand
names under NDA, location, and free text about identifiable individuals. PulseBoard is storing that
text outside Jordan (§2) and re-transmitting it to Anthropic (§5) and to anonymous share-link
visitors (§8). Nothing in the product tells anyone this happens.

### 1.4 Category D — the clients' FOLLOWERS (third parties with no relationship to PulseBoard)

`audience_snapshots` (`schema.sql:111-122`): `age`, `gender`, `countries`, `devices`, `active_hours`
— one row per account per day, kept forever.

Written from:
- Instagram `follower_demographics` broken down by **age**, **gender**, **country** — `_sync.ts:141-144`
- Instagram `online_followers` → a 7×24 weekday-hour activity grid — `_sync.ts:145-146`, bucketed at `_sync.ts:352-361`
- Facebook `page_fans_gender_age`, `page_fans_country`, `page_fans_online` — `_sync.ts:207`

**These are aggregate proportions, not individual records.** `toShares()` (`_sync.ts:365-371`)
divides every bucket by the total, so what is persisted is e.g. `{"25-34": 0.31}` and
`{"Jordan": 0.44, "United States": 0.12}` — no follower is individually identifiable in the stored
row, and PulseBoard never receives follower IDs.

That materially lowers the risk but does **not** put it outside the law, for three reasons:
1. **Re-identification at small n.** A Page with 40 followers yields buckets that resolve to
   individuals; `hasAudience()` (`_sync.ts:391`) applies no minimum-cohort threshold, and neither
   Meta's k-anonymity thresholds nor PulseBoard's code guarantee one at every breakdown.
   **P2 / LIKELY:** enforce a floor (drop the snapshot if the account's follower count is below a
   documented threshold, e.g. 1,000) and record the threshold in the privacy policy.
2. **Combination.** age × gender × country × hour-of-activity, snapshotted daily and retained
   indefinitely, is a longitudinal behavioural dataset about a defined group of real people. Under
   Meta's own terms this is derived platform data with its own restrictions (§9).
3. **`gender`** is a special/sensitive category in several of the regimes the follower base may sit
   under, and Jordan's PDPL treats an enumerated set of "sensitive data" categories with a stricter
   consent standard. **[COUNSEL]** must confirm whether gender falls inside Jordan's enumerated
   sensitive-data list; the widely reported list centres on health, genetic/biometric, race,
   religion, political opinion, criminal record, and financial data.

**Roles for Category D are the hard problem — see §4.**

### 1.5 Category E — derived/exported artefacts

| Artefact | Contains | Where it goes |
|---|---|---|
| AI prompt (`summarizeForAI`, `analytics.ts:114-147`) | totals, trends, **5 verbatim captions truncated to 60 chars**, best-posting-window labels, up to 5 anomaly dates | Anthropic API (US) — §5 |
| Share payload (`buildSnapshot`, `snapshot.ts:27-70`; top-10 posts at `snapshot.ts:47-55`) | totals, per-platform follower/reach/views/engagement counts, **10 verbatim captions**, 3 best-window labels, 6 anomalies with dates | `report_shares.payload`, readable by anyone with the URL, forever — §8 |
| CSV export (`reports.ts:19-44`) | up to 200 posts with caption, type, publish date, and all engagement counts | the client's own device (no server copy) |
| Netlify function logs | see §2.2 — currently unbounded and unassessed |


---

## 2. PDPL SUBSTANCE — what Law No. 24 of 2023 actually requires of PulseBoard

**Status: in force 17 March 2024; grace period ended 17 March 2025; fully enforceable today**
([Digital Watch Observatory](https://v45.diplomacy.edu/resource/jordans-personal-data-protection-law-no-24-of-2023),
[Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law)).
There is no remaining runway; PulseBoard launches into a live regime.

### 2.1 Lawful basis — **consent is the default, and there is no "legitimate interests"**

This is the single most consequential difference from the GDPR and it reshapes the whole design.

- Art. 4(a): processing personal data is permitted **only with the data subject's prior consent**,
  unless a case permitted by law applies
  ([Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law),
  [DP-Technologies guide](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).
- Art. 6(a) exceptions are narrow and purpose-bound: public-entity statutory tasks, preventive
  medicine / healthcare by licensed practitioners, vital interests, law-enforcement and judicial
  requests, national security, and publicly available data
  ([DP-Technologies](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).
- **There is no general legitimate-interests basis.** "Legitimate interest" appears only as one
  condition inside the cross-border transfer article (Art. 14) — not as a ground to process
  ([DP-Technologies](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).

**Finding P0 / LIKELY — PulseBoard has no lawful basis for the follower demographics.**
For Category A/B/C (the client's own data) consent is obtainable: the client signs up and connects.
For **Category D — the followers' data** — PulseBoard cannot obtain consent, and no Art. 6(a)
exception fits. Under a GDPR-shaped design you would reach for legitimate interests; **that option
does not exist in Jordan**. Two routes out, both requiring counsel:
1. **Argue it is not personal data.** After `toShares()` (`_sync.ts:365-371`) what is stored is an
   aggregate distribution with no identifiers. This is the strongest argument and probably correct
   — but it depends on Jordan's definition of personal data and on there being a real
   minimum-cohort floor, which the code does not enforce (§1.4). **Build the floor, then the
   argument holds.** **[COUNSEL]**
2. **Argue "publicly available data"** for the parts Meta itself publishes. Weak: `follower_demographics`
   is permission-gated insight data, not public.
   *Do not rely on route 2.*
Action: (a) implement a documented minimum-cohort threshold before any snapshot is written;
(b) get a written counsel opinion that post-aggregation `audience_snapshots` rows are not personal
data under the PDPL; (c) if counsel will not give that opinion, the Audience feature must be
removed or restricted to accounts above the threshold.

**Finding P0 / CONFIRMED — captions are personal data with no basis at all.**
`content.title` holds up to 120 verbatim characters of the post body (`_sync.ts:98,172,243`). Where
a caption names or @-mentions a third party, PulseBoard processes *that person's* personal data with
neither their consent nor an exception. Unlike demographics this is not aggregated away.
Mitigations, in order of preference: (i) do not store caption text at all — store a hash plus the
permalink, and render captions client-side from a live API call; (ii) store it but strip `@handles`
and strings matching a mention pattern before persisting; (iii) keep it and treat the client as
controller for post content (§4), with the client contractually warranting it has rights to the
content and its subjects — this is the pragmatic route but it does **not** discharge PulseBoard's
own obligations as processor.

### 2.2 Consent quality

Consent must be **prior, explicit, documented (written or electronic), specific as to purpose and
period, and expressed in clear, plain, intelligible, non-misleading language**
([Signzy summary](https://www.signzy.com/regulation-glossary/personal-data-protection-law-24),
[Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law)).
It is withdrawable at any time.

**Finding P0 / CONFIRMED — there is no consent capture anywhere in the product.**
`grep` finds no consent, terms-acceptance, or privacy-notice component; sign-up is bare Supabase
Auth and the OAuth flow (`src/pages/Connections.tsx:37-46` `connect()`) sends the user straight to
the platform dialog with no PulseBoard-side notice. Specifically missing:
- a sign-up consent checkbox bound to a versioned Terms + Privacy Policy, with the version, the
  timestamp and the IP recorded in a `consents` table (does not exist);
- a **separate, unbundled consent for the AI assistant** — sending caption text to a third-country
  sub-processor is a distinct purpose and must not be buried in a general terms acceptance;
- a **separate consent for the cross-border transfer**, which Art. 14 requires to be given *after
  being informed that the destination does not provide an adequate level of protection* (§3);
- a "specified period" — consent must be time-bounded, which means the retention schedule (§7) is
  not optional garnish, it is part of the consent itself.

Build: `pulseboard.consents (user_id, kind, doc_version, granted_at, revoked_at, ip, user_agent)`
with one row per consent event, never updated in place. This table is also the evidence you produce
to the Unit and to a client's advisers.

### 2.3 Data subject rights

Reported rights: access and obtain a copy; correct/amend/update; erase; restrict processing to a
defined scope; withdraw consent at any time; and complain to the Unit
([Signzy](https://www.signzy.com/regulation-glossary/personal-data-protection-law-24),
[Securiti overview](https://securiti.ai/jordan-personal-data-protection-law-of-2023/)).

**Response deadline: UNVERIFIED.** I could not establish a statutory response period for Jordan from
any English source; the widely quoted "30 days" belongs to **Saudi Arabia's** PDPL, which is a
different law, and several search summaries conflate the two. **[COUNSEL] must confirm the Jordanian
deadline (statute and any Council instructions).** Engineering posture in the meantime: build to
**30 days maximum, target 7 working days**, and write 30 days into client contracts so you are
committing tighter than any plausible statutory figure.

Complaint handling is itself an obligation — the controller must "establish complaint handling
procedures" and give data subjects a clear mechanism to exercise rights
([Signzy](https://www.signzy.com/regulation-glossary/personal-data-protection-law-24)). Today there
is no in-product route to make any request; see §6.

### 2.4 The regulator

Oversight sits with the **Ministry of Digital Economy and Entrepreneurship (MoDEE)**; the law
establishes a **Data Protection Council** chaired by the Minister as the policy/supervisory body
setting national standards and issuing instructions and codes of practice, with an operational
**Unit** receiving complaints, investigating and enforcing
([Jaradat Law on the Council](https://jaradatlaw.com/the-data-protection-council-in-jordan-and-compliance-for-international-companies/),
[Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/)).

**Registration / notification duties: UNVERIFIED — and this is a launch-blocking unknown.**
English sources do not clearly state whether a private controller of PulseBoard's size must register
or notify the Unit, or whether a permit is needed. Note Art. 21 empowers the authority to *suspend or
revoke the entity's licence* ([IBA](https://www.ibanet.org/Jordans-technology-related-legal-framework)),
which implies a licensing/registration touchpoint exists for at least some entities.
**P0 / [COUNSEL]: establish before launch whether registration, notification, or a DPO filing is
required, and complete it.** Launching an unregistered data business that then suffers a breach is
the worst possible order of events.

### 2.5 Security obligations

Controllers must implement technical and organisational safeguards, conduct impact assessments, and
report breaches; a recipient of transferred data is subject to the same responsibilities as the
controller and must implement measures to secure the data **and mechanisms to detect and track
security breaches**
([Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law),
[Securiti solutions page](https://securiti.ai/solutions/jordan-personal-data-protection-law/)).

**Finding P0 / CONFIRMED — "mechanisms to detect and track security breaches" do not exist.**
There is no audit log table in `supabase/schema.sql`, no application-level access log, and no record
of who read what. `share.ts:18-29` serves any share payload to anyone with the slug and logs nothing.
`_lib.ts:24-32` mints a service-role client per invocation that bypasses RLS entirely, and every
sync, share read and OAuth save runs under it — so there is no per-actor attribution anywhere in the
system. **A breach cannot be scoped today**: you could not tell a client which of their posts,
captions or tokens were accessed, which is exactly the question a large account's advisers will ask
and exactly what the 24h/72h notices (§2.6) must contain. See §11.

**Finding P1 / CONFIRMED — no DPIA has been done.** Given permission-gated demographic data about
non-users, systematic daily monitoring of connected accounts, and transfer to three third countries,
a documented impact assessment is required and is also the artefact clients will ask for.

### 2.6 Breach notification — the tightest deadline in the law

- **Data subjects: within 24 hours** of discovering a breach that could cause serious harm, with
  details of the incident and the mitigations they should take.
- **The Unit: within 72 hours** of discovery, with the source of the breach, the affected data
  subjects, the mechanisms involved and other relevant details.
- Where the breach results from the controller's gross negligence or misconduct, the controller
  compensates those harmed.
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/); DLA Piper's Jordan
breach-notification page corroborates but was egress-blocked here.)

**24 hours to the data subject is harsher than the GDPR's 72-hour regulator-only clock.** For
PulseBoard the "data subjects" in a token-database breach are the clients *and* arguably every
person named in a stored caption — an unreachable population. That is another reason not to store
caption text (§2.1).

**Finding P0 / CONFIRMED — 24h is unmeetable with the current stack.** There is no on-call rotation,
no alerting, no log retention policy, no incident runbook, no contact list, and (above) no audit log
to determine scope. See §11 for the build.

### 2.7 DPO

A controller must appoint a DPO where its core activities involve processing personal data,
sensitive data, data of legally incapacitated persons, financial data, **or where it handles data to
be transferred outside Jordan**; the Council may mandate one in further cases
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/),
[Nsair & Partners](https://nsairs.com/2025/05/20/1257/)).

**Finding P0 / LIKELY — PulseBoard triggers the DPO requirement on the cross-border limb alone.**
100% of its data is transferred outside Jordan (§3). Appoint a named DPO, publish the contact point
in the privacy policy, and **[COUNSEL]** confirm whether the appointment must be notified to the
Unit and whether the role can be outsourced/part-time (common for a company this size, but confirm).

### 2.8 Penalties

- **Art. 21 (administrative):** after a prior warning — suspension or revocation of licence, or a
  fine up to **JOD 500 per day** while the violation continues, capped at **3% of the previous
  fiscal year's total revenue**. The Unit may also publish proven violations **at the violator's
  expense**.
- **Art. 22 (judicial):** court fine of **JOD 1,000–10,000**, **doubled for repeat offences**, and
  the court may order **destruction of the data or cancellation of the database**.
- Separate civil action for damages by the aggrieved party.
([IBA](https://www.ibanet.org/Jordans-technology-related-legal-framework),
[Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/))

For a startup the monetary figures are survivable; **licence suspension, publication of the violation
at your expense, and a court order to destroy the database are not** — the last would delete every
client's history. Frame this to management as an existential-continuity risk, not a fine risk.

---

## 3. CROSS-BORDER TRANSFER — the structural problem

### 3.1 What Art. 14 permits

Personal data must not be transferred to a recipient outside Jordan whose **level of protection is
lower than the PDPL requires**. The enumerated exceptions are: regional/international judicial
cooperation under treaties in force; cooperation with bodies combating crime; exchange of medical
data needed for treatment; exchange of data on epidemics/health crises/public health in Jordan;
banking operations and transfers of funds; and **the data subject's explicit consent to the
transfer, given after being informed that the destination does not provide an adequate level of
protection**
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/),
[DP-Technologies](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).
"Legitimate interest" is reported as a further condition inside Art. 14; its scope in the Arabic
text is unclear from English sources — **[COUNSEL]**.

**The decisive point: the PDPL does not currently anticipate standard contractual clauses or
equivalent safeguards as a transfer mechanism** ([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/)).
There is no adequacy list, no SCC template, no BCR route. An operator cannot paper over a transfer
the way it would under GDPR Art. 46.

**Therefore, for PulseBoard, essentially the entire cross-border posture rests on one leg:
informed, explicit, per-purpose consent from the data subject.** That has three engineering
consequences that must be designed for, not bolted on:

1. The consent notice must **name the destination and state that it does not provide protection
   equivalent to the PDPL**. A generic "we use cloud providers" line does not satisfy the wording.
2. Consent is **withdrawable at any time** (§2.3). Withdrawal of the transfer consent means the
   data can no longer sit in Supabase — i.e. withdrawal is functionally an account-deletion event.
   The product must treat "withdraw transfer consent" and "delete my account" as the same code path.
3. **Followers never consent.** Category D (§1.4) and third parties named in captions (§1.3) cannot
   consent to anything. If those are personal data, **there is no available transfer basis at all**
   and the only compliant answers are aggregation-below-identifiability (demographics) and
   not-storing (captions). This is the same conclusion as §2.1, reached independently — which is why
   it is the highest-conviction finding in this report.

### 3.2 Per-vendor analysis

| Vendor | What crosses the border | Region control | Transfer basis available | Contract needed |
|---|---|---|---|---|
| **Supabase** (Postgres, `auth.users`, **`account_secrets` OAuth tokens**, all metrics/content/audience/shares) | everything | Yes — region chosen at project creation, immutable afterwards; **no Middle East region exists** (no `me-central-1`; requested but unshipped) | client consent only | Supabase DPA (`supabase.com/legal/dpa`), signed and filed; sub-processor list captured and monitored |
| **Netlify** (static hosting, all `/api/*` functions, function logs, cron) | request metadata, OAuth `code`, **Supabase access tokens passed in a query string**, error strings that can contain caption text | Functions region selection exists (IATA codes; `cmh` Columbus/Ohio is the default) but is **Credit-based Pro / Enterprise only**; traffic still transits US infrastructure | client consent only | Netlify DPA; note DPA is standard on Enterprise |
| **Anthropic** (`/api/ai`) | the `summarizeForAI` prompt incl. **verbatim captions** — §5 | **None.** No region selection on the standard API | client consent only, and it must be a *separate* consent | Commercial Terms + **DPA**; opt for **7-day default retention**, and negotiate **Zero Data Retention (ZDR)** |

Sources: [Netlify Functions region selection](https://www.netlify.com/blog/netlify-functions-region-selection/),
[Netlify GDPR/CCPA page](https://www.netlify.com/gdpr-ccpa/),
[Supabase regions discussion — no ME region](https://github.com/orgs/supabase/discussions/34551),
[Anthropic API data retention (7 days default since 14 Sep 2025; 30-day opt-in via DPA; ZDR for qualifying enterprise customers; API inputs/outputs never used for training)](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).

**Finding P0 / CONFIRMED — Supabase access token in a URL query string.**
`Connections.tsx:45` does `window.location.href = /api/${fn}?token=${session.access_token}`. A live
Supabase JWT therefore lands in Netlify's HTTP access logs, in the browser history, and in any
`Referer` sent onward. That is a credential in a third-country log file. This is a security defect
first and a transfer/breach-scoping defect second. Fix: `POST` the token, or set a short-lived
signed one-time code, or use a same-site cookie. **This alone would be a finding in a client's
security questionnaire.**

**Finding P1 / CONFIRMED — function logs are an unassessed transfer.**
`getJson` (`_sync.ts:312-317`) throws `body.error.message`; `sync.ts:22-35` and
`sync-cron.ts:19-31` swallow it, but any unhandled path, plus Netlify's own request logging, writes
to US-hosted logs with no retention control documented anywhere. Inventory what is logged, set the
shortest retention the plan allows, and list Netlify logs as a processing location in the ROPA.

### 3.3 Recommended region posture (concrete)

There is no Jordan region on any of the three vendors, and there is no Middle East Supabase region
at all. The realistic postures, in order:

1. **Recommended: EU (Frankfurt, `eu-central-1`) for Supabase; `fra` or `dub` for Netlify Functions
   once on a plan that allows it.** Rationale to document: Frankfurt is the lowest-latency
   Supabase region for the Levant/Gulf (users report ~200ms vs ~650ms from Singapore), and — the
   compliance point — the EU/EEA is the destination for which "the level of protection is not lower
   than the PDPL requires" is by far the easiest argument to make in writing, because the recipient
   is itself subject to a comprehensive regime. It does not create an adequacy *finding* (Jordan has
   no adequacy mechanism), but it makes the operator's **written adequacy assessment** defensible
   rather than aspirational. **P1 / LIKELY.**
   *Caveat:* choosing an EU region increases the chance that GDPR applies to the establishment side
   of the analysis — a trade counsel should weigh (§10.3). It also does not stop US transit, since
   Supabase and Netlify are US companies subject to US process; say so in the assessment rather
   than pretending otherwise.
2. **Anthropic: no region control.** Compensate contractually: DPA + **ZDR addendum**, and
   technically: stop sending caption text (§5). With numbers-only prompts the transfer becomes
   business data, not personal data, and the problem largely dissolves.
3. **Do not** leave Supabase on the default US region "because it was quicker to click". The region
   is fixed at project creation and **cannot be changed later without a migration** — this decision
   must be made before any real client data lands.

### 3.4 What the operator must document (the transfer file)

Build one folder, versioned, produced on demand to a client's advisers or the Unit:
- a **written transfer impact assessment per recipient** (Supabase, Netlify, Anthropic) — what data,
  what volume, which region, what protection the recipient offers, what law it is subject to, what
  government-access exposure exists, what mitigations (encryption, ZDR, minimisation) apply, and
  the conclusion on "not lower than the PDPL";
- **signed DPAs** with all three, plus their **sub-processor lists** and the change-notification
  terms;
- the **consent text** shown to clients naming each destination and the inadequacy statement, with
  the version history;
- the **DPO's sign-off** on each assessment, dated;
- a **review trigger**: re-assess on any sub-processor change, region change, or new vendor.


---

# Appendix G — Launch procedure and onboarding (full report, partial: checklist not reached)

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


---

# Appendix H — Findings made outside the specialist passes

# Lead auditor's own findings (independent of the agent fleet)

## L1. The daily cron freezes every day at ~6 hours of data. P0, CONFIRMED.

`backfillStart()` (netlify/functions/_sync.ts) fetches only days AFTER the newest stored row.
Proved by replicating the real function in scratchpad/backfill-proof.mjs:

```
cron on 2026-08-20: start=2026-07-22 -> refetches 30 days   (initial backfill, complete days)
cron on 2026-08-21: start=2026-08-21 -> refetches 1 day
cron on 2026-08-22: start=2026-08-22 -> refetches 1 day
cron on 2026-08-23: start=2026-08-23 -> refetches 1 day
each day written exactly 1x, on the day itself
```

`sync-cron.ts:34` runs at `0 6 * * *`. So each day is written once, at 06:00 UTC, containing at
most the first 6 hours of that day, and is never revisited. Platform insight values also settle
for hours-to-days after the fact, so even those 6 hours are provisional.

Worse branch: `days` is built as `reach: reachByDate[date] ?? 0` (_sync.ts ~line 117). Any day the
platform does not return a value for — very likely including the current, incomplete day — is
written as **0** and frozen at 0 forever.

Client-visible effect: the first 30 backfilled days are complete; every day after they connect is
~25% of truth or zero. The chart shows a cliff at the connection date. The anomaly detector
(src/lib/analytics.ts:51) then fires a "Reach dropped" alert at the boundary, and the AI assistant
repeats it as fact. A client concludes their reach collapsed the day they started using PulseBoard.

Fix: always re-fetch a trailing window (>= 7 days) on every sync rather than only the gap; upsert
overwrites, so this is cheap and self-healing. Additionally: distinguish "platform returned 0" from
"platform returned nothing" — never write a fabricated 0 into a metric column. Consider a
`settled_at`/`provisional` marker so the UI can mark the current day as incomplete.

## L2. Content is never filtered by the selected date range. P1, CONFIRMED.

`fetchContent()` (src/lib/api.ts:38) selects the top 200 posts by views across ALL time, with no
date predicate. `Content.tsx:32` then filters by platform only. So:

- the Content page shows all-time posts while the header controls say "Last 7 days";
- `buildCsv()` (src/lib/reports.ts) writes `Window,7 days` and then lists all-time content;
- `buildSnapshot()` (src/lib/snapshot.ts:194) puts all-time top posts into a report headed
  "last 7 days", including the public share link;
- `summarizeForAI()` (src/lib/analytics.ts:128) feeds all-time top posts to the assistant as the
  window's top performers, so it will attribute an 8-month-old viral post to this week.

A client sends a sponsor a "last 7 days" report featuring a post from last year. Fix: filter content
by `published_at` against the range wherever the range is claimed, and fetch content per range.

## L3. CSV export is vulnerable to formula injection. P1, CONFIRMED.

`esc()` (src/lib/reports.ts:108) only wraps in quotes and doubles inner quotes. Quoting does not
stop Excel/Sheets from evaluating a field that begins with `=`, `+`, `-`, `@`, tab or CR. Post
titles come from platform captions, and these CSVs get emailed to sponsors and brands.

Fix: prefix any value beginning with those characters with a single quote (or a leading space) on
export, in addition to quoting.

## L4. `download()` revokes the object URL synchronously. P3, LIKELY.

src/lib/reports.ts:105 calls `URL.revokeObjectURL` immediately after `a.click()`, which can race the
download in some browsers and produce an empty file. Defer with `setTimeout(..., 0)` or longer.

## L5. Checked and NOT a bug (recorded so nobody re-raises it)

`buildCsv` uses `seriesByDay(..., "followers")` while the dashboard uses `followersByDay()`. These
look inconsistent but agree, because `metrics_daily`'s primary key is `(account_id, date)` so there
is exactly one row per account per day and both reduce to the same per-day sum.
