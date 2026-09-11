# LinkedIn — the plan, and where it stands

Research is in [`LINKEDIN.md`](LINKEDIN.md). This is what is built, what is not,
and in what order the rest happens.

**Nothing here has been verified against a live LinkedIn response.** The whole
integration is written against documentation, and the Instagram pass is why that
warning is repeated rather than assumed: three of four daily metrics were wrong
*after* the documentation agreed with the code.

---

## Phase 1 — the connection lifecycle · DONE (`1aa6bc5`)

The sync was written and tested first; nothing around it was, so an account could
be connected and then silently stop working. Two things could not be copied from
the other platforms.

**Tokens cannot be refreshed from a server.** LinkedIn: "Programmatic refresh
tokens are available for a limited set of partners", and otherwise "go through
the authorization process again to fetch a new token". Tokens last 60 days. The
refresh job used to fall through to `skipped`, so a connection would die two
months after it was made with nothing said.

It now flags the account ten days out (migration `0014`, `needs_reauth`) and
still returns `skipped`, because nothing was refreshed. Ten days is *warning*,
not headroom: LinkedIn skips the consent screen while the token is still alive,
so a click inside that window is invisible to the client and a click after it is
a full consent screen — which for a Company Page means finding an administrator.
Connections shows a third state, **Renew soon**, between connected and expired.

**Revocation does not exist.** LinkedIn documents no revoke endpoint for this
flow. Disconnect deletes our copy and names where the client withdraws the
permission themselves: Settings and Privacy → Data privacy → Permitted services.

## Phase 2 — audience demographics · DONE

Without it the Audience page was empty for a LinkedIn account, which reads as
broken rather than unimplemented.

**This phase was built by reading `learn.microsoft.com` directly**, which earlier
sessions could not do — the sandbox blocked it, so every LinkedIn claim in this
repo until now came from secondary sources. The first session able to open the
page found the plan above wrong in four places, none of which would have thrown
an error:

1. **There are seven facets, not five.** The plan omitted
   `followerCountsByAssociationType`, and — the one that matters — treated
   geography as a single facet when LinkedIn returns **two**:
   `followerCountsByGeoCountry` (countries) and `followerCountsByGeo` (market
   areas, e.g. "Amman Governorate, Jordan"). A follower appears in both, so
   merging them into one column counts them twice. Countries go in the shared
   `countries` column; market areas are their own dimension. A mutation guards it.
2. **`organicFollowerCount` is not the organic count.** LinkedIn: "Professional
   Demographic results are rolled up as a total of both organic and paid
   followers in the `organicFollowerCount` field. Do not refer to the
   `paidFollowerCount` field." The field is named for one thing and holds
   another, so adding the two — which the names invite, and which a reviewer
   would take for a fix — double-counts every paid follower. Mutation added.
3. **Demographics and a date range are mutually exclusive.** "Time-bound
   follower counts are aggregated and **not** segmented by facet." Asking for
   both returns `200` with the facets simply absent, which is indistinguishable
   from a page whose followers have no recorded industry. The facet call
   therefore passes no `timeIntervals` at all, and a test asserts it.
4. **Each facet is capped at its top 100 values, and the endpoint no longer
   returns `totalFollowerCounts`** to measure that against. So a stored share is
   a share *of what LinkedIn answered*, not of the page's followers, and the two
   cannot be reconciled. The UI says "share of followers it could classify"
   rather than implying otherwise, and the sync logs when a facet hits the cap.

**The URNs.** Resolved at write time, so no dashboard can ever render
`urn:li:industry:4`. The taxonomies live on the **legacy `/v2` base, not `/rest`**,
and take no `LinkedIn-Version` header — `liGet` now knows both. Geo and industry
are BATCH_GET (and use *different* batch syntaxes on the same API: `ids=List(a,b)`
versus repeated `ids=`); seniorities and functions are small enough to fetch
whole. Four calls per account per day, not one per value.

The industry taxonomy version is **pinned** (`V2_7`), like `LI.VERSION`, because
`DEFAULT` means the name behind an id can change under us between deploys and a
stored snapshot would silently disagree with an older one.

A URN that cannot be named becomes **"Unknown"** rather than being printed or
dropped. Printing it is worse than saying nothing; dropping it silently shrinks
the denominator so every other bar grows. A mutation guards that too.

**Storage: migration `0015`**, a `dimensions` jsonb on `audience_snapshots`.
The Instagram-shaped columns stay as they are and LinkedIn's professional facets
go in an open map, so the next platform's facets need no migration. Country is
the deliberate exception — it means the same thing everywhere.

The Audience page now renders whatever dimensions a snapshot carries, and for a
LinkedIn-only account says plainly that age, gender and follower-activity hours
are **not reported for a Company Page** — not "not available yet", because they
are not coming later.

**The seventh facet is deliberately not stored.**
`followerCountsByAssociationType` is returned and is real, but it is not a
distribution: one bucket, `EMPLOYEE`, counting followers who work at the company.
Normalising a single bucket gives 1.0, so it rendered **"Employee 100%"** — which
would have been true of every page that ever connected, and flattering, which is
the worst kind of wrong. Showing it honestly needs the page's follower total as
the denominator; this endpoint no longer returns one, though `networkSizes` does
and the daily sync already calls it. Left out until it can be shown as a count
against a total rather than a slice of a pie.

**Two defects were found by rendering the page, not by reading the code.**
Both had passed typecheck, tests and review:

- the gender panel showed **"Other 100%"** for an account with no gender data,
  because absence was decided by `1 - female - male` rather than by whether the
  platform reported anything. **This one had already shipped** and was never
  LinkedIn-specific — a Facebook Page connected after 14 March 2024 gets no
  demographics either, and every one of them has been showing it. Fixed in
  `genderSplit` (`src/lib/insights.ts`), with a test and a mutation.
- "Unknown" sorted by size, so it could take the top row of a panel and turn
  "we could not name 22% of these" into the headline finding. It now sorts last.

**Still no live call.** 159 tests, 59/59 mutations, all against a mock built from
the documentation. That is the same position Instagram was in when three of its
four daily metrics were wrong.

## Phase 3 — live verification · BLOCKED

Needs Community Management API access, which needs a **new** developer
application holding no other API product, Development Tier first, then Standard
with a screencast. Until then the first real call cannot be made.

When access lands, in order:

1. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` as Cloudflare secrets.
2. Connect a Company Page we administer and read the raw responses before
   trusting any stored figure.
3. Reconcile against LinkedIn's own analytics tab, the way Instagram was
   reconciled. That gate is what turns "written" into "works".
4. Check the four things the mock asserts but has never proven: the exclusive
   end, absent per-share reach, an omitted post meaning zero, and a negative
   like count.
5. **Settle whether `followerGains` is gross or net** — see the correction below.
6. Check the demographic facets against the page's own Analytics tab, which
   shows the same breakdowns. Unlike the Instagram reconciliation there IS a
   visible oracle here, and it should be used before a client sees the page.

## Known constraints, carried forward

| | |
|---|---|
| Rate limit | 500 calls per app per day, 100 per member (Development Tier) |
| History | 12 months, rolling |
| Token life | 60 days, no server-side refresh |
| Per-post reach | Does not exist — stored as null |
| Follower movement | Partly exists — see the correction below. Not stored yet |
| Demographic facets | Lifetime only, top 100 values each, no total to check against |
| Time-bound data | Ends **two days** before the request date, not yesterday |
| API version | Sunsets roughly annually; pinned at `LI.VERSION` |
| Write scope | `rw_organization_admin` is unavoidable and read/write |

## Not being built

The **member path** — a personal LinkedIn profile. `r_member_postAnalytics` would
read post analytics, but enumerating a member's posts needs `r_member_social`,
which LinkedIn states is closed and not accepting requests. Without a post list
there is no Content table and no per-post page, so it would be a visibly partial
connection. Revisit only if LinkedIn reopens that permission.

---

## Correction — follower movement does exist, and this file said it did not

Recorded 2026-09-12, from LinkedIn's own documentation rather than a summary.

`docs/LINKEDIN-PLAN.md` and a comment in `syncLinkedIn` both stated flatly that
no follower movement exists for a Company Page. That is wrong. Querying
`organizationalEntityFollowerStatistics` **with** `timeIntervals` returns a
per-day `followerGains` of `organicFollowerGain` and `paidFollowerGain`.

It is **deliberately not stored yet**, and the reason is not caution for its own
sake. The documentation does not say whether a "gain" is gross follows or net of
unfollows, and LinkedIn reports no unfollows separately at all. Writing a net
figure into the gross `follows` column would produce a funnel that is wrong in a
way no test can detect, because the mock can only be as right as the guess. One
live call settles it; until then the column stays null, which is the honest
answer to a question we cannot yet answer.

What it would buy, once settled: a real follower series for a Company Page.
Today only *today's* total is known, from `networkSizes`, and the days behind it
are null. Walking that total backwards through daily gains would reconstruct the
history — but only if the gains are net, which is precisely the unknown.

Also corrected: time-bound statistics stop **two days** before the request date,
not one. "If you're calling this endpoint on December 31, 2021 ... the last data
point available will be December 29, 2021." The constraints table said twelve
months and nothing about the trailing edge.
