# Meta Data Protection Assessment: draft answers

Drafted 2026-09-19, before Meta asks. The DPA is annual for apps with advanced
access to Platform Data; once it is triggered an app admin has **60 days**, and
missing it loses platform access. Meta also warns that "incomplete or vague
answers may result in loss of platform access", so every answer below is either
backed by evidence we hold or marked as a gap.

Questions are from Meta's page "Data Protection Assessment Questions",
**version 3.1**, read 2026-09-19
(`developers.facebook.com/docs/development/maintaining-data-access/data-protection-assessment/assessment-questions/`).
They are paraphrased here, not quoted; re-read the page when the real
assessment arrives, since Meta revises it.

**Every fact marked "measured" was checked against the live system on
2026-09-19**, not taken from another document.

Status key: ✅ ready · 🟡 gap we can close in code or config · 🔴 owner action

---

## Data use

| ID | Question (paraphrased) | Answer | Status |
|---|---|---|---|
| 3.1-1 | Used to disadvantage people on protected characteristics? | **No** | ✅ |
| 3.1-2 | Used for housing, employment, insurance, credit, benefits, immigration decisions? | **No** | ✅ |
| 3.1-3 | Used for surveillance? | **No** | ✅ |

PulseBoard shows an account's own performance to the person who connected it.
Audience data is aggregate demographics Meta itself supplies; nothing is
inferred about individuals.

## Data sharing (3.1-4)

**Select: d (service providers), e (enabling businesses to access their own
Platform Data, i.e. tech provider), f (sharing at the user's direction).**
Not a, b, c or g: nothing is sold, licensed or bought.

**4.b Service providers that receive Platform Data:**

| Provider | What it receives | Where | Certifications (provider's own statement) |
|---|---|---|---|
| Supabase (on AWS) | All stored Platform Data; tokens already encrypted by us | Frankfurt, `eu-central-1` | SOC 2 Type 2, ISO 27001 |
| Cloudflare | Requests in transit; the functions that call Meta | Global edge | ISO 27001/27701/27018, SOC 2 Type II |
| Anthropic | Only when a user opens the AI assistant: a text summary of that user's dashboard | United States | Not yet recorded |

Sources and dates: `TRANSFER-ASSESSMENT.md` §1-3.

| ID | Question | Answer | Status |
|---|---|---|---|
| 4.c | Written agreements limit providers to our instructions? | Yes once executed | 🔴 **Supabase DPA not confirmed executed.** Cloudflare DPA: confirm it covers account `69b37cce`. Anthropic: record its commercial DPA |
| 4.c.i | Which protections (a-e)? | All five, per each provider's DPA | 🔴 read each executed DPA and tick only what it says |
| 4.c.iv | Any provider violations? | No | ✅ |
| 4.c.v | Agreements say how and when providers delete? | Per each DPA | 🔴 as 4.c |
| 4.d | Process only on behalf of and at the direction of clients? | **Yes.** Each client sees only the accounts they connected; nothing is used for anything else | ✅ |
| 4.e | Each client's data kept separate? | **Yes, logically.** Every table is keyed by the owning user and account; Row Level Security is default-deny on every table (`supabase/migrations/0001_audit_fixes.sql`), and the service-role key never reaches a browser | ✅ |
| 4.i.A | How do users direct sharing? | A share link, created only by the account owner pressing "Share link", with an expiry they choose (7, 30, 90 days or none) and revocable at any time from Reports | ✅ |
| 4.i.B | Screenshots of that flow | Take on submission day: the Share button with its expiry menu, and "Links you have shared" | 🟡 screenshots |

## Data deletion

| ID | Question | Answer | Status |
|---|---|---|---|
| 3.1-5 | Delete in all five circumstances (no longer needed, user asks, account deleted, Meta asks, law requires)? | **Yes** | ✅ |
| 5.b | How is "no longer necessary" decided? | Data is kept only while the account stays connected, because showing it IS the service. Disconnecting deletes it | ✅ |
| 5.c | How do users request deletion? | Three ways: **Disconnect** (deletes that account's token and data immediately), **Delete my account** on Connections, and Meta's data-deletion callback (`/api/meta-data-deletion`, with a status page) | ✅ |
| 3.1-6 | Deleted as soon as reasonably possible (within 120 days)? | **Yes, immediately**, not after a delay (`disconnect.ts`, `account-data.ts`). LinkedIn data additionally expires on LinkedIn's own schedule | ✅ |

One caveat to settle before answering: provider-side **backups** can hold
deleted rows for a while. 🔴 Confirm the Supabase plan's backup retention; if it
is 7 days or so, say "removed from backups within N days", well inside 120.

## Data security

| ID | Question | Answer, and evidence | Status |
|---|---|---|---|
| 3.1-7 | SOC 2 / ISO 27001 certification of our own? | **No.** Our providers hold them (above); we do not | ✅ honest "No" |
| 3.1-8 | Platform Data stored in a backend? | **Yes** | ✅ |
| 8.a | Which types? | Account id and username, profile picture URL, access tokens (encrypted), daily metrics, post and story records with their metrics, aggregate audience breakdowns | ✅ |
| 8.b | Hosting | AWS (via Supabase, Frankfurt) and Other: Cloudflare | ✅ |
| 3.1-9.a | Encryption at rest for all backend Platform Data? | **Yes.** Supabase encrypts all data at rest with AES-256; on top, access and refresh tokens are encrypted by the application with AES-256-GCM before storage (`encryptToken`, `_lib.ts`) | 🟡 screenshot + written policy |
| 3.1-10 | Staff store Platform Data on devices? | **Yes, possible**: operators can download CSV/PDF exports and run maintenance scripts. So: a (full-disk encryption) + c (acceptable use). FileVault **measured ON** on the build Mac | 🔴 confirm FileVault on every other device used; written acceptable-use note |
| 3.1-11.a | TLS 1.2+ on all public transmission? | **Yes, measured**: TLS 1.2 accepted; TLS 1.0 and 1.1 refused by the server (`alert protocol version`). HSTS set (`public/_headers`). Every call to Meta is HTTPS | 🟡 attach an SSL Labs report |
| 11.c | Never unencrypted, never SSL 2/3? | **Yes** | ✅ |
| 3.1-12.a | Software vulnerability testing in the last 12 months | **a (SAST) and b (DAST), continuous**: Semgrep and `npm audit` on every push, failing on high severity; OWASP ZAP baseline against the live site weekly (`.github/workflows/security.yml`). First dated results: `docs/security/2026-09-19-security-tests.md` (one real finding, fixed). Plus the pre-launch audit (`docs/COMPLETE-AUDIT.md`) | ✅ |
| 3.1-12.b | Backend environment testing | As above: the functions are in the scanned code, and the live scan covers the deployed backend | ✅ |
| 3.1-12.c | Cloud misconfiguration testing, 12-monthly | **Supabase security advisor run 2026-09-19**: five findings, three fixed (migration 0024), two accounted for (`docs/security/2026-09-19-security-tests.md`) | ✅ (🔴 leaked-password protection is an owner setting) |
| 3.1-13.a | Tokens stored on client devices? | **No.** Tokens exist only server-side; the browser can read neither `account_secrets` nor `provider_identities` (grants in `0001`) | ✅ |
| 3.1-13.b | App secret exposed to clients? | **No** | ✅ |
| 3.1-13.c | User token protection | **b** (application encryption: never stored in cleartext) and **c** (`appsecret_proof` on every Facebook Login call). Token material is redacted from logs by `log()` in `_lib.ts` | ✅ + 🟡 screenshot |
| 3.1-13.d | App secret protection | **c, other**: Cloudflare encrypted secrets, write-only once set, never in the repository, never shipped to a browser | ✅ + 🟡 screenshot |
| 3.1-15.a | MFA on collaboration tools (email etc.) | | 🔴 confirm and screenshot |
| 3.1-15.b | MFA on code repository | **Measured 2026-09-19: the GitHub org `The-Office-Development` does NOT require 2FA** | 🔴 turn on "Require two-factor authentication" (check first that every member has 2FA, or they are removed) |
| 3.1-15.c | MFA on CI/CD | GitHub Actions and Cloudflare | 🔴 as 15.b, plus Cloudflare account 2FA |
| 3.1-15.d | MFA on backend admin (Supabase, Cloudflare, Meta Business) | Meta Business Security Centre showed 2FA required of **"No one"** | 🔴 enable and require (`SETUP-META.md` §1c) |
| 3.1-15.e | MFA on SSH / remote servers | Not applicable: no servers of our own | ✅ N/A |
| 3.1-16 | Account management system; yearly review; prompt revocation | Two officers hold every admin role | 🔴 written one-page procedure; first review dated |
| 3.1-17.a | Patching, backend | Dependencies pinned by `package-lock.json`; `npm audit` clean; **Dependabot weekly** (`.github/dependabot.yml`, added 2026-09-19), and every update must pass CI including the mutation gate | ✅ (🔴 also switch on Dependabot security alerts in the repo settings) |
| 3.1-17.c | Patching, organisation's own systems | | 🔴 automatic OS updates on work devices |
| 3.1-21 | Public way to report vulnerabilities | **Published 2026-09-19**: `/.well-known/security.txt` (RFC 9116), contact `info@theoffice.it.com`. Before that the URL returned our app's HTML (the SPA fallback). A test fails a month before it expires | ✅ |
| 3.1-22.c | Logs protected from tampering | **Yes, enforced by the database**: rows cannot be updated at all, cannot be deleted until 90 days old, the table cannot be truncated, and browser keys have no access. Proven live 2026-09-19 against controls | ✅ |
| 3.1-22.a | Admin audit logs | Cloudflare and Supabase keep account audit logs for their dashboards | 🔴 confirm retention on our plans; screenshot |
| 3.1-22.b | Application event logs (user id, event, time, success) | **Yes, since 2026-09-19**: `pulseboard.audit_log` (migration 0023) records connect (every exit of every OAuth callback), disconnect, data export, account deletion, Meta deletion and deauthorize requests (with the Meta user id), token refresh failures, and share links created or revoked. Each row: our user id, platform user id where known, event, time, success/failure. Never tokens or platform data | ✅ |
| 3.1-22.d | Retained 30+ days | **Yes, 90 days**, then purged automatically | ✅ |
| 3.1-22.e | Automated weekly review of application logs | **Yes**: an automated weekly review counts the week's events and alarms and records that it ran; `/api/health` turns red (paging the operator via the uptime monitor) on any alarming event within 24 hours, and if the weekly review ever stops running | ✅ once the uptime monitor is set up |
| 3.1-22.f | Weekly admin-log review | | 🔴 a weekly look, recorded |
| 3.1-22.g | Incident investigation process, reporting to Meta | **Yes**: policy §8. Contain, assess, decide within 24 hours, notify users (24 h) and Jordan's Data Protection Unit (72 h) per PDPL Article 20(A), and Meta; record and fix with a test. Key rotation without downtime (`verify/rotate-token-key.mjs`) | ✅ |
| 3.1-23 | Personnel security | Two officers | 🔴 confidentiality agreement; short security briefing, dated |

---

## The gaps, as work

**Ours to close (code, config, documents):**
1. ~~Publish `security.txt`~~ **done 2026-09-19**.
2. ~~An application audit log~~ **done 2026-09-19** (migration 0023). It was: an application audit log retained 90 days in our own database, not the
   platform's live logs: connect, disconnect, deletion requests, token refresh
   failures, auth failures, each with user id, event, time and outcome
   (3.1-22.b/d). A weekly automated summary of it (3.1-22.e).
3. ~~Repeatable security testing~~ **done 2026-09-19**. It was: repeatable security testing with dated reports: a SAST scan (e.g. Semgrep)
   and a DAST baseline scan (e.g. OWASP ZAP) of the live app, in CI (3.1-12).
4. ~~Cloud configuration review~~ **done 2026-09-19** for Supabase. It was: cloud configuration review: Supabase security advisors plus a Cloudflare
   settings review, recorded with a date (3.1-12.c).
5. ~~Dependabot~~ **done 2026-09-19** (config; alerts are a repo setting).
6. ~~One written information-security policy~~ **done 2026-09-19**: `docs/security/INFORMATION-SECURITY-POLICY.md`, every rule with how it is enforced today and the ones not yet in force marked. It was: one written information-security policy covering encryption, access,
   patching, logging, incidents and devices. Meta asks for "written policy"
   evidence on almost every security question; one document serves all.

**Owner actions (stated once):**
- Execute the Supabase DPA; confirm Cloudflare's; record Anthropic's.
- Require 2FA on the GitHub org, and turn on 2FA for Cloudflare, Supabase, Meta
  Business and email accounts.
- Confirm FileVault (or equivalent) on every device used for PulseBoard work.
- A confidentiality agreement between the officers; a dated access review.
- Confirm Supabase backup retention.
