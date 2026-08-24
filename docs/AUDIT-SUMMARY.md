# PulseBoard pre-launch audit — consolidated findings

Audit of the mechanism by which this system connects to, authenticates against, reads from and
retains data for clients' Facebook, Instagram and TikTok accounts. Commissioned because the
operator is about to onboard high-value creator accounts from Jordan.

**Verdict: do not connect a real client account.** Two of the three integrations cannot function at
all today, a third class of defect silently destroys or falsifies stored client data, one security
defect lets a stranger steal a client's Pages, and the test suite that would have caught any of it
has a measured mutation score of 0/13.

## Documents

| Document | Covers |
|---|---|
| [`LAUNCH-AUDIT.md`](LAUNCH-AUDIT.md) | First pass: is the integration allowed to run, and is it safe? |
| [`DATA-INTEGRITY.md`](DATA-INTEGRITY.md) | Are the numbers right? Proven in [`verify/proofs/`](../verify/proofs/) |
| [`JORDAN-CONTEXT.md`](JORDAN-CONTEXT.md) | What operating from Jordan changes |
| [`audit/meta.md`](audit/meta.md) | Full Meta API call inventory + migration checklist (616 lines) |
| [`audit/tiktok.md`](audit/tiktok.md) | TikTok API, OAuth, tokens, Display Requirements |
| [`audit/security.md`](audit/security.md) | Adversarial review by attacker position |
| [`audit/reliability.md`](audit/reliability.md) | Scale, failure modes, cost, disaster runbooks (753 lines) |
| [`audit/testing.md`](audit/testing.md) | Whether the safety net works. It does not. |
| [`audit/privacy.md`](audit/privacy.md) | Jordan PDPL, cross-border transfer, data subject rights |
| [`audit/launch.md`](audit/launch.md) | The setup procedure and onboarding path |
| [`audit/lead-findings.md`](audit/lead-findings.md) | Findings made outside the specialist passes |

Every finding carries a severity (P0–P3) and a confidence (CONFIRMED / LIKELY / UNVERIFIED) in its
source document. **Claims about platform APIs and Jordanian law rest on secondary sources**, because
`developers.facebook.com` and `developers.tiktok.com` are unreachable from the audit environment.
Each source document lists what a human must confirm before acting; do that first.

---

## The P0s, by what they do to a client

### Cannot function at all

1. **Graph API v19.0 expired 21 May 2026.** Pinned in `_sync.ts:3`, `oauth-meta-callback.ts:37`,
   and separately in `oauth-meta.ts:25` — bump all three. Current is v25.0.
2. **TikTok has never worked.** `getJson` (`_sync.ts:312-317`) throws on any truthy `body.error`,
   but every TikTok v2 response carries `error:{code:"ok"}` on success. `syncTiktok`'s first call
   has no `.catch()`. `postJson` immediately below guards correctly; `getJson` never got the guard.
   The account displays as "connected" and healthy while storing nothing.
3. **The metrics requested no longer exist.** IG `impressions` and `plays` (removed Apr 2025);
   FB `page_impressions`, `page_fans`, `post_impressions` (removed Nov 2025). Also
   `page_fans_gender_age`/`page_fans_country` are unavailable for Pages connected after Mar 2024,
   so **the Facebook Audience page can never work for a new creator**, whatever else is fixed.

### Destroys or falsifies client data

4. **One rate-limit response permanently erases 30 days of history.** Insights calls are wrapped in
   `.catch(() => ({data:[]}))`; `?? 0` converts the empty result to zeros; the upsert overwrites
   real values; `last_synced_at` advances so it is never refetched. The schema cannot express
   "unknown" (`bigint not null default 0`). Meta throttling you destroys customer data.
5. **Every day is frozen at partial data.** After the first sync each day is written once, at
   06:00 UTC (09:00 Amman), and never revisited. Proven in `verify/proofs/p3-frozen-days.mjs`.
6. **Days are filed under the wrong date for accounts at UTC offset ≤ 0** — 30/30 rows wrong for
   Los Angeles and New York, 0/30 for Amman. Latent rather than absent for a Jordanian roster: the
   trigger is the account's platform timezone, which a client can change at any time.
7. **"Best time to post" names the wrong weekday** for affected accounts, and states no timezone.

### Security

8. **A free signup can steal a client's Pages and Instagram tokens into their own tenant.** The
   OAuth `state` is signed but not bound to a browser session, not single-use, and valid 15 minutes.
   Identical and worse on the TikTok path. Fix with a nonce mirrored in an HttpOnly cookie.
9. **`OAUTH_STATE_SECRET` falls back to a constant published in this repo** (`_lib.ts:17`). Unset in
   Netlify, anyone forges a state for any uid. Fails open, silently.
10. **`/api/ai` is an uncapped proxy on the org key** — the client supplies the whole prompt and
    history; $0.094/request; one abuser ≈ $40k/day, against open signup.

### Operational

11. **The cron dies at about 8 accounts** (Netlify caps scheduled functions at 30s; a scheduled
    function cannot be `-background`). The fifth Page of one agency stops the platform.
12. **`fetchMetrics` truncates the newest days** — no limit, ordered date ascending, so PostgREST's
    1000-row cap drops the most recent data at ~11 accounts over 90 days. Poisons the dashboard,
    CSV, PDF, share links and the AI's grounding simultaneously.
13. **Deploy Previews run with the production service-role key against the production database** —
    no `[context.*]` in `netlify.toml`, env vars global per the README.
14. **`schema.sql`'s second edit is a silent no-op** (`create table if not exists` throughout):
    the migration appears to succeed, deployed code then hits `PGRST204`, syncing stops estate-wide.
15. **Zero logging in all eight functions**; the cron returns HTTP 200 on `0/450`. The v19.0 expiry
    has been breaking Meta for three months and the system reports success.

### Jordan PDPL (Law No. 24 of 2023, fully in force since 17 March 2025)

16. **No lawful basis for the follower demographics**, and none for the captions. Consent is the
    default basis under the PDPL and there is no legitimate-interests limb.
17. **No consent capture anywhere in the product.**
18. **The 24-hour breach-notification deadline is unmeetable** — no logging, no audit trail, so the
    scope of a breach could not even be established.
19. **A DPO is likely required** on the cross-border limb alone.
20. **Supabase, Netlify and Anthropic are all cross-border transfers** with no adequacy assessment,
    no documented basis, and no transfer file. Region selection is a compliance decision.

### Platform review blockers

21. No privacy policy, terms, data-deletion instructions, deletion callback, or deauthorize callback.
22. **Disconnect neither revokes nor deletes** — and the revoke cannot be implemented as designed,
    because the long-lived *user* token is never persisted (`oauth-meta-callback.ts:65`). Storing it
    is a prerequisite for revocation, refresh and Page re-discovery alike.
23. **No token refresh anywhere.** TikTok tokens expire in 24 hours; the refresh token is stored and
    never read.

### The safety net

24. **Mutation score 0/13.** Thirteen defects injected into real source — including reach ×10,
    followers forced to 0, the date key shifted 5 days, and rows written under another tenant's
    `account_id` — all survived; eleven produced byte-identical output. No `process.exit(1)` or
    assertion exists in `verify/`. The OAuth suite prints `ok` with the CSRF check deleted. The
    most adversarial script in the directory imports a build target nothing produces and has never
    run. Root cause: **there is no oracle anywhere** — nothing compares against a known-correct
    answer.

---

## Corrections register

Claims made earlier in this audit that later passes overturned. Recorded because a reader who acted
on the earlier version would be misled.

| Claim | Status |
|---|---|
| Session JWT leaks to facebook.com via `Referer` | **Wrong mechanism.** Browsers carry the original referrer through a 302. It leaks via history, Netlify logs and TLS-terminating proxies. Severity stands. |
| Share links expose audience demographics | **Wrong.** The payload holds totals, per-platform counts, ten verbatim captions and anomaly dates. Expiry/revocation still needed; privacy exposure narrower. |
| Broad `grant all` is a live cross-tenant read path | **Wrong.** RLS is default-deny and enabled on every table. The real risk is the forward-looking `alter default privileges` clause. |
| `ai.ts` model pin is a defect | **Overstated.** `claude-opus-4-8` is current and valid at identical pricing. The real defect is a non-streaming 900-token call behind a 10s limit with thinking disabled. |
| A cron killed mid-loop permanently loses a day for everyone | **Wrong.** Gaps self-heal — the next run refetches them as complete days. Permanent only for TikTok, gaps >29 days, and the zero-overwrite case (P0 #4). |
| `DELETE /{user-id}/permissions` is the disconnect fix | **Not implementable as written** — the user token is never stored. Store it first. |
| Converting `end_time` to the account timezone fixes the day shift | **Insufficient and possibly harmful.** Evidence suggests IG's `online_followers` uses fixed Pacific time while FB follows the Page timezone; a single conversion would make IG newly wrong. Verify first. |
| `sync-cron` is publicly invokable | **Wrong.** Netlify blocks URL invocation of scheduled functions. One residual check: whether the `/api/*` rewrite bypasses it. |

---

## Sequenced remediation

Order matters; several fixes are unsafe if landed before their prerequisites.

1. **Stop the bleeding.** Fail closed on missing `OAUTH_STATE_SECRET`. Add logging and an alert on
   cron failure. Stop writing fabricated zeros — distinguish "returned 0" from "returned nothing".
2. **Close the account-takeover.** Nonce-bind the OAuth state on both providers; refuse to attach an
   `external_id` already owned by another tenant.
3. **Make the integrations function.** Graph v25.0 (all three pins), the `views` migration, the
   TikTok `getJson` envelope guard, error classification by numeric code.
4. **Verify the timezone semantics** against one real API response per platform, then fix the day
   boundary and backfill a trailing window on every sync.
5. **Make credential custody safe.** Persist the user token; add locking to `account_secrets`
   *before* adding token refresh; then refresh, revoke-and-delete on disconnect, `appsecret_proof`,
   encrypted token storage.
6. **Build the legal surface.** Consent capture, deletion and export paths, retention, audit
   logging, privacy/terms/deletion pages, deletion and deauthorize callbacks, the transfer file and
   region posture. Counsel in Jordan to sign off the PDPL analysis.
7. **Replace the safety net.** Real assertions with an oracle; promote `verify/proofs/` to tests;
   mutation score as the acceptance gate; CI.
8. **Then scale.** Fan-out the cron, paginate every query, rate-limit handling, per-tenant quotas,
   share-link expiry, indexes, PITR.

Do not connect a real client account before step 5. Do not onboard an agency before step 8.

---

## On "zero chance of problems"

That target is not reachable, and aiming at it directly is how the expired API version went
unnoticed for three months — nobody was watching a calendar. What is reachable is: no known
unmitigated risk class, an oracle-backed test suite that can actually fail, logging good enough to
scope an incident within the PDPL's 24-hour window, and a standing watch on the platform
deprecation schedules. The last one is a recurring task, not a fix.
