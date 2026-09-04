# Project state — the business model, the decisions, and what is left

The living record. `CLAUDE.md` is the technical brief; this is the commercial
and strategic one. Update it when a decision changes.

Last updated: 2026-09-04 (first live API call; day-boundary fix; deploy pipeline reconnected).

---

## 0. Start here — current position

The rest of this file is context. This section is what to do next. **Keep it
current; it is the first thing a new session should read after `CLAUDE.md`.**

### The company

| | |
|---|---|
| Legal entity (Arabic) | **شركة الحجرة لتقنية المعلومات /ذات مسؤولية محدودة** |
| Legal entity (English) | **Al-Hujra Information Technology Company / Limited Liability** |
| Commercial registration | 83622 · national establishment no. 200214930 |
| Registered | 30 July 2026, Companies Control Department, status `قائمة` (active) |
| Registered address | **Amman only** — no street address on the registration |
| Certified translation | Abu-Ghazaleh (AGATO), stamped 19 Aug 2026 — settles the English name |
| Officers | Malek Ahmed Hassan Ismaeil (Chairman) · Bader Rami Saleh Alhaj Hamad (Vice-Chairman) |
| Registered objectives | 620101 website design · 620102 computer programming · 620301 business applications and software · 620902 website management |
| Brand / product | The Office · PulseBoard |
| Website | `theoffice.it.com` |
| Bank account | None yet |
| Jurisdiction | Jordan (UTC+3, no DST) |

Confirmed 2026-08-26 from the registration PDF's text layer (not OCR); the name
string is identical on both pages. The earlier guess `Alhujra Technology LLC` was
wrong on two counts and must not be reused: the registration reads *Information*
Technology (`لتقنية المعلومات`), and **no English name appears on the document at
all**.

**The English name is settled.** The certified translation (Abu-Ghazaleh / AGATO,
19 Aug 2026) of registration 83622 renders it
**`Al-Hujra Information Technology Company / Limited Liability`**. Note the string
ends at *Limited Liability*, not *Limited Liability Company*. Meta compares this
against the document character for character, so it must be used verbatim
everywhere and never varied — it is now in `src/pages/Legal.tsx` and the app footer.

**It was never the blocker this file recorded, though, and that correction must
survive.** The note here long claimed "Meta's Business info field needs Latin
script", which was an assumption written down as fact. Meta publishes its
supported document languages and **Arabic is on the list**; a certified
translation is required only for documents in an *unsupported* language. So the
registration could always have been submitted as issued, and a future session
must not re-derive a translator as a blocker on a Jordanian document.

The translation is still worth having — it is what fills the legal pages and lets
a non-Arabic reader connect brand to entity — and now that it exists, use it. But
had it been slow, submission should not have waited on it.

The registered objectives are a gift for App Review: website design, computer
programming, business applications and software, and website management services.
They corroborate that the entity and the product belong together, which a reviewer
otherwise has to take on trust.

Further consequences identified:

- ~~The legal pages carry name and address placeholders.~~ **Done 2026-08-28.**
  `OPERATOR`, `ADDRESS` and a registration line are filled from the certified
  translation. What remains bracketed waits on counsel, not on the translation.
- ~~The site must state the link between brand and entity.~~ **Done.** The app
  footer names the entity, Amman and registration 83622 beneath the legal links,
  and the public legal pages carry the Arabic legal name with the registration
  number. A reviewer holding an Arabic document and reading an English page can
  now join the two without knowing Arabic.
- **The registration has no street address**, and it is now the only genuinely
  missing item in the verification pack. The second document has a specific job:
  carry a real one. A utility bill is the right instrument and, with no bank
  account, the only one available — but Meta accepts a utility bill for **address
  and phone only**, and requires the **legal business name to appear on it**. So
  it must be a bill in the company's name; a partner's personal bill will not do.
  The registration stays the document that proves the name.
- **The registration carries no stamp or seal, deliberately** — its own footer
  says `صدرت الوثيقة الكترونيا ... ولا تحتاج الى توقيع او ختم`, with a QR code for
  verification. `SETUP-META.md` §1 says Meta rejects unstamped documents; that is
  inherited secondary-source guidance and it conflicts with how Jordan issues this
  document. Submit as is; if rejected as "document not supported", request a
  stamped paper copy rather than resubmitting the same PDF.
- **Signature authority is joint** (`مجتمعين`) — Chairman and Vice-Chairman
  together. Relevant if any Meta step wants an authorised representative.
- **Registered activities help App Review:** 620101 website design, 620102
  software development, 620301 business applications, 620902 website management.
  The entity's registered purpose matches what the product does.
- `theoffice.it.com` **is fine after all.** Verified 2026-08-26: it delegates to
  its own nameservers, so DNS TXT records for Meta domain verification can be
  added, and Zoho MX/SPF are already live, so business email on the domain exists.
  The earlier worry that a resold `it.com` subdomain would block both was wrong.
  Point `app.theoffice.it.com` at Netlify and keep the marketing site where it is.

### The plan — direct Meta, Tester-role pilot

**Decided 2026-08-28, superseding the two-track proposal.** The data source is
**Meta directly**, through our own app and our own OAuth. The vendor route is
deferred, not discarded; the research stands in `VENDOR-OPTIONS.md`.

Three things decided it:

1. **App Review was never the blocker for client one.** Tester roles read real
   data today (§3). The vendor buys scale we do not need this week.
2. **The vendor puts someone else's name on the consent screen.** The client
   authorises *Metricool*, not us. That reintroduces precisely the discovery risk
   that got resale rejected in §2, at the moment of connection. The operator's
   stated preference is that this not be a thing.
3. **It is slower.** The vendor path waits on three companies answering a terms
   question in writing, then a subscription, then building the provider to the
   §7 contract. One to three weeks. The direct path is about five days.

The client needs one main Instagram account connected plus some test accounts,
which Tester roles handle comfortably.

**Revisit the vendor when** Tester invitations become the bottleneck — roughly
client three or four — by which point App Review may have landed anyway. Keep the
provider seam in `_sync.ts` clean so that stays a config change.

**Test accounts cannot validate numbers.** They must be Business or Creator
accounts to expose insights at all, and below ~100 followers the demographics come
back empty. A fresh account has no settled history to compare, so the
reconciliation gate runs against **our own real account**; test accounts exercise
the connect flow and the UI only. Reconciling against an account that cannot fail
the check is the same mistake as citing the old `verify/*.mjs` printers.

### Immediate next action

**Updated 2026-09-04, end of day.** Deployed, connected, and the plumbing is
proven. The gate is not.

1. **Connect an account with real posts.** `@heath_ens21` has zero media, so
   every metric is legitimately zero and nothing can be reconciled. A friend's
   account is the intended route: invite it as an **Instagram Tester**, they
   accept from their own Instagram settings, and they authorise **on their own
   device** — never on ours, because asking a creator to type their Instagram
   password on someone else's machine is a reasonable thing to refuse.
2. **Run the gate.** `verify/reconcile.mjs`, comparing settled days against the
   Instagram app with the account holder reading the numbers back.
3. **Settle the day boundary.** `verify/probe-live.mjs` prints the derived
   offset. Two accounts have now reported `-7`; a third from Jordan reporting
   `+3` would mean the boundary follows the account, and `-7` again would mean it
   is fixed platform-side and the dashboard must say so. `API-VERIFICATION.md` §6.2.
4. **Then drinkat**, via the provisioned-workspace pattern in §3.

### Superseded next actions (kept for the record)

1. **Deploy.** Apply migrations, set secrets, configure the Meta app, ship it.
   Nothing else moves until the app is reachable. `DEPLOY-RUNBOOK.md` §3–§5.
   The follower-reconstruction bug (4 failing tests) lands first — the
   reconciliation in step 5 compares follower numbers.
2. **Blocked on a human:** obtain a **utility bill in the company's name showing
   a street address** — this is now the only genuinely missing item in the
   verification pack. The certified translation is *not* needed to submit
   (corrected 2026-09-03); order it in parallel for the legal pages and footer,
   and ask CCD first whether an English extract exists on file.
3. Fill the legal page placeholders and the site footer, deploy, submit Business
   Verification (`SETUP-META.md` §1). Track B starts here and needs the website
   live first.
4. On a positive terms answer: subscribe, get an API token, and run the first-hour
   checklist in `VENDOR-OPTIONS.md` §6 before committing a client.
5. Either way: connect a real account, sync 3+ days, run
   `node verify/reconcile.mjs`. **No client sees the product until the numbers
   agree with the Instagram app.**

### Environment gotchas that keep recurring

- Sessions so far have run in a **remote Linux sandbox**, not on a local Mac,
  even when driven from the desktop app. Check with `uname -a`.
- `developers.facebook.com` and `developers.tiktok.com` are **blocked by the
  egress proxy** in that sandbox. Every platform API claim in this repo therefore
  rests on secondary sources and is flagged as needing human verification.
- That sandbox has **no OCR** (`pdftoppm`, `tesseract` absent), so scanned
  documents cannot be read. Ask the human to transcribe instead.
- Running Claude Code locally (`brew install poppler tesseract`) removes both
  limits. Sessions from 2026-08-26 have run locally on macOS with `pdftotext`
  available, which is how the registration was read.
- **Government PDFs carry a text layer — extract it, do not read the image.**
  The registration's text is stored as Arabic presentation forms
  (`U+FE70–FEFF`); `pdftotext -layout` plus Python `unicodedata.normalize("NFKC", …)`
  recovers the exact canonical string. That matters when a name has to match
  character for character.

> The registration PDF lists both partners' national ID numbers. Keep them out of
> this repository — **and out of the Meta upload too.** Meta's instruction is to
> cover personal information it does not need, naming the local equivalent of a
> social security number specifically. Black them out before uploading.

---

## 1. The model

Managed Instagram analytics for large Jordanian creator and agency accounts.

- **Price:** 50 JD/month per client after a free trial.
- **Client:** first client secured, providing test accounts for the trial.
- **Operator, software and clients:** all in Jordan (UTC+3, no DST).
- **Platform:** Instagram first. Facebook Pages and TikTok exist in the code but
  are not the offer.

### What the client is actually buying

This matters more than any technical decision in this repo, because it decides
whether the price survives contact with a client who can find a $20/month tool.

**Not** access to a dashboard. If the product is a login, the client's
comparison is 50 JD against Metricool's $20 and they are right to object.

**The offer is the work:** a monthly report we produce with commentary,
sponsor-ready figures for a media kit, an answer when they ask why reach moved,
and posting recommendations they can act on. The dashboard is how we do the job,
not the thing being sold. Tooling markup is invisible when it sits under a
service; it is indefensible when the service *is* the tool.

**Corollary:** if the interpretation layer is not actually delivered, 50 JD is
not defensible — and finishing our own software will not make it defensible
either, because a client on our dashboard can still find a cheaper tool.

---

## 2. Decisions taken

| Decision | Choice | Why |
|---|---|---|
| **Build or subscribe** | **Build.** No third-party resale. | Reselling opens a discovery risk that turns "where do I sign" into "why should I choose you". That conversation is never fully won back, and the first client becomes the reference in a small market. |
| **Instagram auth path** | **Instagram API with Instagram Login** | Needs no linked Facebook Page. On the Facebook Login path a creator without one **cannot connect at all** — a hard block, not friction. Smaller, entirely read-only permission set. Facebook Login retained for Pages. |
| **Web or native app** | **Web, delivered as a PWA** | A native app adds a second gatekeeper (Apple/Google review) to a project already gated by Meta. Web gives same-day fixes when Meta deprecates a metric, natural OAuth redirects, one codebase, no store fee. A PWA recovers the home-screen icon and push notifications without store review. Revisit native only if a client actually asks. |
| **Pilot delivery** | **Tester roles**, not App Review | Lets the first client use *our* software on real data within days. See §3. |
| **Data source** | **PROPOSED:** licence a vendor API for launch, keep direct Meta as the destination | The blocker was never our code, it is App Review. A licensed vendor has already passed it, so buying their API buys their approval. Not decided — gated on whether their terms permit billing clients for a product built on it. See `VENDOR-OPTIONS.md`. |
| **Scraping a vendor UI** | **Rejected** | Breaches vendor terms; termination takes every client dark at once. Both shortlisted vendors sell an official API for the same thing, so there is no reason to. |
| **Supabase region** | **Frankfurt `eu-central-1`** | Measured from Amman on 2026-09-03: Frankfurt 72ms TCP connect against Tokyo's 353ms — the signup default had landed the project in `ap-northeast-1`. Supabase has **no Middle East region**, so Frankfurt is the closest reachable. Moved while the project was still empty because **Supabase cannot change a project's region**; the only route is a new project plus a full data migration, which is free today and a downtime window once a client's history exists. |
| **Product domain** | **`app.theoffice.it.com`**, marketing site stays on the apex | Verified 2026-09-04: `it.com` delegates the whole zone to the registrar's nameservers, `www` already resolves to Vercel, and the authoritative server returns NXDOMAIN (not REFUSED) for new names — so subdomains are ours to create, free, no purchase. Chosen over a `netlify.app` subdomain because DNS domain-verification for Business Verification needs a TXT record, and because website, business email and legal entity agreeing on one domain is a stronger verification pack. **Revisit is deferred, but the cheap moment to move is BEFORE Business Verification** — Meta restarts the review when business details change, and existing `/r/<slug>` share links die with the old domain since they have no expiry or revocation. |
| **Scopes** | `instagram_business_basic`, `instagram_business_manage_insights` only | Both read-only. `business_management` was dropped: it is write-capable, unused, and turns a token leak from data exposure into asset compromise. |

### Rejected, and why it is recorded

**Subscribing to Metricool (~$20/mo for 5 brands) and reselling at 50 JD.**
Economically strong — the first client would have cost nothing on the free tier,
and margin stays above 90%. Rejected on strategy: the discovery risk is real,
one search wide, and does not disappear when our own product ships. Kept here
because it remains the correct fallback if the deadline becomes existential.

---

## 3. The tester route — what it is and what it is not

In Development Mode the app can read data for anyone holding an **app role**
(Administrator, Developer, Tester). That data is real: the sync genuinely works.

**Use it for:** the pilot. The client's account is added as a Tester, they accept
the invitation from their own Instagram settings, and they use our software with
their real numbers — no App Review, no third party.

**Do not use it as the business.** Three reasons:

1. Every client must be added manually and accept an invitation. Fine for three,
   unworkable at twenty, and it looks like a workshop rather than a product.
2. Development Mode exists to build and test before review. Running a paying
   client base on it is operating out of a test facility.
3. If the app is restricted for policy violation, **every client goes dark at
   once**. That is a bigger blast radius than anything else we have accepted.

App Review remains the path to client two onward.

---

## 4. Where it stands

**The software.** On `main`, all green: typecheck, build, 65 tests, mutation
score 24/24. A pre-launch audit found 24 P0 findings; 19 are fixed, 1 mitigated,
4 partly done or organisational. Detail in `REMEDIATION-STATUS.md`.

**Deployed and connected — 2026-09-04.** `app.theoffice.it.com` serves the app
and its functions from a Frankfurt Supabase project with migrations `0001`–`0008`
applied. `@heath_ens21` authorised through PulseBoard's own OAuth flow, which is
the first time the token exchange has ever run against Meta. The live probe
reports **11 of 11**: every endpoint, scope and field name in the `IG` block is
correct.

**Not one number has been validated.** That account has 101 followers and **zero
posts**, so every metric is correctly zero and the reconciliation gate has had
nothing to check. This is the single remaining technical risk, and it is the same
one `CLAUDE.md` §2 names: a wrong number is worse than an outage. **The next
milestone is connecting an account with real history** — a friend's account is
the intended route, then drinkat's.

---

## 5. What is left

### Blocking — start today
- [ ] **Business Verification** — 10 minutes to 14 working days. Order the
      stamped English translation of the commercial registration now if needed,
      and deploy first so the website exists. Step-by-step in `SETUP-META.md` §1.

### Blocking — technical, about a day of work
- [ ] Apply `schema.sql` then migrations `0001`–`0005` in order; add `pulseboard`
      to Exposed schemas
- [ ] Generate and set `TOKEN_ENC_KEY` and `OAUTH_STATE_SECRET`; scope all
      Netlify env vars to the Production context
- [ ] Configure the Meta app: Instagram Login product, redirect URI, the two
      scopes, Require App Secret, and all four URLs (privacy, terms, deletion
      callback, deauthorize callback)
- [ ] Deploy and confirm the public pages and the deletion-status endpoint

### Blocking — the gate that matters
- [ ] Connect our own Instagram account; let it sync **at least three days**
- [ ] `node verify/reconcile.mjs --account <id>` and compare settled days against
      the Instagram app. **No client sees this product until the numbers agree.**

### Then
- [ ] Add the client's account as a Tester; begin the trial on our software
- [ ] Record the App Review screencast (impossible before real data exists) and
      submit, with the Data Use Checkup and Data Protection Assessment
- [ ] PWA polish: manifest, icons, installability

### Open questions
- [x] ~~**Instagram `online_followers` hour keys**~~ — closed 2026-08-26, and not
      the way it was asked: the metric is no longer requestable at all, so the
      timezone question is moot. What the Planner should recommend instead is now
      a product question. `API-VERIFICATION.md` §2.
- [x] ~~Verify every endpoint in the `IG` block of `_instagram.ts` against the
      official docs~~ — done 2026-08-26; three of four daily metrics were wrong
      and are fixed. **Against one live response: still open**, and that is the
      reconciliation gate above, not a separate task.
- [ ] **The day boundary — now the highest-value open question.** First live
      call (2026-09-04) returned `end_time` of `07:00:00+0000`: midnight US
      Pacific, not Amman. Days on that account run 10:00-10:00 Amman time.
      Whether the boundary follows the account's own timezone setting or is fixed
      platform-side decides whether this is a non-issue or a labelling
      requirement. Settle it by running `verify/probe-live.mjs` against an
      account set to Amman. `API-VERIFICATION.md` §6.2.
- [ ] **`online_followers` is back** — it answered a live call, so the Planner
      can have real data behind its best-time-to-post advice after all, and the
      hour-key timezone question is re-opened. Undocumented but working, so it
      needs a fallback rather than a hard dependency. `API-VERIFICATION.md` §6.1.
- [ ] **`follower_count` is back too**, and may replace the reconstructed
      follower line — the most visible number in a media kit. Same caveat.
- [ ] **Reels average watch time** — `avg_watch_seconds` is hard-coded `null`, so
      the Content table shows `—` for every row, but `ig_reels_avg_watch_time`
      exists at the media level (`API-VERIFICATION.md` §3.6). It is Reels-only,
      so it needs its own call rather than joining `MEDIA_INSIGHT_METRICS`, where
      a metric the media type does not support fails the whole query (§3.3).

### Organisational, needs people not code
- [ ] DPO question under Jordan's PDPL
- [ ] Cross-border transfer file (Supabase, Netlify, Anthropic all outside Jordan)
- [x] ~~Supabase region choice~~ — **decided 2026-09-03: `eu-central-1`
      (Frankfurt).** Reason recorded in §2. Netlify's function region is still
      open and matters less; its default `us-east-1` is ~90ms from Frankfurt.
- [ ] Alerting and an on-call rota — the 24-hour PDPL breach deadline is
      unmeetable without someone watching
- [ ] Counsel sign-off on the PDPL analysis and the bracketed legal pages

### Deferred
- [ ] Share-link expiry and revocation
- [ ] Retention purge job
- [ ] Queue-backed sync (the hourly cron is fine to a few hundred accounts)
- [ ] Remaining optimistic claims in `src/lib/setupGuides.ts`

---

## 6. Standing risks

| Risk | Status |
|---|---|
| Numbers silently wrong | **Live.** Unvalidated against any real response. Reconciliation is the mitigation and it has not been run. |
| Meta deprecates a metric or version | **Permanent.** Versions expire roughly every two years, metrics are removed between them. Needs a funded recurring watch, not a one-off migration. This is what caused most of the audit findings. |
| Client discovers cheaper tooling | **Mitigated by positioning**, not by secrecy — we sell the work, not the seat. |
| App restricted by Meta | **Reduced** (read-only scopes, no `business_management`, callbacks implemented) but never zero. All clients share one app. |
| Deadline pressure ships unverified numbers | **The one to watch.** A wrong number in a sponsor report costs the client relationship permanently; a late launch does not. |
| Vendor dependency (if Track A proceeds) | **Accepted, bounded.** Mitigated by building the vendor as a swappable provider and by Track B continuing in parallel. Metricool is EU-based with corporate backing, so vanishing-vendor risk is low. |
| Vendor terms forbid billing clients | **Open.** The gate on Track A. If all three refuse, fall back to Track B plus a tester-role pilot. |

---

## 7. Related documents

| File | Contents |
|---|---|
| `CLAUDE.md` | Technical brief and the invariants not to break |
| `DEPLOY-RUNBOOK.md` | Zero to a pilot client, in order |
| `SETUP-META.md` | The administrative path: verification, app config, review |
| `COMPLETE-AUDIT.md` | Every audit finding in one file, plus corrections |
| `REMEDIATION-STATUS.md` | Each P0 mapped to what was done |
| `DATA-INTEGRITY.md` | The proven metric defects, with runnable proofs |
| `JORDAN-CONTEXT.md` | What operating from Jordan changes |
| `VENDOR-OPTIONS.md` | Data-source comparison, ban-risk analysis, the open terms question |
| `TRANSLATOR-BRIEF.md` | The written brief that fixes the English legal name |
| `CLIENT-MESSAGE.md` | What to ask the client for, English and Arabic |
