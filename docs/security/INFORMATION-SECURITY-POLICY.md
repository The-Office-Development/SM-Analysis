# Information security policy: PulseBoard

**Operator:** Al-Hujra Information Technology Company / Limited Liability
(trading as The Office), Amman, Jordan, commercial registration 83622.
**Applies to:** PulseBoard (`app.theoffice.it.com`), its code, its cloud accounts,
and every person and device with access to them.
**Version:** 1, written 2026-09-19. **Owner:** the company's officers.
**Review:** at least every 12 months, and after any security incident.

This is the written policy Meta's Data Protection Assessment asks for as
evidence (questions 3.1-9 to 3.1-23). Every rule states **how it is enforced
today**. Where the rule is not yet met, it says so and names the action, rather
than describing an intention as a fact. An auditor should be able to check each
"Enforced by" line against the system.

Status key: ✅ in force · 🔴 required, not yet in force

---

## 1. What we protect

**Platform data**: anything received from Meta, LinkedIn or TikTok about a
connected account: identifiers, access and refresh tokens, metrics, post and
story records, aggregate audience breakdowns. Plus our own users' email
addresses and the security audit log.

**Rule:** platform data is used only to show a connected account's own
performance to the person who connected it. It is not sold, licensed, shared
for anyone else's purposes, or used to make decisions about individuals.

## 2. Encryption

| Rule | Enforced by | |
|---|---|---|
| All stored data encrypted at rest | Supabase: AES-256 at rest for the whole database (provider's own statement, SOC 2 Type 2 / ISO 27001) | ✅ |
| Access and refresh tokens additionally encrypted by the application, never stored in clear | AES-256-GCM with a 16-byte authentication tag required on decryption (`encryptToken`/`decryptToken`, `netlify/functions/_lib.ts`); key held only as a Cloudflare secret | ✅ |
| All traffic over TLS 1.2 or higher; nothing unencrypted | Cloudflare edge. Measured 2026-09-19: TLS 1.0 and 1.1 refused by the server; HSTS set (`public/_headers`); every platform API call is HTTPS | ✅ |
| Tokens and secrets never reach a browser or a log | Tokens are read only by server functions; the browser has no grant on `account_secrets` or `provider_identities`; `log()` redacts credential-named fields; the audit log drops them | ✅ |
| App secrets and keys kept only in the platform's secret store | Cloudflare encrypted secrets (write-only once set). Never in the repository | ✅ |

## 3. Access

| Rule | Enforced by | |
|---|---|---|
| Access to production (Cloudflare, Supabase, Meta, LinkedIn, GitHub, the business email) only for the company's officers, each with their own account | Two officers hold all admin roles; no shared logins | ✅ |
| **Multi-factor authentication required on every one of those accounts** | Measured 2026-09-19: the GitHub organisation does **not** require 2FA, and Meta Business Security Centre requires 2FA of "no one" | 🔴 turn on and require 2FA on GitHub (org-wide), Cloudflare, Supabase, Meta Business, LinkedIn and email |
| Access reviewed at least every 12 months; access removed promptly when someone no longer needs it or leaves | This review, dated below | 🔴 first review to be recorded |
| Least privilege in the application: a user sees only their own accounts | Row Level Security default-deny on every table, owner-scoped policies, service-role key only in server functions | ✅ |
| At least two administrators on accounts where a lockout would be unrecoverable | Meta Business portfolio has one admin (Security Centre, 2026-09-19) | 🔴 add the second officer |

**Access review log**

| Date | Reviewer | Result |
|---|---|---|
| | | |

## 4. Devices

| Rule | Enforced by | |
|---|---|---|
| Platform data is not kept on personal or work devices beyond immediate need; exports (CSV, PDF) are deleted after use | This policy | ✅ policy; 🔴 each officer to acknowledge |
| Any device used for PulseBoard work has full-disk encryption and automatic OS security updates | FileVault measured ON on the build Mac (2026-09-19) | 🔴 confirm on every other device used |

## 5. Keeping software patched

| Rule | Enforced by | |
|---|---|---|
| Dependencies checked every week, and security updates applied promptly | Dependabot, weekly, grouped (`.github/dependabot.yml`); every update must pass CI, including the mutation gate | ✅ |
| Known-vulnerable production dependencies block release | `npm audit --omit=dev --audit-level=high` in `security.yml` fails the build | ✅ |
| Fix deadlines by severity | Critical: 7 days. High: 30 days. Medium: 90 days, or recorded as accepted with a reason. Low: at the next review | ✅ |

## 6. Testing for vulnerabilities

| Rule | Enforced by | |
|---|---|---|
| Static analysis on every change, failing on high severity | Semgrep in `security.yml` | ✅ |
| A scan of the live site at least weekly | OWASP ZAP baseline, weekly, in `security.yml` | ✅ |
| Cloud configuration checked after any database change, and at least yearly | `supabase db advisors --linked --type security` | ✅ |
| Every finding triaged and recorded with a verdict | `docs/security/` (first: 2026-09-19) | ✅ |
| A public way to report a vulnerability, monitored | `/.well-known/security.txt` → `info@theoffice.it.com` | ✅ |

## 7. Logging and monitoring

| Rule | Enforced by | |
|---|---|---|
| Security events logged with user, event, time and outcome | `pulseboard.audit_log` (migration 0023): connections, disconnections, exports, deletions, platform deletion and deauthorize requests, token failures, share links | ✅ |
| Logs kept at least 30 days, and tamper-proof | 90 days; the database refuses updates, deletes under 90 days and truncation (proven live 2026-09-19) | ✅ |
| Logs reviewed automatically at least weekly | Weekly review job, recorded in the log itself; `/api/health` turns red if it stops | ✅ |
| Someone is alerted to a serious event within the day | `/api/health` turns red on an alarming event or a stalled sync | 🔴 an uptime monitor must watch it (UptimeRobot, free) |
| Admin activity on Cloudflare and Supabase reviewed weekly | Their dashboard audit logs | 🔴 a weekly look, dated |

## 8. Incidents

A **security incident** is any suspected unauthorised access to, or use,
disclosure, change or loss of, the data in §1, including a leaked secret or
token, and including anything a provider tells us.

**The law sets the deadlines.** Jordan's Personal Data Protection Law No. 24 of
2023, read from its English text on 2026-09-19:
- **Article 14(E):** we must have measures to detect and track any breach.
- **Article 20(A):** after a serious breach that could cause significant harm,
  1. notify the affected people **within 24 hours** of discovering it, with the
     measures they should take;
  2. notify the **Personal Data Protection Unit within 72 hours**, with the
     source and mechanism of the breach, who was affected, and anything else
     known.

Meta requires prompt notice of incidents involving its platform data too.

**What happens, in order:**
1. **Contain**, within the hour where possible: rotate any exposed secret in
   Cloudflare, revoke exposed tokens, block the path used. If the token
   encryption key itself is exposed, rotate it with
   `verify/rotate-token-key.mjs`, whose header gives the four steps. It
   re-encrypts every stored token under a new key without breaking a single
   connection (the old key stays readable until the script proves every token
   opens with the new one). Tested in the suite; it has not yet been run
   against the live database, since the live key never leaves Cloudflare. The
   first real run is the proof.
2. **Assess**: what was reached, whose, since when. The audit log and
   `sync_log` are the first sources.
3. **Decide within 24 hours of discovery** whether Article 20 applies. If in
   doubt, treat it as applying.
4. **Notify** the affected users (24 hours), the Unit (72 hours) and Meta,
   LinkedIn or TikTok where their data is involved.
5. **Record** the incident, the timeline and every notice in `docs/security/`,
   and fix the cause with a test that would have caught it.

## 9. People

| Rule | Enforced by | |
|---|---|---|
| Everyone with access signs a confidentiality undertaking | | 🔴 the officers sign one; anyone added later signs before access |
| Everyone with access reads this policy on joining and at each yearly review | | 🔴 acknowledgement recorded below |
| Access and company devices are returned or removed on leaving | §3 | ✅ policy |

**Acknowledgements**

| Name | Role | Date read |
|---|---|---|
| | | |

## 10. Providers who process the data

Supabase (database, Frankfurt), Cloudflare (hosting and functions), Anthropic
(the optional AI assistant). Each must be bound by a written data processing
agreement limiting them to our instructions and requiring deletion at the end.
Status and certifications: `docs/TRANSFER-ASSESSMENT.md`.
🔴 The Supabase agreement is not yet confirmed executed.
