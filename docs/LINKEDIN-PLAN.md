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

## Phase 2 — audience demographics · NEXT

Without it the Audience page is empty for a LinkedIn account, which reads as
broken rather than unimplemented.

`organizationalEntityFollowerStatistics` breaks followers down by country,
industry, seniority, function and company size — richer than Instagram's age,
gender and country. Two things to decide rather than assume:

- **The shape does not match `audience_snapshots`.** Instagram's buckets are age
  and gender; LinkedIn's are professional. Forcing one into the other would
  either drop LinkedIn's best dimensions or invent Instagram-shaped ones. Likely
  a new column or a JSON dimension, decided when the data is in front of us.
- **These are URNs, not words.** `urn:li:geo:103644278`, `urn:li:industry:4`.
  Rendering them needs a lookup, and an unresolved URN on a client's dashboard is
  worse than an absent section.

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

## Known constraints, carried forward

| | |
|---|---|
| Rate limit | 500 calls per app per day, 100 per member (Development Tier) |
| History | 12 months, rolling |
| Token life | 60 days, no server-side refresh |
| Per-post reach | Does not exist — stored as null |
| Follower movement | Does not exist for a page — churn and discovery stay silent |
| API version | Sunsets roughly annually; pinned at `LI.VERSION` |
| Write scope | `rw_organization_admin` is unavoidable and read/write |

## Not being built

The **member path** — a personal LinkedIn profile. `r_member_postAnalytics` would
read post analytics, but enumerating a member's posts needs `r_member_social`,
which LinkedIn states is closed and not accepting requests. Without a post list
there is no Content table and no per-post page, so it would be a visibly partial
connection. Revisit only if LinkedIn reopens that permission.
