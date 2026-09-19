# Transfer assessment: the providers outside Jordan

The record Article 15(B) of the Personal Data Protection Law No. 24 of 2023
requires: "Before starting the Data transfer process, the Controller shall verify
the level of protection provided by the recipient outside the Kingdom to ensure
the security of the Data." Written 2026-09-14. Every provider statement below was
read at the provider's own page on that date and is quoted, not summarised from
memory. Re-read them yearly, and whenever a provider is added or changed.

**Basis for the transfer:** Article 15(A)(5), consent "after informing them of the
insufficient level of protection". The consent checkbox on Connections says the
data is processed outside Jordan where protection may be lower (`CONSENT_VERSION`
`2026-09-14`), and each consent is recorded in `pulseboard.consents`. This
assessment is what 15(B) asks for in addition; it does not replace the consent.

---

## 1. Supabase: database, authentication, encrypted tokens

**What it holds:** everything in the privacy policy's "What we hold": sign-in
records, connected accounts, access tokens (encrypted by us before storage),
daily metrics, posts, audience breakdowns, consents, sync history.

**Where:** project `vzfgehxqbbzhhsuwhstv`, region **Central EU (Frankfurt)**,
read from `supabase projects list`. Supabase: "Projects hosted in AWS regions keep
primary database data in-region."

**Provider's stated protection** (supabase.com/security):
- "Supabase is SOC 2 Type 2 compliant." "Supabase is ISO 27001 certified."
- "All customer data is encrypted at rest with AES-256 and in transit via TLS."
- A Data Processing Agreement is "available for customers requiring formal contracts".

**Our own controls on top:** tokens AES-256-GCM encrypted by the application
before they reach the database; row-level security default-deny on every table;
anon grants revoked (migration 0006); no token ever sent to a browser.

**Open:** 🔴 the Supabase DPA has **not been confirmed as executed** for this
project. It is offered, not automatic. Request and sign it from the Supabase
dashboard (the organisation's legal documents).

## 2. Cloudflare: hosting, the scheduled sync, logs

**Also, from 2026-09-19: visitor analytics** (Cloudflare Web Analytics): page path, referrer, browser, country and load timings per page view. No platform data. Named in the privacy policy.

**What it holds or sees:** requests to the app and its functions in transit,
including tokens being used against the platforms; function logs. The log
helper redacts any field named like `token`, `secret`, `proof` or
`authorization` before writing (`_lib.ts`).

**Where:** Cloudflare's global network; a request is handled near whoever makes
it. No region is pinned.

**Provider's stated protection** (cloudflare.com/trust-hub/gdpr):
- "We currently maintain the following validations: ISO 27001, ISO 27701, ISO
  27018, SOC 2 Type II, and PCI DSS Level 1 compliance."
- "Our standard Data Processing Addendum ("DPA") will continue to incorporate the
  EU SCCs."
- Certified under "the EU-U.S. Data Privacy Framework".
- "Cloudflare lets organizations control which regional data centers their
  traffic is inspected in and where logs are sent" (a paid feature; not in use).

**Open:** confirm that the standard DPA applies to account `69b37cce` on its
current plan. Not verified here.

## 3. Anthropic: the optional AI assistant

**What it receives:** only when a user asks the assistant something: a compact
summary of that user's dashboard figures and the titles of their top posts, in
a user turn (`ai.ts`). No access tokens, no raw records, no follower identities.
Nothing is sent by a user who does not use the assistant. Spend is capped per
user (`ai_usage`).

**Where:** Anthropic, a United States company.

**Provider's stated protection** (privacy.claude.com, read 2026-09-14):
- Retention: "we automatically delete inputs and outputs on our backend within
  30 days of receipt or generation", with exceptions including Usage Policy
  enforcement ("up to 2 years") and legal requirements.
- Training: "By default, we will not use your inputs or outputs from our
  commercial products (e.g. Claude for Work, Anthropic API ...) to train our
  models."

**Not claimed:** Anthropic's certifications. Its trust centre did not render
readably from here, so none is recorded; read trust.anthropic.com before
quoting one.

## 4. Conclusion

Each provider publishes security controls (independent SOC 2 attestation for
Supabase and Cloudflare, ISO 27001 for both, encryption at rest and in transit)
consistent with the confidentiality and security duties the law places on a
controller and processor (Articles 13 and 14(E)). None is assessed as offering
*lower* protection for the data it receives. Because Jordan has published no
adequacy mechanism this assessment could rely on, the transfer continues to rest
on informed consent under Article 15(A)(5) as well.

**Actions carried from this assessment:**
1. 🔴 Execute the Supabase DPA.
2. Confirm the Cloudflare DPA covers the account and plan.
3. Read and record Anthropic's certifications and commercial DPA.
4. The Data Protection Officer question (Article 11(A)(5), transfer to databases
   outside the Kingdom) is unaffected by this record and remains open.
