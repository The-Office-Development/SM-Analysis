# LinkedIn: the developer app, access, and the first live run

The LinkedIn twin of `SETUP-META.md`. Requirements quoted from
learn.microsoft.com on 2026-09-14 (Community Management App Review, Increasing
Access, Data Storage Requirements). The code side is in `LINKEDIN-PLAN.md`.

🔴 **A rejected application cannot be resubmitted.** "You won't be able to
re-apply for Development tier access with your existing app": a rejection means a
new app and a new form. Have every item in step 0 ready before submitting.

---

## 0. Have these ready first

| Needed | Ours |
|---|---|
| A registered legal organisation, commercial use | Al-Hujra Information Technology Company / Limited Liability, CR 83622. Use the name exactly as registered |
| Registered address | The D&B address used for Meta: Lina An-Nabulsi Street, Amman 11171 |
| Website | `https://theoffice.it.com` |
| Privacy policy | `https://app.theoffice.it.com/privacy` (live, covers LinkedIn) |
| **A business email address**, verified by LinkedIn | An `@theoffice.it.com` address (Zoho). "Personal email addresses won't pass the vetting process" |
| 🔴 **Our own company's LinkedIn Page**, with a super admin who can verify the app | **Not confirmed to exist.** The app must be "verified by LinkedIn Page associated with same organization". Drinkat's page cannot do this; it has to be The Office's |
| An app name with no part of "LinkedIn" or "Microsoft" | `PulseBoard` |

## 1. Create the app

1. `linkedin.com/developers/apps` → **Create app**, signed in as a super admin of
   The Office's LinkedIn Page.
2. App name `PulseBoard`; LinkedIn Page: The Office's page; privacy policy URL
   above; logo: the PulseBoard mark.
3. **Settings → Verify**: generates a verification link. The page super admin
   opens it and approves. Until then the app is unverified and the access form
   will be rejected.
4. **Auth → Authorized redirect URLs**: `https://app.theoffice.it.com/api/oauth-linkedin-callback`
   exactly.
5. **Products**: request **Community Management API** and nothing else. It can only
   be requested "with new developer applications that don't have access to other
   API products", so do not add Sign In with LinkedIn or Share on LinkedIn to this
   app, then or later.

## 2. The Development tier access form

Reviewed for: approved use case, verified business email, verified organisation,
verified website and domain, app verified by the organisation's page.

- **Use case: Page Analytics.** Nothing else. PulseBoard reads a Company Page's
  follower, post and page statistics and shows them to that page's own
  administrators. It does not post, comment, or read member profiles.
- Say what is stored and for how long, matching `LI.REPORTING_RETENTION_DAYS`
  (one year) and `LI.POST_RETENTION_DAYS` (six months), and that follower
  locations are not stored.

## 3. Once Development tier is granted

1. Cloudflare Pages → `pulseboard` → Settings → Variables and Secrets:
   `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` as secrets. Leave
   `LINKEDIN_API_TIER` unset (development is the default).
2. Redeploy the Pages app, and **also the cron Worker**
   (`CLAUDE.md`, "The cron Worker is NOT deployed by CI").
3. Get a token for the probe: Developer Portal → the app → **Auth → OAuth 2.0
   tools**, scopes `r_organization_social` and `rw_organization_admin`, signed in
   as a **super admin of Drinkat's page** (see `CLIENT-CONNECT-LINKEDIN.md`).
4. Run the probe before anything syncs:
   `LI_TOKEN=... node verify/probe-live-linkedin.mjs`
   then once more with `--try-batch` to learn how development tier refuses a
   BATCH_GET. Record what it settles in `LINKEDIN-PLAN.md` Phase 3.
5. Connect Drinkat's page in PulseBoard, let it sync for a few days, then run
   `node verify/reconcile.mjs --account <id>` beside the page's Analytics tab.

Limits while on development tier: 500 calls per app and 100 per member per 24
hours, no BATCH_GET, and the integration must be finished "within twelve months
of receiving the API access". The sync keeps inside these (4-hour interval, no
batch lookups), so industry names do not appear until Standard tier.

## 4. Standard tier

Found under **My Apps → Products** once development tier is approved. Reviewed
for: approved use case, valid privacy policy, compliance with the terms and the
data storage requirements, and a screencast.

**Screencast for Page Analytics** (high resolution, downloadable, only the app on
screen, narrated):
1. A user approving access to their page through the complete OAuth flow.
2. How the performance of the page's posts, e.g. reactions, is shown in the app.
3. What personal data from members who engage with posts is shown: **none**.
   Say so on the recording; the app stores no member data.
4. For the two Page Management and Brand Engagement cases the form may list,
   note on the recording that PulseBoard does not post or read mentions.

Provide test credentials for the reviewers, as for Meta.

After approval, set `LINKEDIN_API_TIER=standard` and redeploy both the app and
the Worker: industry names then resolve.

## 5. Storage rules the code now enforces

| LinkedIn category | Limit | Where |
|---|---|---|
| Page admin and reporting data (daily figures, followers, demographics) | One year | `purgeLinkedInExpired`: `metrics_daily`, `audience_snapshots` |
| Organisation social activity (posts), authenticated org | Six months | never stored past 182 days; purged as they age |
| Organisation profile data (page name), authenticated org | Eight weeks | re-read daily |
| Standardized data (industries, functions) | One year | inside the snapshot, purged with it |
| Bing Maps location data | **May not be stored** | countries and market areas are not fetched or kept |
| Other members' profile data | 24-hour cache, no storage | never fetched |
