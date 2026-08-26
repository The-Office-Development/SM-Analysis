# Setting up the Meta side

The administrative path from nothing to "a client can connect". Most of the
elapsed time here is Meta reviewing things, so **start section 1 today** — it
runs in parallel with everything else and nobody can shortcut it.

You do **not** need to be a *Meta Business Partner*. That is a marketing
programme (badge, directory listing, priority support) gated on ad spend and
client volume. It has nothing to do with API access.

---

## 1. Business Verification — start first, typically 2–5 business days

**Where:** [business.facebook.com](https://business.facebook.com) → Business
settings → Security Centre → Start verification.

**What you need:**
- A Business Portfolio (create one if you don't have it) with your legal
  company name exactly as registered.
- Your Jordanian commercial registration (سجل تجاري). If it is not in a
  language Meta supports, you need an English translation carrying an official
  stamp from a recognised translation agency — **order this today**, it is the
  step most likely to add days.
- A company email on your own domain, and a phone number that can receive a code.
- Consistency matters: the name, address and phone on the form should match the
  registration document exactly. Mismatches are the usual rejection reason.

**Note:** because you build on behalf of other businesses rather than for your
own assets, Meta may classify you as a **Tech Provider** during verification.
That is a designation inside verification, not a separate application.

## 2. The Instagram app — configuration

**Where:** [developers.facebook.com](https://developers.facebook.com) → your app.

1. **Products → Instagram → API setup with Instagram login.**
   This is the path this codebase uses. It does not require your clients to have
   a Facebook Page linked, which is why it was chosen.
2. Copy the **Instagram app ID** and **Instagram app secret** into Netlify as
   `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`. These are *not* the same as
   `META_APP_ID` / `META_APP_SECRET`, which belong to the Facebook Login path
   still used for Facebook Pages.
3. **Business login settings** → add the redirect URI, exactly:
   `https://YOUR-SITE/api/oauth-instagram-callback`
4. **Permissions:** request `instagram_business_basic` and
   `instagram_business_manage_insights`. Nothing else. Both are read-only.
   Do **not** add `instagram_business_content_publish`, `pages_*`, or
   `business_management` — the app never uses them and each one makes review
   harder and a token leak worse.
5. **App settings → Advanced → Security → Require App Secret: ON.**
   Every Graph call this codebase makes is already signed with `appsecret_proof`.
6. **App settings → Basic**, set:
   - Privacy Policy URL: `https://YOUR-SITE/privacy`
   - Terms of Service URL: `https://YOUR-SITE/terms`
   - User Data Deletion: choose **Data deletion callback URL** and set
     `https://YOUR-SITE/api/meta-data-deletion`
   - Deauthorize callback URL: `https://YOUR-SITE/api/meta-deauthorize`

   All four are implemented and must be reachable before you submit.

## 3. If you also want Facebook Pages

Keep the existing Facebook Login app configuration, and add the redirect URI
`https://YOUR-SITE/api/oauth-meta-callback`. Request only `pages_show_list`,
`pages_read_engagement`, `read_insights`, `instagram_basic`,
`instagram_manage_insights`. This path is retained and works, but Instagram
accounts should be connected through section 2.

## 4. App Review

**Where:** App dashboard → App Review → Permissions and Features.

Request Advanced Access for each permission in section 2.4. For each you provide
a use-case description and a **screencast** of the real flow: a user signing in,
connecting an Instagram account, and seeing their own data.

**You cannot record that screencast today** — it would show a dashboard of zeros
because nothing has been connected yet. Deploy, connect your own Instagram
account, confirm real numbers appear, then record. This is why the technical
work and the review submission are sequenced the way they are.

While review is pending, you can still connect real accounts belonging to people
with a **role on the app** (Roles → add as Tester; they accept the invitation).
That is a legitimate route for one to three pilot clients — it carries the
friction of a role invitation, so it does not scale to a roster.

## 5. Data Use Checkup and Data Protection Assessment

- **Data Use Checkup** — an annual recertification that your use of each
  permission still matches what you declared. Expect a prompt in the dashboard.
- **Data Protection Assessment** — triggered because you store platform data on
  your own servers. It asks directly about encryption at rest, access logging,
  deletion, retention, and onward transfer to third parties. This codebase now
  answers the first four; the transfer question needs your sub-processor list
  (Supabase, Netlify, Anthropic) and the Jordan cross-border position.

## 6. Order of operations

1. **Today:** start Business Verification; order the translation if needed.
2. **In parallel:** configure the app (section 2), apply migrations `0001`–`0005`,
   set the secrets, deploy.
3. **Then:** connect your own Instagram account and reconcile a week of numbers
   against the Instagram app's own insights.
4. **Then:** record the screencast and submit for App Review.
5. **Meanwhile:** run pilot clients through Tester roles.

## 7. What each thing gates

| Step | Blocks what |
|---|---|
| Business Verification | Advanced Access, and therefore any non-tester account |
| App Review | Connecting accounts that have no role on your app |
| Data Protection Assessment | Continued access once you hold platform data at scale |
| Tester roles | Nothing — available immediately, for a handful of pilots |
