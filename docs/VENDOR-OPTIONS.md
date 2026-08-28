# Data source options — buy the pipe, or build it

Status: **PROPOSED, not decided.** Gated on one unanswered question (§5).

The blocker for launch has never been our code. It is Meta App Review: until the
app is approved, only accounts holding a role on it can connect. A licensed data
vendor has already been through that process, so buying their API buys their
approval — which is the only thing standing between us and a paying client.

This is a data-source decision only. Everything above the data layer — schema,
dashboard, reporting, share links, the assistant — is unaffected.

---

## 1. The architecture being considered

```
Instagram  ->  vendor (official Meta partner, official OAuth)
                 ->  vendor API  ->  our database  ->  our dashboard
```

We never talk to Instagram. The client authorises the vendor through Instagram's
own screen, and we read our own data back out through a documented API.

**This is not scraping.** An earlier version of this idea was to scrape the
vendor's web interface; that breaches vendor terms and was rejected. Both
shortlisted vendors sell an official API for exactly this purpose.

## 2. Does this risk the client's Instagram account? No mechanism for it

The distinction that decides account safety is **official OAuth versus
credentials**:

- Tools that ask for the account password and drive the account — auto-follow,
  auto-like, browser automation — are what get accounts actioned. With those,
  the account *becomes* the integration, so the account takes the enforcement,
  and a flagged session cascades to the profile, Page, ad account and Business
  Manager.
- Tools connecting through Meta's official API are not in that category. The
  client authorises on Instagram's own screen, no password is ever shared, and
  every call is sanctioned and rate limited by Meta.

Metricool is an **official Meta partner using the official API**. The client's
account therefore sits in the same safety position it would with our own app
after App Review — arguably better, since the vendor's integration is already
vetted and running at scale.

Residual risk is not to the client's Instagram account. It is vendor dependency:
their pricing, their uptime, their terms.

## 3. Vendor trust — Metricool

| | |
|---|---|
| Partner status | Official partner of **Meta, Pinterest and X**; **Google Premier Partner** |
| Company | Spanish; founded by Juan Pablo Tejela and Laura Montells |
| Ownership | **team.blue** holds ~50.9% since September 2024 — a large European digital services group |
| Jurisdiction | EU |

Two things matter here beyond the badge. Corporate backing means it is not a
startup that disappears mid-contract. And an EU vendor gives a materially cleaner
cross-border transfer story under Jordan's PDPL than a US startup would.

## 4. The shortlist

Priced against our model: **50 JD/month per client (~$70)**.

| Vendor | API available on | Price | Viable? |
|---|---|---|---|
| **Metricool** | Advanced | **$54/mo, 15 brands** (~$3.60/brand) | **Yes** — first choice |
| **Socialinsider** | agency tiers | Brand $49/mo | Yes — confirm which tier includes API |
| **Minter.io** | Agency plans | unpublished | Yes — docs at developers.minter.io; branded exports |
| Iconosquare | not published | from €33/mo | Ask |
| Ayrshare | yes | $299/mo, 10 profiles | No — 4x per-client revenue |
| Phyllo / insightIQ | yes | from $199/mo | No — built for funded platforms |
| Sprout, Hootsuite, Brandwatch | enterprise contract | high | No |

Everything below the line costs four to six times what a client pays us.

Ranking: **Metricool** on trust and price, **Socialinsider** as the backup at a
similar price, **Minter.io** third — its API documentation is the most explicitly
aimed at our use case, but unpublished agency pricing usually means expensive.

## 5. THE OPEN QUESTION — answer this before committing

**No vendor publicly states whether their API terms permit powering a product we
bill clients for.** Derivative-product and resale clauses are exactly where these
agreements get specific. Send this to all three today:

> We are an agency in Jordan building a client-facing analytics dashboard on your
> API. Our clients' Instagram accounts are connected through your platform, and we
> read the data back through your API to present it in our own dashboard, which we
> bill our clients for. Is this permitted under your terms of service?

Get the answer **in writing**. It decides the architecture.

If all three say no, fall back to the direct Meta build with a tester-role pilot.

## 6. What to check in the first hour of API access

Before committing a client, confirm the API actually exposes what the product
needs. Meta's own API does; a vendor's may summarise:

- [ ] **Daily granularity** for followers, reach, views and interactions — not
      just period totals
- [ ] **How far back** history goes on a newly connected account
- [ ] **Follower demographics** (age, gender, country) and **hourly activity**
      for the Planner
- [ ] **Per-post metrics** with publish timestamps
- [ ] **Which timezone** day boundaries follow — this is the same question that
      produced the D2/D3 defects in `DATA-INTEGRITY.md`, and the vendor's answer
      may differ from Meta's raw `end_time` convention
- [ ] Rate limits and refresh cadence
- [ ] Whether values are restated as they settle (our trailing re-fetch assumes
      they are)

## 7. If we proceed: keep the data source swappable

Do **not** wire Metricool into the app directly. Add it as a third provider
alongside the two that exist (`_instagram.ts` for Instagram Login,
`_sync.ts` for Facebook Login), behind the same contract:

- produces the same `DayRow` shape
- obeys the same discipline: **null means unknown, never a fabricated zero**
- flows through the same merge-over-stored path
- is covered by the same mutation-gated tests
- is reconciled the same way, with `verify/reconcile.mjs`

Then swapping Metricool for direct Meta access after App Review is a
configuration change, not a rewrite — and none of the work already done is
wasted.
