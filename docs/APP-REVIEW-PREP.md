# App Review: what is ready, and what is left

Written 2026-09-14, while Business Verification is in review (submitted
2026-09-13). App Review is prepared in parallel and **submitted once
verification clears**: Meta states "Advanced Access now requires Business
Verification" (`SETUP-META.md` §3b), and Tech Provider access verification is
itself locked until verification completes. Do not edit the business name,
address or portfolio details while verification is pending.

---

## 1. Done on branch `review-readiness` (not deployed)

Push to `main` deploys to production through CI, so none of this is live until
the branch is merged.

- **The legal pages have no bracketed placeholders.** Each former placeholder now
  holds proposed wording (section 2). The "Draft pending legal review" banner stays.
- **"Export my data" and "Delete my account" exist.** The privacy policy has
  named both since 2026-08-24, and `/api/account-data` has served both since
  then, but no button calling either was ever rendered. They are now on the
  Connections page, which is where the policy now says they are ("in your
  settings" named a page that does not exist).
- **The policy no longer says disconnecting revokes access at the platform.** That
  is true for Facebook Login and TikTok only. `disconnect.ts` has no branch for
  provider `instagram` (every live account) and LinkedIn documents no revoke
  endpoint. The policy, the data-deletion page and the disconnect dialog now say
  where to remove PulseBoard on Instagram and LinkedIn.
- **The policy covers LinkedIn**, including that `rw_organization_admin` carries
  write rights we never use. It previously said every permission was read-only.
- **The consent checkbox now names the transfer abroad.** PDPL Article 15(A)(5)
  permits a transfer abroad on consent "after informing them of the insufficient
  level of protection"; the checkbox did not inform. `CONSENT_VERSION` is bumped to
  `2026-09-14` in all four OAuth starters.
- 🔴 **The Meta deletion and deauthorize callbacks could not handle an Instagram
  user.** Both verified the signed request with `META_APP_SECRET` only and looked
  up provider `meta` only. Every live identity is provider `instagram`, under
  `INSTAGRAM_APP_SECRET`. A real request was either refused as forged or
  acknowledged while deleting nothing. Meta tests this callback during review.
  Both handlers now accept either of our secrets and pick the provider from the
  one that verifies. Test and mutation added.
- **Account deletion checked `deleteUser` by `catch` only.** supabase-js resolves
  with `{ error }`, so a refused sign-in deletion was logged as done. Now checked,
  and the user is told what remained.

`npm test`: 186 tests pass, mutation score 76/76.

## 2. Wording that needs owner and counsel sign-off

These are proposals written from the primary text of Law No. 24 of 2023
(modee.gov.jo English PDF), not legal advice.

| Placeholder | Proposed | Basis, and what is not settled |
|---|---|---|
| Statutory response period | "we respond within 30 days" | **The law sets no period.** Article 4(D) leaves the rights "to be organised in regulations". No regulation fixing a deadline was found; the 2025 regulation found concerns how the Unit works. 30 days is our own commitment. Counsel to confirm nothing shorter applies. |
| Regions and transfer basis | Supabase Frankfurt, Cloudflare global network, Anthropic (US company); basis Article 15(A)(5) consent | Region checked with `supabase projects list`. **Article 15(B) also requires the controller to verify each recipient's protection before transferring.** No written assessment exists, so the page does not claim one. Write it, then add the sentence back. |
| Uptime | No commitment, no service credits | A commercial position, and true today. |
| Liability | Exclude indirect loss and decisions made on platform figures; cap at 12 months' fees; Amman courts | Standard shape. Counsel to confirm enforceability under Jordanian civil law. |
| Complaint authority | Personal Data Protection Unit, Ministry of Digital Economy and Entrepreneurship | Article 2 of the law defines "The Unit" as the unit responsible for personal data protection "within the Ministry" of Digital Economy and Entrepreneurship. |

**Open and not a wording question:** Article 11(A) requires a Data Protection
Officer when the controller's "primary activity" is processing personal data, or
when "transferring to databases outside the Kingdom". PulseBoard does the second
by design. Treat a DPO as required unless counsel says otherwise.

## 3. Before submitting: live checks nobody has run

1. 🔴 **Test the deletion callback against a real removal.** Meta's Instagram Login
   documentation does not say which secret signs these callbacks or which user id
   they carry, so the fix above avoids guessing but is unproven. Using
   `@heath_ens21` (the test account; it will need reconnecting afterwards):
   remove PulseBoard in Instagram → Settings and activity → Website permissions →
   Apps and websites. Then check Cloudflare logs for `deauthorize.handled` /
   `deletion.completed` with provider `instagram`, or `*.no_identity_match` with
   the id received. A no-match means the callback sends a different id from the
   stored professional-account id (`1784…`), and the lookup needs changing.
2. Confirm in the Instagram product settings that the deauthorize and data
   deletion URLs are set to `/api/meta-deauthorize` and `/api/meta-data-deletion`.
3. Confirm the Instagram menu path above against the app itself. The policy
   states it and it has not been checked on a device.

## 4. Reviewer access

Meta: "if reviewers cannot access your app to test it, your entire submission
will be rejected."

- **A PulseBoard login.** Create a dedicated, confirmed user just before
  submitting (Supabase dashboard → Authentication → Add user, auto-confirm), and
  put the credentials only in Meta's submission form. Creating it earlier leaves a
  standing account with a password in circulation for no benefit.
- **An Instagram professional account to connect.** Demo mode does not exercise
  the permissions under review, so it cannot be the whole answer. The reviewer
  connects through the normal Connect button.
- **The Connections page shows operator material to every user:** each platform's
  "Setup guide" lists redirect URIs and Cloudflare environment variables. A
  reviewer reads that as a developer tool. Hide the guides from non-operators
  before submitting.

## 5. The submission itself

Permissions: `instagram_business_basic`, `instagram_business_manage_insights`.
Nothing else.

**Use case, `instagram_business_basic`:** PulseBoard is an analytics dashboard
for Instagram professional accounts. We use this permission to identify the
account the user connects (id, username, name, profile picture) and to list its
posts, so the user can see each post's performance in their dashboard. We never
publish, comment or message.

**Use case, `instagram_business_manage_insights`:** We read account insights
(reach, views, follower movement, audience demographics) and per-post insights,
store them for the connected account only, and show them as daily trends, a
per-post view, audience breakdowns and reports the account owner can export or
share. The data is shown only to the user who connected the account.

**Screencast, in order, one take, `@malekismaiil` (real data):**
1. Open `app.theoffice.it.com`, sign in.
2. Connections: tick the consent box, press Connect on Instagram.
3. Instagram's consent screen showing both permissions; approve.
4. Back in PulseBoard, the account shows Connected.
5. Overview with real figures, then Content → one post's detail, then Audience.
6. Connections → Disconnect, to show the user can withdraw.
