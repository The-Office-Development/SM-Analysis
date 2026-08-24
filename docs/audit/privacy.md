# PulseBoard — Privacy, Data-Protection & Contractual Readiness Audit
**Primary legal frame: Jordan Personal Data Protection Law No. 24 of 2023 (PDPL)**
Repo: /home/user/SM-Analysis · branch `claude/analysis-35bck4` · Audit date 2026-08-23

> This is an engineering/compliance readiness review, **not legal advice**. Every point marked
> **[COUNSEL]** must be confirmed by a Jordanian-qualified lawyer before it is relied on.
> English-language primary sources for Jordanian law are thin; where I rely on secondary
> summaries (law-firm client alerts, IAPP/DataGuidance) I say so explicitly.

Severity: **P0** blocks launch · **P1** before real clients · **P2** before scale · **P3** hardening
Confidence: **CONFIRMED** (read in code / primary source) · **LIKELY** · **UNVERIFIED**

---

## 0. Sourcing note and method (read this first)

**Primary-source access failed.** The official English text of Law No. 24 of 2023 is published by
the Ministry of Digital Economy and Entrepreneurship at
`https://www.modee.gov.jo/ebv4.0/root_storage/en/eb_list_page/pdpl.pdf` — this audit environment's
egress proxy blocks that host (and `dlapiperdataprotection.com`, `securiti.ai`), so **every
article-level statement below is drawn from secondary English summaries** (law-firm alerts, Clyde &
Co, Digital Watch Observatory, IBA, Jordanian firms Karajah / Jaradat / Nsair, and privacy vendors).
Arabic is the authoritative language of the law; English translations diverge on terminology
("Council" vs "Unit", "Data Protection Officer" vs "Data Protection Supervisor").

**Consequence for this report:** article numbers are cited as *reported by* the sources named, marked
**LIKELY** rather than CONFIRMED. Before any of this is put in front of a client's advisers, a
Jordanian-qualified lawyer must (a) read the Arabic text, (b) confirm the article numbering, (c)
confirm the current status of implementing regulations/instructions issued by the Data Protection
Council, which change the operational duties (registration forms, breach-notice channel, DPO
notification) more than the statute does. Everything marked **[COUNSEL]** is such an item.

Code claims, by contrast, are CONFIRMED — I read the files at the cited lines.

---

## 1. DATA INVENTORY / RECORD OF PROCESSING (built from schema + sync code)

**Confidence: CONFIRMED** (read from `supabase/schema.sql` and `netlify/functions/_sync.ts`).

### 1.1 Category A — PulseBoard's own users (the clients: influencers, agency staff)

| Data | Where | Source |
|---|---|---|
| Email, password hash, auth metadata, last sign-in, IP-adjacent auth logs | `auth.users` (Supabase-managed; PulseBoard adds no triggers, `schema.sql:6`) | Supabase Auth |
| `user_id` linkage to every other table | `social_accounts.user_id`, `goals.user_id`, `report_shares.user_id` | app |
| Growth targets and due dates (business-sensitive, not special category) | `goals` (`schema.sql:129-137`) | user input |

### 1.2 Category B — the client's connected social identities

| Data | Where |
|---|---|
| Platform, external account ID, `username`, `display_name`, `avatar_url`, status, connect/sync timestamps | `social_accounts` (`schema.sql:31-43`) |
| **OAuth access token, refresh token, expiry, `extra` jsonb (page_id, scope)** | `account_secrets` (`schema.sql:51-58`) — Page tokens, IG Business tokens, TikTok tokens |
| Daily followers / reach / impressions / views / engagements | `metrics_daily` (`schema.sql:69-79`) |

`account_secrets` has **no RLS policy at all** (`schema.sql:59-60`) — correct design, service-role only.
But note `schema.sql:25-28` and `166-167` grant `all on all tables in schema pulseboard to anon,
authenticated` — RLS is the only thing standing between the anon key and the token table. That is
by design in Postgres, but it means a single future `create policy ... using (true)` mistake, or any
code path that runs as `authenticated` with RLS disabled, exposes live platform credentials for
large creator accounts. **P1 / CONFIRMED:** revoke table-level grants on `account_secrets`
explicitly (`revoke all on pulseboard.account_secrets from anon, authenticated;`) so RLS is not the
sole control (defence in depth), and add a schema test asserting it.

### 1.3 Category C — the clients' POSTS (personal data of the client, and of third parties named in them)

`content` (`schema.sql:86-104`) stores per post: `title`, `media_type`, `permalink`,
`published_at`, views/likes/comments/shares/saves/reach, watch seconds, retention.

`title` is **not** a title. It is the verbatim post body, truncated to 120 characters:
- Instagram: `title: (m.caption ?? "Instagram post").slice(0, 120)` — `_sync.ts:98`
- Facebook: `title: (m.message ?? "Facebook post").slice(0, 120)` — `_sync.ts:172`
- TikTok: `title: (v.title || "TikTok video").slice(0, 120)` — `_sync.ts:243`

Captions routinely contain third-party personal data: @-mentions of real people, client and brand
names under NDA, location, and free text about identifiable individuals. PulseBoard is storing that
text outside Jordan (§2) and re-transmitting it to Anthropic (§5) and to anonymous share-link
visitors (§8). Nothing in the product tells anyone this happens.

### 1.4 Category D — the clients' FOLLOWERS (third parties with no relationship to PulseBoard)

`audience_snapshots` (`schema.sql:111-122`): `age`, `gender`, `countries`, `devices`, `active_hours`
— one row per account per day, kept forever.

Written from:
- Instagram `follower_demographics` broken down by **age**, **gender**, **country** — `_sync.ts:141-144`
- Instagram `online_followers` → a 7×24 weekday-hour activity grid — `_sync.ts:145-146`, bucketed at `_sync.ts:352-361`
- Facebook `page_fans_gender_age`, `page_fans_country`, `page_fans_online` — `_sync.ts:207`

**These are aggregate proportions, not individual records.** `toShares()` (`_sync.ts:365-371`)
divides every bucket by the total, so what is persisted is e.g. `{"25-34": 0.31}` and
`{"Jordan": 0.44, "United States": 0.12}` — no follower is individually identifiable in the stored
row, and PulseBoard never receives follower IDs.

That materially lowers the risk but does **not** put it outside the law, for three reasons:
1. **Re-identification at small n.** A Page with 40 followers yields buckets that resolve to
   individuals; `hasAudience()` (`_sync.ts:391`) applies no minimum-cohort threshold, and neither
   Meta's k-anonymity thresholds nor PulseBoard's code guarantee one at every breakdown.
   **P2 / LIKELY:** enforce a floor (drop the snapshot if the account's follower count is below a
   documented threshold, e.g. 1,000) and record the threshold in the privacy policy.
2. **Combination.** age × gender × country × hour-of-activity, snapshotted daily and retained
   indefinitely, is a longitudinal behavioural dataset about a defined group of real people. Under
   Meta's own terms this is derived platform data with its own restrictions (§9).
3. **`gender`** is a special/sensitive category in several of the regimes the follower base may sit
   under, and Jordan's PDPL treats an enumerated set of "sensitive data" categories with a stricter
   consent standard. **[COUNSEL]** must confirm whether gender falls inside Jordan's enumerated
   sensitive-data list; the widely reported list centres on health, genetic/biometric, race,
   religion, political opinion, criminal record, and financial data.

**Roles for Category D are the hard problem — see §4.**

### 1.5 Category E — derived/exported artefacts

| Artefact | Contains | Where it goes |
|---|---|---|
| AI prompt (`summarizeForAI`, `analytics.ts:114-147`) | totals, trends, **5 verbatim captions truncated to 60 chars**, best-posting-window labels, up to 5 anomaly dates | Anthropic API (US) — §5 |
| Share payload (`buildSnapshot`, `snapshot.ts:27-70`; top-10 posts at `snapshot.ts:47-55`) | totals, per-platform follower/reach/views/engagement counts, **10 verbatim captions**, 3 best-window labels, 6 anomalies with dates | `report_shares.payload`, readable by anyone with the URL, forever — §8 |
| CSV export (`reports.ts:19-44`) | up to 200 posts with caption, type, publish date, and all engagement counts | the client's own device (no server copy) |
| Netlify function logs | see §2.2 — currently unbounded and unassessed |


---

## 2. PDPL SUBSTANCE — what Law No. 24 of 2023 actually requires of PulseBoard

**Status: in force 17 March 2024; grace period ended 17 March 2025; fully enforceable today**
([Digital Watch Observatory](https://v45.diplomacy.edu/resource/jordans-personal-data-protection-law-no-24-of-2023),
[Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law)).
There is no remaining runway; PulseBoard launches into a live regime.

### 2.1 Lawful basis — **consent is the default, and there is no "legitimate interests"**

This is the single most consequential difference from the GDPR and it reshapes the whole design.

- Art. 4(a): processing personal data is permitted **only with the data subject's prior consent**,
  unless a case permitted by law applies
  ([Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law),
  [DP-Technologies guide](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).
- Art. 6(a) exceptions are narrow and purpose-bound: public-entity statutory tasks, preventive
  medicine / healthcare by licensed practitioners, vital interests, law-enforcement and judicial
  requests, national security, and publicly available data
  ([DP-Technologies](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).
- **There is no general legitimate-interests basis.** "Legitimate interest" appears only as one
  condition inside the cross-border transfer article (Art. 14) — not as a ground to process
  ([DP-Technologies](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).

**Finding P0 / LIKELY — PulseBoard has no lawful basis for the follower demographics.**
For Category A/B/C (the client's own data) consent is obtainable: the client signs up and connects.
For **Category D — the followers' data** — PulseBoard cannot obtain consent, and no Art. 6(a)
exception fits. Under a GDPR-shaped design you would reach for legitimate interests; **that option
does not exist in Jordan**. Two routes out, both requiring counsel:
1. **Argue it is not personal data.** After `toShares()` (`_sync.ts:365-371`) what is stored is an
   aggregate distribution with no identifiers. This is the strongest argument and probably correct
   — but it depends on Jordan's definition of personal data and on there being a real
   minimum-cohort floor, which the code does not enforce (§1.4). **Build the floor, then the
   argument holds.** **[COUNSEL]**
2. **Argue "publicly available data"** for the parts Meta itself publishes. Weak: `follower_demographics`
   is permission-gated insight data, not public.
   *Do not rely on route 2.*
Action: (a) implement a documented minimum-cohort threshold before any snapshot is written;
(b) get a written counsel opinion that post-aggregation `audience_snapshots` rows are not personal
data under the PDPL; (c) if counsel will not give that opinion, the Audience feature must be
removed or restricted to accounts above the threshold.

**Finding P0 / CONFIRMED — captions are personal data with no basis at all.**
`content.title` holds up to 120 verbatim characters of the post body (`_sync.ts:98,172,243`). Where
a caption names or @-mentions a third party, PulseBoard processes *that person's* personal data with
neither their consent nor an exception. Unlike demographics this is not aggregated away.
Mitigations, in order of preference: (i) do not store caption text at all — store a hash plus the
permalink, and render captions client-side from a live API call; (ii) store it but strip `@handles`
and strings matching a mention pattern before persisting; (iii) keep it and treat the client as
controller for post content (§4), with the client contractually warranting it has rights to the
content and its subjects — this is the pragmatic route but it does **not** discharge PulseBoard's
own obligations as processor.

### 2.2 Consent quality

Consent must be **prior, explicit, documented (written or electronic), specific as to purpose and
period, and expressed in clear, plain, intelligible, non-misleading language**
([Signzy summary](https://www.signzy.com/regulation-glossary/personal-data-protection-law-24),
[Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law)).
It is withdrawable at any time.

**Finding P0 / CONFIRMED — there is no consent capture anywhere in the product.**
`grep` finds no consent, terms-acceptance, or privacy-notice component; sign-up is bare Supabase
Auth and the OAuth flow (`src/pages/Connections.tsx:37-46` `connect()`) sends the user straight to
the platform dialog with no PulseBoard-side notice. Specifically missing:
- a sign-up consent checkbox bound to a versioned Terms + Privacy Policy, with the version, the
  timestamp and the IP recorded in a `consents` table (does not exist);
- a **separate, unbundled consent for the AI assistant** — sending caption text to a third-country
  sub-processor is a distinct purpose and must not be buried in a general terms acceptance;
- a **separate consent for the cross-border transfer**, which Art. 14 requires to be given *after
  being informed that the destination does not provide an adequate level of protection* (§3);
- a "specified period" — consent must be time-bounded, which means the retention schedule (§7) is
  not optional garnish, it is part of the consent itself.

Build: `pulseboard.consents (user_id, kind, doc_version, granted_at, revoked_at, ip, user_agent)`
with one row per consent event, never updated in place. This table is also the evidence you produce
to the Unit and to a client's advisers.

### 2.3 Data subject rights

Reported rights: access and obtain a copy; correct/amend/update; erase; restrict processing to a
defined scope; withdraw consent at any time; and complain to the Unit
([Signzy](https://www.signzy.com/regulation-glossary/personal-data-protection-law-24),
[Securiti overview](https://securiti.ai/jordan-personal-data-protection-law-of-2023/)).

**Response deadline: UNVERIFIED.** I could not establish a statutory response period for Jordan from
any English source; the widely quoted "30 days" belongs to **Saudi Arabia's** PDPL, which is a
different law, and several search summaries conflate the two. **[COUNSEL] must confirm the Jordanian
deadline (statute and any Council instructions).** Engineering posture in the meantime: build to
**30 days maximum, target 7 working days**, and write 30 days into client contracts so you are
committing tighter than any plausible statutory figure.

Complaint handling is itself an obligation — the controller must "establish complaint handling
procedures" and give data subjects a clear mechanism to exercise rights
([Signzy](https://www.signzy.com/regulation-glossary/personal-data-protection-law-24)). Today there
is no in-product route to make any request; see §6.

### 2.4 The regulator

Oversight sits with the **Ministry of Digital Economy and Entrepreneurship (MoDEE)**; the law
establishes a **Data Protection Council** chaired by the Minister as the policy/supervisory body
setting national standards and issuing instructions and codes of practice, with an operational
**Unit** receiving complaints, investigating and enforcing
([Jaradat Law on the Council](https://jaradatlaw.com/the-data-protection-council-in-jordan-and-compliance-for-international-companies/),
[Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/)).

**Registration / notification duties: UNVERIFIED — and this is a launch-blocking unknown.**
English sources do not clearly state whether a private controller of PulseBoard's size must register
or notify the Unit, or whether a permit is needed. Note Art. 21 empowers the authority to *suspend or
revoke the entity's licence* ([IBA](https://www.ibanet.org/Jordans-technology-related-legal-framework)),
which implies a licensing/registration touchpoint exists for at least some entities.
**P0 / [COUNSEL]: establish before launch whether registration, notification, or a DPO filing is
required, and complete it.** Launching an unregistered data business that then suffers a breach is
the worst possible order of events.

### 2.5 Security obligations

Controllers must implement technical and organisational safeguards, conduct impact assessments, and
report breaches; a recipient of transferred data is subject to the same responsibilities as the
controller and must implement measures to secure the data **and mechanisms to detect and track
security breaches**
([Clyde & Co](https://www.clydeco.com/en/insights/2023/10/jordan-issues-first-personal-data-protection-law),
[Securiti solutions page](https://securiti.ai/solutions/jordan-personal-data-protection-law/)).

**Finding P0 / CONFIRMED — "mechanisms to detect and track security breaches" do not exist.**
There is no audit log table in `supabase/schema.sql`, no application-level access log, and no record
of who read what. `share.ts:18-29` serves any share payload to anyone with the slug and logs nothing.
`_lib.ts:24-32` mints a service-role client per invocation that bypasses RLS entirely, and every
sync, share read and OAuth save runs under it — so there is no per-actor attribution anywhere in the
system. **A breach cannot be scoped today**: you could not tell a client which of their posts,
captions or tokens were accessed, which is exactly the question a large account's advisers will ask
and exactly what the 24h/72h notices (§2.6) must contain. See §11.

**Finding P1 / CONFIRMED — no DPIA has been done.** Given permission-gated demographic data about
non-users, systematic daily monitoring of connected accounts, and transfer to three third countries,
a documented impact assessment is required and is also the artefact clients will ask for.

### 2.6 Breach notification — the tightest deadline in the law

- **Data subjects: within 24 hours** of discovering a breach that could cause serious harm, with
  details of the incident and the mitigations they should take.
- **The Unit: within 72 hours** of discovery, with the source of the breach, the affected data
  subjects, the mechanisms involved and other relevant details.
- Where the breach results from the controller's gross negligence or misconduct, the controller
  compensates those harmed.
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/); DLA Piper's Jordan
breach-notification page corroborates but was egress-blocked here.)

**24 hours to the data subject is harsher than the GDPR's 72-hour regulator-only clock.** For
PulseBoard the "data subjects" in a token-database breach are the clients *and* arguably every
person named in a stored caption — an unreachable population. That is another reason not to store
caption text (§2.1).

**Finding P0 / CONFIRMED — 24h is unmeetable with the current stack.** There is no on-call rotation,
no alerting, no log retention policy, no incident runbook, no contact list, and (above) no audit log
to determine scope. See §11 for the build.

### 2.7 DPO

A controller must appoint a DPO where its core activities involve processing personal data,
sensitive data, data of legally incapacitated persons, financial data, **or where it handles data to
be transferred outside Jordan**; the Council may mandate one in further cases
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/),
[Nsair & Partners](https://nsairs.com/2025/05/20/1257/)).

**Finding P0 / LIKELY — PulseBoard triggers the DPO requirement on the cross-border limb alone.**
100% of its data is transferred outside Jordan (§3). Appoint a named DPO, publish the contact point
in the privacy policy, and **[COUNSEL]** confirm whether the appointment must be notified to the
Unit and whether the role can be outsourced/part-time (common for a company this size, but confirm).

### 2.8 Penalties

- **Art. 21 (administrative):** after a prior warning — suspension or revocation of licence, or a
  fine up to **JOD 500 per day** while the violation continues, capped at **3% of the previous
  fiscal year's total revenue**. The Unit may also publish proven violations **at the violator's
  expense**.
- **Art. 22 (judicial):** court fine of **JOD 1,000–10,000**, **doubled for repeat offences**, and
  the court may order **destruction of the data or cancellation of the database**.
- Separate civil action for damages by the aggrieved party.
([IBA](https://www.ibanet.org/Jordans-technology-related-legal-framework),
[Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/))

For a startup the monetary figures are survivable; **licence suspension, publication of the violation
at your expense, and a court order to destroy the database are not** — the last would delete every
client's history. Frame this to management as an existential-continuity risk, not a fine risk.

---

## 3. CROSS-BORDER TRANSFER — the structural problem

### 3.1 What Art. 14 permits

Personal data must not be transferred to a recipient outside Jordan whose **level of protection is
lower than the PDPL requires**. The enumerated exceptions are: regional/international judicial
cooperation under treaties in force; cooperation with bodies combating crime; exchange of medical
data needed for treatment; exchange of data on epidemics/health crises/public health in Jordan;
banking operations and transfers of funds; and **the data subject's explicit consent to the
transfer, given after being informed that the destination does not provide an adequate level of
protection**
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/),
[DP-Technologies](https://www.dp-technologies.net/en/blog/data-protection-law-jordan)).
"Legitimate interest" is reported as a further condition inside Art. 14; its scope in the Arabic
text is unclear from English sources — **[COUNSEL]**.

**The decisive point: the PDPL does not currently anticipate standard contractual clauses or
equivalent safeguards as a transfer mechanism** ([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/)).
There is no adequacy list, no SCC template, no BCR route. An operator cannot paper over a transfer
the way it would under GDPR Art. 46.

**Therefore, for PulseBoard, essentially the entire cross-border posture rests on one leg:
informed, explicit, per-purpose consent from the data subject.** That has three engineering
consequences that must be designed for, not bolted on:

1. The consent notice must **name the destination and state that it does not provide protection
   equivalent to the PDPL**. A generic "we use cloud providers" line does not satisfy the wording.
2. Consent is **withdrawable at any time** (§2.3). Withdrawal of the transfer consent means the
   data can no longer sit in Supabase — i.e. withdrawal is functionally an account-deletion event.
   The product must treat "withdraw transfer consent" and "delete my account" as the same code path.
3. **Followers never consent.** Category D (§1.4) and third parties named in captions (§1.3) cannot
   consent to anything. If those are personal data, **there is no available transfer basis at all**
   and the only compliant answers are aggregation-below-identifiability (demographics) and
   not-storing (captions). This is the same conclusion as §2.1, reached independently — which is why
   it is the highest-conviction finding in this report.

### 3.2 Per-vendor analysis

| Vendor | What crosses the border | Region control | Transfer basis available | Contract needed |
|---|---|---|---|---|
| **Supabase** (Postgres, `auth.users`, **`account_secrets` OAuth tokens**, all metrics/content/audience/shares) | everything | Yes — region chosen at project creation, immutable afterwards; **no Middle East region exists** (no `me-central-1`; requested but unshipped) | client consent only | Supabase DPA (`supabase.com/legal/dpa`), signed and filed; sub-processor list captured and monitored |
| **Netlify** (static hosting, all `/api/*` functions, function logs, cron) | request metadata, OAuth `code`, **Supabase access tokens passed in a query string**, error strings that can contain caption text | Functions region selection exists (IATA codes; `cmh` Columbus/Ohio is the default) but is **Credit-based Pro / Enterprise only**; traffic still transits US infrastructure | client consent only | Netlify DPA; note DPA is standard on Enterprise |
| **Anthropic** (`/api/ai`) | the `summarizeForAI` prompt incl. **verbatim captions** — §5 | **None.** No region selection on the standard API | client consent only, and it must be a *separate* consent | Commercial Terms + **DPA**; opt for **7-day default retention**, and negotiate **Zero Data Retention (ZDR)** |

Sources: [Netlify Functions region selection](https://www.netlify.com/blog/netlify-functions-region-selection/),
[Netlify GDPR/CCPA page](https://www.netlify.com/gdpr-ccpa/),
[Supabase regions discussion — no ME region](https://github.com/orgs/supabase/discussions/34551),
[Anthropic API data retention (7 days default since 14 Sep 2025; 30-day opt-in via DPA; ZDR for qualifying enterprise customers; API inputs/outputs never used for training)](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention).

**Finding P0 / CONFIRMED — Supabase access token in a URL query string.**
`Connections.tsx:45` does `window.location.href = /api/${fn}?token=${session.access_token}`. A live
Supabase JWT therefore lands in Netlify's HTTP access logs, in the browser history, and in any
`Referer` sent onward. That is a credential in a third-country log file. This is a security defect
first and a transfer/breach-scoping defect second. Fix: `POST` the token, or set a short-lived
signed one-time code, or use a same-site cookie. **This alone would be a finding in a client's
security questionnaire.**

**Finding P1 / CONFIRMED — function logs are an unassessed transfer.**
`getJson` (`_sync.ts:312-317`) throws `body.error.message`; `sync.ts:22-35` and
`sync-cron.ts:19-31` swallow it, but any unhandled path, plus Netlify's own request logging, writes
to US-hosted logs with no retention control documented anywhere. Inventory what is logged, set the
shortest retention the plan allows, and list Netlify logs as a processing location in the ROPA.

### 3.3 Recommended region posture (concrete)

There is no Jordan region on any of the three vendors, and there is no Middle East Supabase region
at all. The realistic postures, in order:

1. **Recommended: EU (Frankfurt, `eu-central-1`) for Supabase; `fra` or `dub` for Netlify Functions
   once on a plan that allows it.** Rationale to document: Frankfurt is the lowest-latency
   Supabase region for the Levant/Gulf (users report ~200ms vs ~650ms from Singapore), and — the
   compliance point — the EU/EEA is the destination for which "the level of protection is not lower
   than the PDPL requires" is by far the easiest argument to make in writing, because the recipient
   is itself subject to a comprehensive regime. It does not create an adequacy *finding* (Jordan has
   no adequacy mechanism), but it makes the operator's **written adequacy assessment** defensible
   rather than aspirational. **P1 / LIKELY.**
   *Caveat:* choosing an EU region increases the chance that GDPR applies to the establishment side
   of the analysis — a trade counsel should weigh (§10.3). It also does not stop US transit, since
   Supabase and Netlify are US companies subject to US process; say so in the assessment rather
   than pretending otherwise.
2. **Anthropic: no region control.** Compensate contractually: DPA + **ZDR addendum**, and
   technically: stop sending caption text (§5). With numbers-only prompts the transfer becomes
   business data, not personal data, and the problem largely dissolves.
3. **Do not** leave Supabase on the default US region "because it was quicker to click". The region
   is fixed at project creation and **cannot be changed later without a migration** — this decision
   must be made before any real client data lands.

### 3.4 What the operator must document (the transfer file)

Build one folder, versioned, produced on demand to a client's advisers or the Unit:
- a **written transfer impact assessment per recipient** (Supabase, Netlify, Anthropic) — what data,
  what volume, which region, what protection the recipient offers, what law it is subject to, what
  government-access exposure exists, what mitigations (encryption, ZDR, minimisation) apply, and
  the conclusion on "not lower than the PDPL";
- **signed DPAs** with all three, plus their **sub-processor lists** and the change-notification
  terms;
- the **consent text** shown to clients naming each destination and the inadequacy statement, with
  the version history;
- the **DPO's sign-off** on each assessment, dated;
- a **review trigger**: re-assess on any sub-processor change, region change, or new vendor.
