# Remediation status

Maps each P0 in [`AUDIT-SUMMARY.md`](AUDIT-SUMMARY.md) to what has actually been done, on branch
`claude/analysis-35bck4`. Scope was narrowed to **Instagram-first**; the Facebook and TikTok paths
were fixed where the same code carries them, not developed further.

Gate: `npm test` runs typecheck, build, 35 assertions and a mutation check that injects 16 real
defects and requires every one to be caught. It fails the build if any survives.

| # | Finding | Status |
|---|---|---|
| 1 | Graph API v19.0 expired | **Fixed** — v25.0, pinned once in `GRAPH_VERSION`, env-overridable |
| 2 | TikTok never worked (success envelope read as error) | **Fixed** — `error.code === "ok"` handled; covered by a test |
| 3 | Removed metrics still requested | **Fixed** — `views`, `page_media_view`, `page_follows`, `post_media_view`; each metric requested separately |
| 4 | One rate-limit response erased 30 days of history | **Fixed** — nullable metrics, merge-over-stored, throttles re-thrown not swallowed |
| 5 | Every day frozen at a few hours of data | **Fixed** — 7-day trailing re-fetch on every sync |
| 6 | Days filed one day late at UTC offset ≤ 0 | **Fixed** — day derived from `end_time`'s encoded offset; tested at six offsets |
| 7 | "Best time to post" named the wrong weekday | **Partly** — weekday derivation fixed; the *hour* timezone is still unconfirmed for Instagram and is now labelled rather than implied |
| 8 | OAuth state replay stole a client's Pages | **Fixed** — nonce mirrored in an HttpOnly cookie, single-use, 5-minute TTL, cross-tenant attachment refused |
| 9 | `OAUTH_STATE_SECRET` fell back to a published constant | **Fixed** — fails closed |
| 10 | `/api/ai` uncapped on the org key | **Fixed** — 20/hour and 100/day per user, client-supplied assistant turns rejected, snapshot moved out of the system prompt |
| 11 | Cron died at ~8 accounts | **Mitigated** — hourly, least-recently-synced first, inside a 22s budget, reports failure instead of 200. A real queue is still the answer above a few hundred accounts |
| 12 | `fetchMetrics` silently dropped the newest days | **Fixed** — explicit limit, newest-first |
| 13 | Deploy Previews used the production service-role key | **Fixed** — `admin()` refuses in a preview context unless a non-production database is configured deliberately |
| 14 | `schema.sql`'s second edit was a silent no-op | **Fixed** — numbered migrations in `supabase/migrations/`, procedure documented |
| 15 | Zero logging; cron returned 200 on 0/450 | **Fixed** — structured logs with token redaction, `sync_log` per run, failure status |
| 16 | No lawful basis for demographics or captions | **Partly** — consent is now captured and versioned; **counsel must confirm the basis holds** |
| 17 | No consent capture anywhere | **Fixed** — recorded server-side at connect time with scopes and evidence |
| 18 | 24-hour breach deadline unmeetable | **Partly** — there is now an audit trail to scope an incident; alerting and an on-call rota are organisational and still missing |
| 19 | DPO likely required | **Organisational** — not a code change |
| 20 | Cross-border transfers unassessed | **Partly** — described in the privacy page; the transfer file and a deliberate region choice are still outstanding |
| 21 | No privacy/terms/deletion pages or callbacks | **Fixed** — public routes plus verified data-deletion and deauthorize callbacks |
| 22 | Disconnect neither revoked nor deleted | **Fixed** — revokes at the platform, deletes the token, purges the data |
| 23 | No token refresh | **Fixed** — provider-specific windows, rotation persisted, under a lock |
| 24 | Mutation score 0/13 | **Fixed** — 16/16, gating the build |

## Still open

**Needs one real API response to settle.** Instagram's `online_followers` hour keys: whether they
are account-local or a fixed platform timezone. Until someone checks, the Planner labels its
recommendation instead of implying local time. This is the highest-value single verification left.

**Needs a decision.** Whether to migrate from *Instagram API with Facebook Login* to *Instagram API
with Instagram Login*. The latter drops the Facebook Page requirement and shrinks the permission set
further; it was not attempted here because the API surface could not be verified from the audit
environment.

**Needs the organisation, not the code.** The DPO question, the cross-border transfer file, the
Supabase and Netlify region choice, alerting and an on-call rota, and counsel sign-off on the PDPL
analysis and the draft policy text.

**Deferred, lower severity.** Share-link expiry and revocation; a retention purge job; a real
queue-backed sync for scale; the remaining optimistic claims in `src/lib/setupGuides.ts`.

## Before a real client account connects

1. Apply `supabase/migrations/0001` through `0004` in order.
2. Set `TOKEN_ENC_KEY` and `OAUTH_STATE_SECRET`; both now fail closed if missing.
3. Scope Netlify environment variables to the production context.
4. Turn on **Require App Secret** in the Meta app — every Graph call is signed already.
5. Register the data-deletion and deauthorize callback URLs in the Meta app.
6. Complete the bracketed details in the legal pages and have counsel review them.
7. Reconcile one real account's numbers against its native Instagram insights before anyone pays.
