# The LinkedIn application, ready to paste

Everything LinkedIn asks for, written out. The steps are in `SETUP-LINKEDIN.md`;
this is the wording, so the page and the form take minutes rather than an
evening. Written 2026-09-15.

🔴 **A rejected Development tier application cannot be resubmitted with the same
app.** Have the page verified and the email verified BEFORE submitting the form.

Every fact below must match what other registers hold. The name and address are
from `docs/PROJECT-STATE.md` §0 and the handbook's company record; do not vary them.

---

## 1. The Office's LinkedIn Page

Create it from your own LinkedIn (you become its Super admin), at
`linkedin.com/company/setup/new`.

| Field | What to enter |
|---|---|
| Name | `The Office Development` |
| LinkedIn public URL | `the-office-development` (or the nearest free variant; record which) |
| Website | `https://theoffice.it.com` |
| Industry | Software Development |
| Company size | 2-10 employees |
| Company type | Privately Held |
| Logo | The Office mark, 300x300 or larger |
| Tagline (120 max) | `Software and analytics built in Amman.` |

**About (paste):**

> The Office Development is the trading name of Al-Hujra Information Technology
> Company / Limited Liability, a software company registered in Amman, Jordan
> (commercial registration 83622).
>
> We design and build web and mobile software, and the analytics behind it. Our
> own product, PulseBoard, gives creators and organisations one honest view of
> how their content performs across Instagram, Facebook, LinkedIn and TikTok:
> official read-only connections, no passwords, and a figure marked unknown
> rather than guessed at.
>
> Amman, Jordan.

**Specialties:** web development, mobile applications, social media analytics,
data engineering, product design.

**Before applying, make the page look lived in:** a logo, a cover image, the
about text above, you and Malek listed as employees, and two or three posts. A
page created the same hour as the application is the thing a reviewer can see.

## 2. The developer app

| Field | Value |
|---|---|
| App name | `PulseBoard` |
| LinkedIn Page | The Office Development (the page above) |
| Privacy policy URL | `https://app.theoffice.it.com/privacy` |
| App logo | The PulseBoard mark |
| Authorized redirect URL | `https://app.theoffice.it.com/api/oauth-linkedin-callback` |
| Products to request | **Community Management API only** |

Then **Settings → Verify**, and approve the link as the page's Super admin.
Nothing else may be added to this app, before or after: Development tier is only
granted to "new developer applications that don't have access to other API
products".

## 3. The access request form

| Field | Answer |
|---|---|
| Legal organisation name | `Al-Hujra Information Technology Company / Limited Liability` |
| Registered address | Lina An-Nabulsi Street, Amman 11171, Jordan |
| Website | `https://theoffice.it.com` |
| Privacy policy | `https://app.theoffice.it.com/privacy` |
| Business email | your `@theoffice.it.com` address (verify it; check the spam and promotions tabs) |
| Use case | Page Analytics |

**Describe the integration (paste):**

> PulseBoard is a social media analytics dashboard operated by Al-Hujra
> Information Technology Company (trading as The Office Development), Amman,
> Jordan. Clients connect their own accounts through official OAuth and see their
> performance across platforms in one place.
>
> For LinkedIn we read, and only read, two things. For a Company Page the member
> administers: daily page statistics, per-post statistics, follower counts and
> the professional demographics of its followers, shown to that page's own
> administrators. For a member who connects their own profile: their follower
> count and the combined analytics of their own posts. We never publish, comment,
> react, message, or read another member's profile; the integration issues GET
> requests only, which our test suite asserts.

**Scopes requested:** `r_organization_social`, `rw_organization_admin`,
`r_basicprofile`, `r_member_profileAnalytics`, `r_member_postAnalytics`.
If asked why `rw_organization_admin`: LinkedIn publishes no read-only scope for
organization reporting, and the app never calls a write endpoint.

**If the form asks about data storage (paste):**

> Page analytics are stored for at most one year, an organisation's posts for at
> most six months, and a page's name for at most eight weeks, matching LinkedIn's
> Data Storage Requirements; older rows are deleted automatically on every sync.
> A member's own post analytics are held for 48 hours only. Location names from
> LinkedIn's geo data are never stored. No data about any other member is
> requested or stored. Data is held in Frankfurt (Supabase), encrypted at rest,
> and deleted when the client disconnects.

## 4. After approval

`SETUP-LINKEDIN.md` §3: set the two secrets in Cloudflare, redeploy the app and
the cron Worker, run the probe (`--profile` first), then connect.
