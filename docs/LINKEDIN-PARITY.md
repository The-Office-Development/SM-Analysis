# LinkedIn against everything the Instagram path learned

Written 2026-09-14 by going through the full history (160 commits), the
invariants in `CLAUDE.md` and the Instagram code path, and checking each
mechanism against the LinkedIn path and LinkedIn's primary documentation.

Marks: **✅ in place** · **🔧 fixed 2026-09-14** · **➖ does not apply, and why** ·
**⏳ open, needs a live call or a person**

---

## 1. Numbers that can be trusted

| What the Instagram path does | LinkedIn |
|---|---|
| Never writes a fabricated zero; null means unreported | ✅ tested and mutation-guarded (views, per-post reach, saves, follows) |
| Never overwrites a stored figure with null (`mergeWithStored`, `mergeContentWithStored`) | ✅ shared code path |
| Trailing re-fetch so recent days settle | 🔧 LinkedIn now re-reads its whole year every run in one call, instead of Instagram's chunked walk |
| Deep backfill, measured ("insights go back two years") | 🔧 was stuck at Instagram's 30-day chunks; now the 12 months LinkedIn serves, on the first sync |
| Day boundary taken from the account's own timezone, not the platform's | ➖ **exception.** LinkedIn buckets days in UTC and offers no other granularity: "12 months before the request date (UTC) till 2 days before the request date (UTC)". Recorded in CLAUDE.md. ⏳ reconciliation shows which day LinkedIn's own UI uses |
| Provisional flag on days still settling | ✅ shared; ⏳ probe prints LinkedIn's actual trailing lag |
| One unmeasurable post never costs every post | 🔧 a failed per-post call wrote zeros over every post; now leaves them unknown |
| Absent-means-zero only where the platform says so | 🔧 kept for LinkedIn (documented), but only inside a call that succeeded, and only for the URN type it asked about |
| Media paged, not first page only | 🔧 posts now follow `paging.links` to the six-month floor, max 3 pages |
| Only the account's own content | 🔧 sponsored dark posts, feed-less posts and drafts excluded; the finder returns sponsored posts too |
| Follower line never drawn from zero or back-dated | ✅ today's `networkSizes` total only, one real point per day going forward |
| Churn and discovery split null when unmeasured | ✅; ⏳ `followerGains` gross-or-net, settled by two probe runs a day apart |
| Demographics: absence from the platform, not from arithmetic | ✅ `genderSplit`, "Unknown" sorted last, facets never folded into Unknown 100% |
| Throttle and auth errors never swallowed | ✅; 🔧 a taxonomy 403 no longer reads as an expired login |
| Call budget ordered so what cannot wait goes first | ✅ demographics once a day before the rest; 🔧 4-hour interval for 100 calls/member/day |
| Stories captured before they expire | ➖ LinkedIn has no stories |

## 2. Verification

| Instagram | LinkedIn |
|---|---|
| `probe-live.mjs` before any sync writes | 🔧 `probe-live-linkedin.mjs`; ⏳ run on Drinkat's token |
| `reconcile.mjs` against the platform's own insights | 🔧 LinkedIn columns and Analytics-tab instructions; ⏳ run after a few days |
| `API-VERIFICATION.md`: every name checked against the primary docs | 🔧 checked 2026-09-14: share statistics, follower statistics, posts finder, organization lookup, network size, access control, OAuth, protocol encoding. Four defects found (encoding, ugcPosts, admin field, storage) |
| A mock that knows the true value and rejects wrong requests | 🔧 the mock now rejects malformed Rest.li, answers per URN type, pages, and serves sponsored and draft posts |
| Mutation for every defect fixed | ✅ 91/91 |
| `DATA-INTEGRITY.md` record of what live data showed | ⏳ after reconciliation |
| An oracle account that is genuinely old, not converted for testing | ✅ Drinkat's real Company Page; the Analytics tab is a visible oracle, which Instagram never had |

## 3. Connection and security

| Instagram | LinkedIn |
|---|---|
| OAuth state bound to a browser nonce | ✅ |
| Code-exchange diagnostics that say which input was wrong | ✅; 🔧 secret fingerprint added, as on Instagram |
| Audit the token actually held, not the one requested | 🔧 records the `scope` LinkedIn returns, logs anything unexpected |
| No write scope beyond necessity | ✅ `rw_organization_admin` is unavoidable and disclosed; only GETs, test-guarded |
| Tokens encrypted at rest | ✅ shared |
| Refresh before expiry, under a lock | ➖ LinkedIn refresh is partner-only; ✅ "Renew soon" ten days out instead |
| Account owned by another tenant cannot be attached | ✅ |
| Consent recorded with version | ✅ `CONSENT_VERSION` 2026-09-14 |
| Deauthorize and deletion callbacks | ➖ LinkedIn has none; disconnect deletes, and the page says where to withdraw |
| Disconnect revokes at the platform | ➖ no revoke endpoint; the policy and dialog say so |
| Tester route is a pilot while review is queued, not a launch | ✅ same stance: Development tier is "designed to build and test integrations"; Drinkat is the test, Standard tier before any paid LinkedIn use |
| Platform data-storage rules | 🔧 Instagram has none this strict; LinkedIn's are enforced (posts 6 months, reporting 1 year, name 8 weeks, no location names) |

## 4. What the client sees

| Instagram | LinkedIn |
|---|---|
| Every panel says "unknown" rather than 0 | 🔧 Content page: avg engagement rate read "0.0%" for LinkedIn, and totals counted unknowns as 0 |
| Figures labelled for what they are | 🔧 impressions were labelled "Views" and summed with Instagram views; now "Impressions" and "Reposts", never mixed |
| "Read from Instagram N minutes ago" | 🔧 the Content table said Instagram for every platform |
| Post page reads the post live on open, and "Check now" | 🔧 LinkedIn has no such read and its budget cannot afford one; the page no longer attempts it or claims it |
| Empty panels explain themselves in words | ✅ age, gender, activity hours; 🔧 locations |
| Demo shows only what the platform can fill | ✅; 🔧 LinkedIn locations removed |
| Exports and assistant speak for the right platform | ✅ (commits `4811a36`, `800d690`) |
| Operator setup guides hidden from clients | ✅ |
| Client connect guide written from a real connection | 🔧 `CLIENT-CONNECT-LINKEDIN.md`; ⏳ corrected after Drinkat's connection |

## 5. Still open, in order

1. ⏳ The Office's own LinkedIn Page, then the app and the Development tier form (`SETUP-LINKEDIN.md`)
2. ⏳ Drinkat route A or B (`CLIENT-CONNECT-LINKEDIN.md`)
3. ⏳ Probe, twice a day apart; narrow the admin field name; settle `followerGains`
4. ⏳ Connect, sync, reconcile, record in `DATA-INTEGRITY.md`
5. ⏳ Standard tier with the screencast
