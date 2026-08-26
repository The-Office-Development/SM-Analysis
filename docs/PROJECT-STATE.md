# Project state — the business model, the decisions, and what is left

The living record. `CLAUDE.md` is the technical brief; this is the commercial
and strategic one. Update it when a decision changes.

Last updated: 2026-08-26.

---

## 0. Start here — current position

The rest of this file is context. This section is what to do next. **Keep it
current; it is the first thing a new session should read after `CLAUDE.md`.**

### The company

| | |
|---|---|
| Legal entity | **Alhujra Technology LLC** — *spelling UNCONFIRMED* |
| Brand / product | The Office · PulseBoard |
| Website | `theoffice.it.com` |
| Bank account | None yet |
| Jurisdiction | Jordan (UTC+3, no DST) |

**The legal name must be transcribed character for character from the commercial
registration before anything is submitted to Meta.** A name mismatch is the most
common verification rejection, and `LLC` vs `L.L.C.` is enough to fail it. Until
someone confirms it from the document, treat the name above as a guess and do not
paste it into a Meta form or into the legal pages.

Two consequences already identified:

- The legal pages still carry `[REGISTERED COMPANY NAME]` and
  `[REGISTERED ADDRESS, JORDAN]` placeholders. Filling them puts the entity name
  on our own domain, which is exactly the corroboration Meta's reviewer wants.
- `theoffice.it.com` is a subdomain resold by the it.com registrar, not a
  registrable domain we own. That may complicate Meta domain verification and a
  business email on our own domain. A proper `.com` or `.jo` for Alhujra is cheap
  insurance before submitting.
- No bank account means the corroborating second document must be a tax
  registration certificate, a chamber of commerce certificate, a utility bill for
  the registered premises, or a second official registry document.

### Immediate next action

1. **Blocked on a human:** transcribe the legal name and registered address from
   the commercial registration, exactly as printed, and confirm it carries an
   official stamp or seal.
2. Then: fill the legal page placeholders, deploy, and submit Business
   Verification (`SETUP-META.md` §1).
3. Then: connect our own Instagram, sync for 3+ days, and run
   `node verify/reconcile.mjs`. **No client sees the product until those numbers
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
  limits and is worth doing before the Meta endpoint verification.

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

**The software.** On `main`, all green: typecheck, build, 40 tests, mutation
score 18/18. A pre-launch audit found 24 P0 findings; 19 are fixed, 1 mitigated,
4 partly done or organisational. Detail in `REMEDIATION-STATUS.md`.

**Never run against the live API.** Every test uses a mock built on Meta's
*documented* conventions. `developers.facebook.com` has been unreachable from
every session so far, so the Instagram Login endpoints in
`netlify/functions/_instagram.ts` are assembled from secondary sources. **This is
the single largest open risk**, and only a real connection settles it.

**Nothing is deployed.** Migrations unapplied, secrets unset (the code fails
closed without them), Meta app not configured.

**Nothing is verified.** No account has ever connected; no number has been
reconciled against Instagram's own insights.

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
- [ ] **Instagram `online_followers` hour keys** — account-local or a fixed
      platform timezone? Unresolved; the Planner labels rather than implies.
      Highest-value single verification left.
- [ ] Verify every endpoint in the `IG` block of `_instagram.ts` against the
      official docs and one live response.

### Organisational, needs people not code
- [ ] DPO question under Jordan's PDPL
- [ ] Cross-border transfer file (Supabase, Netlify, Anthropic all outside Jordan)
- [ ] Supabase and Netlify region choice, recorded with a reason
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
