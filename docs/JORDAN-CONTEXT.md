# Operating from Jordan: what changes

Context: the operator, the software and the clients are all in Jordan. The origin of the clients'
connected social accounts is not known. This note records what that changes in
[`LAUNCH-AUDIT.md`](LAUNCH-AUDIT.md) and [`DATA-INTEGRITY.md`](DATA-INTEGRITY.md).

Net effect: one P0 is de-escalated (conditionally), one is unchanged, and a **new body of law
applies that no earlier pass considered**.

---

## 1. The date-shift defect (D2/D3) does not bite at Jordanian time — conditionally

Jordan is **UTC+3 year-round**; daylight saving was abolished in October 2022, so there is no
seasonal offset change ([Time in Jordan](https://en.wikipedia.org/wiki/Time_in_Jordan),
[The National](https://www.thenationalnews.com/mena/2022/10/05/jordan-scraps-clocks-moving-to-winter-time/)).

D2 shifts a day only when the account's UTC offset is **≤ 0**. Re-running
`verify/proofs/p1-date-shift.mjs` with an Amman account:

```
### Amman page (Asia/Amman, UTC+3)   rows wrong: 0/30   window error: 0 (0.00%)
### Amman, incremental (cron path)   rows wrong: 0/1
```

**The condition is the account's timezone as configured on the platform, not where the company or
the client sits.** That means:

- A Page created or administered from abroad, or one left on a US default, is at a negative offset
  and every one of its days is wrong.
- A client can change their Page timezone at any time, silently flipping their data between correct
  and incorrect with no signal in the product.
- A mixed roster is the worst case: some clients correct, some wrong, no way to tell which from the
  dashboard — harder to detect than a uniform bug.

**Therefore the fix is still required**, and is unchanged: read each account's `timezone_id` /
`timezone_offset_hours_utc` at connect time, convert `end_time` into that zone before taking the
date, and store the zone on the row. Until then, audit the timezone of every connected account and
treat any non-positive offset as producing invalid history.

Severity for a roster confirmed to be entirely Amman-configured: **P2** (latent, one Page change
away from returning). For any roster including a non-positive-offset account: **P0**, unchanged.

## 2. The frozen-day defect (D1) is unaffected

D1 depends on the cron schedule, not on geography. `sync-cron.ts` fires at `0 6 * * *` UTC = **09:00
Amman**, so each Jordanian calendar day is written once holding roughly its first nine hours, then
never revisited. Still **P0**, still the highest-priority correctness fix.

## 3. Jordan's PDPL applies, and it is fully in force

Personal Data Protection Law **No. 24 of 2023**: effective 17 March 2024, with the one-year grace
period ending **17 March 2025** — so it is fully enforceable now
([Securiti](https://securiti.ai/jordan-personal-data-protection-law-of-2023/),
[Digital Watch Observatory](https://v45.diplomacy.edu/resource/jordans-personal-data-protection-law-no-24-of-2023)).

Two provisions bear directly on this architecture:

**Cross-border transfer.** Personal data may not be transferred outside Jordan to a recipient
offering protection lower than the PDPL requires. Every piece of infrastructure here is outside
Jordan — Supabase (database and tokens), Netlify (hosting and function logs), Anthropic (the AI
assistant). Each is a cross-border transfer of Jordanian data subjects' personal data and needs a
documented basis and an adequacy assessment.

**Data Protection Officer.** A DPO is required in specified cases, and cross-border transfer is one
of the named triggers. On the current design, one is very likely required.

Also unchanged from the earlier pass and now doubly relevant: there is no deletion path, no
retention policy, no export, and no audit log — the PDPL expects data-subject rights and complaint
handling, and none of the code supports them.

**Region selection is now a compliance decision, not a latency one.** Supabase and Netlify default
to US regions; deliberately choose the region and record why.

## 4. GDPR is not automatically out of scope

Being outside the EU does not settle it. The product processes audience demographics — including
country breakdowns — describing the clients' **followers**, who are third parties with no
relationship to PulseBoard and who may be in the EU or UK. Whether that constitutes monitoring
under GDPR Article 3(2) is a question for counsel, not for this document, but it must be asked
rather than assumed away.

## 5. Platform verification is practical but adds friction

- **Meta Business Verification** accepts a national business registration document where the country
  is not specifically listed, so a Jordanian commercial registration should work. Documents not in a
  supported language need an English translation carrying an official stamp from a recognised
  translation agency — budget time for this
  ([requirements overview](https://singhamandeep.com/meta-business-verification-documents-required/)).
- **TikTok**: Jordan is a supported location in TikTok's MENA list. Country restrictions on
  *developer app registration* specifically are not publicly documented — **verify directly with
  TikTok before committing to the TikTok integration timeline**, as this is the one item here that
  could be a hard blocker rather than a delay.

## 6. Nothing else in the two audits changes

Every other finding — the expired Graph API version, removed metrics, absent token refresh, the
OAuth state-replay account-takeover, disconnect not revoking, the missing deletion endpoint, rate
limiting, and a test suite with a mutation score of 0/13 — is geography-independent and stands as
written.
