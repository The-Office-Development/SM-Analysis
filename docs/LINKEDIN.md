# LinkedIn — what connecting it would actually take

Researched 2026-09-10 against `learn.microsoft.com/en-us/linkedin`, which is the
current home of LinkedIn's API documentation. Everything quoted below is from
those pages on that date. **Nothing here has been tested against a live call**,
for the same reason the Instagram work carries that warning: documentation
agreement is not a live response, and the Instagram pass found three of four
daily metrics wrong after the docs said otherwise.

---

## 1. The verdict

**Technically a good fit. Commercially gated behind an approval with a long lead
time, and sitting on a faster deprecation treadmill than Meta.**

The surprise is that LinkedIn now has a **member-level creator analytics API**
that maps almost one-to-one onto what this product already stores. That was not
true a couple of years ago, when only Company Pages had anything worth reading.

The catch is not the data. It is the door.

---

## 2. What the API gives us

### Member post analytics — the important one

`GET /rest/memberCreatorPostAnalytics`, permission **`r_member_postAnalytics`**,
described as:

> "Retrieve your posts and their reporting data."

Read-only, which matters: it satisfies the standing rule in `CLAUDE.md` that no
write-capable scope is ever requested.

Two finders:

- `q=me` — aggregated across everything the member has posted
- `q=entity&entity=(share:urn:li:share:…)` — one post

Both accept `aggregation=DAILY` and a `dateRange`, which is exactly the shape
`metrics_daily` wants.

Metrics available on version `202604` and later:

| LinkedIn metric | Maps to |
|---|---|
| `IMPRESSION` | `impressions` |
| `MEMBERS_REACHED` | `reach` |
| `REACTION` | `likes` |
| `COMMENT` | `comments` |
| `RESHARE` | `shares` |
| `POST_SAVE` | `saves` |
| `POST_SEND` | no column yet |
| `LINK_CLICKS` | no column yet |
| `FOLLOWER_GAINED_FROM_CONTENT` | **no equivalent anywhere else** |
| `PROFILE_VIEW_FROM_CONTENT` | no column yet |

`FOLLOWER_GAINED_FROM_CONTENT` is worth pausing on. It attributes followers to
the individual post that won them. Instagram gives a daily follower delta and
leaves the attribution to guesswork — the whole `followerCost` analysis exists
because we have to infer it from timing. LinkedIn simply reports it.

Two caveats stated in the docs and worth carrying into any UI:

- "Data is best-effort accurate and shouldn't be used for billing purposes."
- `DAILY` is not supported for `MEMBERS_REACHED`, `LINK_CLICKS`,
  `FOLLOWER_GAINED_FROM_CONTENT` or `PROFILE_VIEW_FROM_CONTENT` — those are
  lifetime totals only. So a daily reach series is **not** available for members,
  and any chart implying one would be inventing it.
- "RESHARE, REACTION, COMMENT are not consistent with UI at the moment" — their
  words. That is the same class of problem as Instagram's day-boundary gap, and
  it should be found before a client finds it.

### Member follower statistics

`community-management/members/follower-statistics` — lifetime and time-bound
follower counts for a member. Feeds the follower series.

### Company Pages, if a client has one

`rw_organization_admin` covers page analytics: follower statistics, page
statistics, share statistics, video analytics. Note the `rw_` prefix — it is
read AND write, "Manage organization pages and retrieve reporting data." There is
no read-only equivalent for organization reporting, so connecting a Company Page
means holding a credential that could post as that page. That conflicts with the
invariant that got `business_management` dropped from the Meta app, and it needs
a deliberate decision rather than a default.

Organization data also requires the authenticated member to hold the
`ADMINISTRATOR` role; anything less returns `403` and only the public fields.

---

## 3. What it costs to get in

The Community Management API is a **vetted product** with two tiers:

- **Development Tier** — initial approval, limited volume
- **Standard Tier** — full access, and it requires "a screencast video
  demonstrating each use case specified in your access request form"

That is the same shape as Meta's App Review, and it should be assumed to take as
long. It cannot be started casually either: Development Tier access can only be
requested "with new developer applications that don't have access to other API
products."

### Rate limits are the real design constraint

Development Tier, per the FAQ:

- **500 requests per app per day**
- **100 requests per member per day**

Read that against how this product syncs. The Instagram sync spends roughly 22
calls per account per run at a 15-minute cadence, which is ~2,100 calls a day for
a single account. **That pattern is impossible here.** A LinkedIn sync would have
to be daily, or close to it, and the per-app ceiling of 500 means roughly a
handful of accounts before the app itself is exhausted. Standard Tier presumably
raises this; the docs do not say by how much.

### Versioning is a treadmill

Requests carry a `Linkedin-Version: YYYYMM` header, and versions are sunset on a
roughly annual cycle — the current notice says version `202508` sunsets on
**17 August 2026**. Meta expires an API version about every two years. This is
twice the maintenance tax, and `CLAUDE.md` already calls platform deprecation "a
permanent tax on this product, not a one-off migration."

---

## 4. The open question that decides the shape

**How do we enumerate a member's posts?**

`memberCreatorPostAnalytics` with `q=entity` needs a post URN. Something has to
supply the list of URNs, and the obvious candidate is the Posts API filtered by
author — which appears to sit behind `r_member_social`. That permission is
**closed**:

> "`r_member_social` is a **closed** permission. We're not accepting access
> requests at this time due to resource constraints."

If that is the only route to a member's post list, then:

- **Account-level metrics work** via `q=me` — a daily series of impressions,
  reactions, comments, reshares, plus follower statistics. Enough for the
  Overview and the growth charts.
- **The per-post layer does not.** No Content table, no per-post page, no format
  comparison, no "every post and how far it got" — because we would have no post
  list to iterate.

That would make LinkedIn a materially thinner integration than Instagram, and it
changes what can honestly be promised. **This must be resolved before any code is
written.** It is one question to LinkedIn's developer support, or one live call
once Development Tier access exists.

---

## 5. What it touches in this codebase

Adding a platform is not a large change; the seams already exist.

| File | Change |
|---|---|
| `src/lib/types.ts` | `Platform` union gains `"linkedin"` |
| `src/lib/platforms.tsx` | name, colour, icon, `PLATFORM_ORDER` |
| `netlify/functions/oauth-linkedin.ts` | new, mirroring `oauth-instagram.ts` |
| `netlify/functions/oauth-linkedin-callback.ts` | new; same state/nonce discipline |
| `netlify/functions/_linkedin.ts` | new — the single source of API strings, as `_instagram.ts` is |
| `netlify/functions/_sync.ts` | a `syncLinkedIn` branch beside the existing three |
| `functions/api/[[path]].ts` | two new routes |
| `verify/tests/mock-linkedin.mjs` | an oracle mock, as `mock-graph.mjs` is |

Two colour slots exist (`--fb`, `--ig`, `--tt`); a fourth series colour would
need adding and validating for colour-vision separation, the same way the chart
palette was.

The day-boundary rule applies unchanged: LinkedIn returns `dateRange` as
year/month/day objects with an **exclusive** end, which is a different convention
from Meta's `end_time`, and getting it wrong would file every figure a day out —
the exact defect `dayKeyFromEndTime` exists to prevent.

---

## 6. Recommendation

**Do not start this before the Instagram product is earning.** Concretely:

1. Instagram App Review has to pass first. It is the same kind of approval, it is
   already in flight, and doing two at once splits attention on the one that
   pays.
2. Ask LinkedIn support the post-enumeration question above. It is free, it takes
   a day, and the answer decides whether LinkedIn is a real integration or an
   account-level summary.
3. Only then apply for Development Tier — remembering it needs its own fresh
   developer application.

**Who it would be for.** LinkedIn is not where Jordanian lifestyle creators live.
It is where B2B consultants, recruiters, agencies and company pages live. That is
a different customer from drinkat, so this is a market-expansion decision, not a
feature-completion one, and it should be priced and sold as such rather than
added because the tile looks empty on the Connections page.
