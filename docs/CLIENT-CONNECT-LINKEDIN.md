# Connecting Drinkat's LinkedIn page

The LinkedIn counterpart of `CLIENT-CONNECT-INSTAGRAM.md`. Drinkat's Company
Page is PulseBoard's LinkedIn test account and its oracle: every live check in
`LINKEDIN-PLAN.md` Phase 3 runs on it. Nothing here can start until the
developer app has Development tier access (`SETUP-LINKEDIN.md`).

---

## Before the meeting: pick one of two routes

LinkedIn's reporting permission is "Restricted to organizations in which the
authenticated member has the following role: ADMINISTRATOR". On a page that role
is **Super admin**. A Content admin or an **Analyst** can see the Analytics tab
but cannot grant access; their connection finds no page.

**Decided 2026-09-14: the client connects his own account himself, in the meeting.**
His personal profile needs no admin role at all (Connect profile). His Company
Page needs him to already be its Super admin (Connect page). Route A below is kept
only for reference.

**Route A (not used): Drinkat makes us a super admin of their page.**
Their super admin opens the page as admin → **Admin tools → Manage admins → Add admin**, adds
our operator's LinkedIn profile, and picks **Super admin**. We then run the probe,
connect, sync and reconcile ourselves, on our own schedule, and remove the role
when testing ends or they ask. Tell them plainly what it allows: a super admin can
edit the page and post as it. PulseBoard never does; the role is what LinkedIn
requires for statistics.

**Route B: their super admin connects it themselves.** They need their own
PulseBoard sign-in, and must be present for the probe token and for every
reconnection (tokens last 60 days and LinkedIn does not let us renew them).

## The connection (either route)

1. Sign in at `app.theoffice.it.com` → **Connections**, tick the consent box.
2. **LinkedIn → Connect page** (a Company Page, as its super admin) or **Connect
   profile** (their own personal profile, any member). Sign in to LinkedIn, approve.
   A profile gives the follower count and the combined performance of all their
   posts; LinkedIn does not let apps list a profile's posts or its followers'
   demographics.
3. Back in PulseBoard the page shows **Connected**. If they administer several
   pages, the first one is connected; check it is Drinkat's.
4. Press **Sync** once. After that LinkedIn syncs by itself at most every four
   hours: LinkedIn allows a small number of requests a day, and its figures
   already trail by two days.

## Before they rely on a number

Instagram's rule applies: **no figure is presented as trustworthy until the
reconciliation has passed** (`LINKEDIN-PLAN.md` Phase 3). Drinkat is the test, and
Development tier is "designed to build and test integrations"; LinkedIn is not
part of a paid offer until Standard tier.

## What to tell them

- PulseBoard reads the page's statistics. It never posts, comments or edits.
- Figures stop about **two days before today**; that is LinkedIn, not a delay here.
- The Audience page shows **seniority, job function and company size**. Industry
  appears once LinkedIn approves our full access. **Locations never appear**:
  LinkedIn's terms do not allow them to be stored.
- LinkedIn has no per-post reach and no page views, so those stay blank rather
  than showing a zero.
- Around day 50 of a connection PulseBoard shows **Renew soon**. Pressing
  Reconnect then is one click; leaving it past 60 days means approving again.
- To withdraw access on LinkedIn's side: Settings & Privacy → Data privacy →
  Permitted services. Disconnecting in PulseBoard deletes what we hold.

## If it fails

| What they see | What it means |
|---|---|
| `linkedin_no_admin_page` | The account that approved is not a Super admin of any page |
| `linkedin_not_configured` | The client ID and secret are not set in Cloudflare yet |
| `linkedin_exchange_failed` | The redirect URL in the developer app does not match exactly |
| Connected, but no figures after a sync | Run the probe with a fresh token and read its FAIL lines |
