# Setting up the Meta side

The administrative path from nothing to "a client can connect". Most of the
elapsed time here is Meta reviewing things, so **start section 1 today** — it
runs in parallel with everything else and nobody can shortcut it.

You do **not** need to be a *Meta Business Partner*. That is a marketing
programme (badge, directory listing, priority support) gated on ad spend and
client volume. It has nothing to do with API access.

---

## 1. Business Verification — start first

**Timeline: 10 minutes to 14 working days.** It can be near-instant when
everything matches; plan for two weeks. This blocks Advanced Access, so nothing
you do in code shortens it.

### Phase 0 — Prepare before you open the form

Most rejections are decided here, not by Meta. The single most common rejection
in 2026 is a **legal-name mismatch**: Meta compares the name in your business
account against the name on your document and wants an *exact* match, not
"close enough" — including suffixes, punctuation and word order.

Gather:

- [ ] **Commercial registration** (السجل التجاري) from the Ministry of Industry,
      Trade and Supply, and/or your **certificate of registration** (شهادة تسجيل).
      It must carry an official **stamp or seal** — Meta will not accept a
      document without one.
- [ ] A **second corroborating document** showing the *same* legal name and the
      *same* address: a business bank statement or a utility bill. Submitting two
      documents that agree with each other is the single best thing you can do
      for approval odds.
- [ ] A **certified English translation** with a recognised translation agency's
      stamp, unless your documents are already in a language Meta supports.
      Order this now — it is the step most likely to add days.
- [ ] A **business phone number** that can receive a call or SMS.
- [ ] A **business email on your own domain** (not gmail).
- [ ] A **live website on that domain.** Meta looks for a real, working web
      presence, so deploy first — the privacy and terms pages built into this
      app help here.

Document freshness rules:
- Registration certificates: no more than **1 year** old.
- Utility bills and bank statements: no more than **90 days** old.

Scan quality: full page, all four edges visible, no glare, no cropping. A clean
PDF scan beats a phone photo. "File is not viewable" is a rejection reason.

### Phase 1 — Set the business details up correctly

1. Go to [business.facebook.com](https://business.facebook.com).
2. Create a **Business Portfolio** if you do not have one, or open the existing one.
3. **Business settings → Business info.** Fill in, copying **character for
   character from your registration document**:
   - Legal business name
   - Registered address
   - Phone number
   - Website
4. Cross-check every field against the document before continuing. If the
   document says `Company for Trading and Services L.L.C.`, that exact string
   goes in the name field — not a shortened trading name.

### Phase 2 — Run the verification

1. **Business settings → Security Centre → Start verification.**
2. Confirm the organisation details you entered in Phase 1.
3. Choose a **contact method** to receive a confirmation code (phone or email on
   your domain).
4. **Upload your documents** — the registration plus the corroborating one.
5. **Enter the confirmation code** you receive.
6. Click **Done**.

### Phase 3 — After submitting

- Status arrives by email and as a notification in Business Manager.
- Do **not** edit the business name or address while review is pending; a change
  mid-review is treated as a mismatch.
- Meanwhile, continue with §2 onward — app configuration, deployment and the
  reconciliation all proceed in parallel.

### Phase 4 — If it is rejected

Meta names the reason. Map it:

| Reason given | Fix |
|---|---|
| Legal name does not match | Copy the name from the document exactly into Business info, then resubmit |
| Address missing or does not match | Use the registered address, not the trading address, and make both documents agree |
| Phone number missing or does not match | The number in Business info must also appear on a submitted document |
| Document expired | Registration under 1 year; utility/bank under 90 days |
| Document not supported / self-created | Must be government or bank issued, with a stamp or seal |
| Language not supported | Add the stamped certified English translation |
| File not viewable | Rescan: full page, higher resolution, no glare |
| Additional documents required | Send the second corroborating document |

Resubmission is allowed. Fix the named reason rather than resubmitting the same
pack, and change one thing at a time so you learn what mattered.

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
