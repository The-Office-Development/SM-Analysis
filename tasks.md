# Tasks — from here to a client on real numbers

Working checklist. `CLAUDE.md` is the technical brief, `docs/PROJECT-STATE.md` the
commercial one; this is just what to do next, in order.

**Data source decided: our own Meta app, direct to Meta.** Vendors were evaluated
and rejected — neither Metricool nor Zernio offers a read-only connection, and
Metricool's asks for full control of the client's Facebook Page plus
`business_management`, the scope this project dropped as a P0 finding. Reasoning
in `docs/VENDOR-OPTIONS.md`, marked deferred.

The software is finished and green: 48 tests, mutation 20/20, crons configured in
code. What follows is switching it on, not building it.

Last updated: 2026-08-28.

---

## 0. Before deploying — no accounts needed

- [x] **Reword the legal pages to describe what the system actually does.**
      Done 2026-08-28. The policy claimed shared links expire and that records
      are kept for a retention period after disconnection; neither feature
      exists. Both statements are gone, replaced with the verified behaviour:
      disconnecting deletes the token, metrics, posts, audience data and that
      account's sync log **immediately** (`sync_log` cascades on the foreign
      key), so there is no retention window because nothing is retained.
- [x] Contact set to `privacy@theoffice.it.com` — Zoho is already live on the
      domain, so this was never actually blocked.
- [x] `[LOG RETENTION]` resolved — operational records are covered by the same
      immediate deletion, so the separate claim was unnecessary.
- [x] Share links documented honestly: they hold a snapshot, do not expire, and
      cannot be revoked individually. Written as a limitation with a contact
      route rather than a promise the code cannot keep.
- [x] **Fixed the Instagram setup guide, which described the wrong OAuth path.**
      `src/lib/setupGuides.ts` still documented the Facebook Login route: it said
      a linked Facebook Page was mandatory, that there was "no separate Instagram
      connection", and it gave `/api/oauth-meta-callback` with `META_APP_*`
      credentials. The Connections page renders that redirect URI directly, so
      anyone following it would have registered the wrong callback and the
      connection would have failed. The Page requirement is the exact thing the
      Instagram Login path exists to remove. Now matches the code: correct
      callback, `INSTAGRAM_APP_*`, the real read-only scopes, and the Tester
      route spelled out.

- [ ] `[STATUTORY PERIOD]` — the PDPL response deadline is a legal fact, not a
      choice. Left for counsel rather than guessed.
- [ ] `[REGIONS CONFIGURED ... TRANSFER BASIS]` — needs the Supabase and Netlify
      region decision plus a stated cross-border position.
- [ ] `[UPTIME COMMITMENT]` and `[LIABILITY POSITION]` in the terms — commercial
      and legal decisions, not code ones.

`OPERATOR` and `ADDRESS` stay bracketed until the translation lands (§4). They
are now the only two placeholders blocked on something other than counsel.

## 1. Stand it up — about two hours

- [ ] Supabase project. Run in this exact order: `supabase/schema.sql`, then
      migrations `0001_audit_fixes`, `0002_token_refresh`,
      `0003_deletion_and_consent`, `0004_ai_usage`, `0005_instagram_login`.
- [ ] Project settings → API → Exposed schemas: add `pulseboard`. Without it every
      request returns `PGRST106`.
- [ ] Record which migrations have been applied. Re-running `schema.sql` after an
      edit silently does nothing — it is `create table if not exists` throughout.
- [ ] Generate `TOKEN_ENC_KEY` (base64 of 32 random bytes) and
      `OAUTH_STATE_SECRET` (32 random hex). Both fail closed if unset.
- [ ] Netlify env vars, **scoped to Production only** — Netlify defaults them to
      every context, and the code refuses to run in a deploy preview against live
      credentials. Full list in `docs/DEPLOY-RUNBOOK.md` §4.
- [ ] Point `app.theoffice.it.com` at Netlify via CNAME. DNS is delegated to our
      own nameservers, so this works and so will Meta's TXT verification.
- [ ] Deploy. Confirm `/privacy`, `/terms`, `/data-deletion` load and
      `/api/deletion-status?code=x` returns JSON rather than HTML.

## 2. The Meta app — an afternoon, no review

- [ ] Create a Meta developer account and app. Free, instant, no documents.
- [ ] Products → Instagram → **API setup with Instagram login**.
- [ ] **Set the app display name deliberately** — "The Office" or "PulseBoard".
      This is the name the client sees on the consent screen.
- [ ] Redirect URI: `https://app.theoffice.it.com/api/oauth-instagram-callback`
- [ ] Permissions: `instagram_business_basic` and
      `instagram_business_manage_insights`. **Nothing else.** Never
      `instagram_business_content_publish`, `pages_*` or `business_management` —
      guarded by a mutation test.
- [ ] App settings → Advanced → Security → **Require App Secret: ON**
- [ ] App settings → Basic → privacy, terms, data-deletion callback
      (`/api/meta-data-deletion`) and deauthorize callback
      (`/api/meta-deauthorize`). All four must be reachable.
- [ ] Copy `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` into Netlify. These are
      **not** the same as `META_APP_*`.

## 3. The gate that matters

- [ ] Connect our own Instagram account. Works immediately — we hold an admin
      role. **This is the first time this code has ever touched the live API**, so
      expect to debug. Failures are recorded in `sync_log` with an `error_code`.
- [ ] Let it sync **at least three days**. Recent days are provisional by design
      and read low; history arrives in chunks because only `reach` returns a daily
      series and everything else costs one call per day.
- [ ] `node verify/reconcile.mjs --list`, then
      `node verify/reconcile.mjs --account <id> --days 14`.
- [ ] **Compare three or four settled days against the Instagram app itself.**
      Every test in this repo runs against a mock built from documentation. This is
      the only validation against reality, and it can fail. **No client sees the
      product until the numbers agree.**

## 4. Blocked on a human

- [x] **Decide the English spelling of `الحجرة`** — settled by the certified
      translation, which already existed: `Al-Hujra Information Technology
      Company / Limited Liability`. Ends at *Limited Liability*.
- [x] ~~Ask the Companies Control Department whether an English extract exists~~
      — moot; the certified translation is in hand.
- [x] ~~Order the certified translation~~ — done, AGATO, stamped 19 Aug 2026.
- [x] Fill `OPERATOR` and `ADDRESS` in `Legal.tsx` and state the brand/entity
      link in the footer with registration 83622. Done 2026-08-28.
- [ ] **Use the name verbatim in Meta Business Manager** when verification is
      submitted: `Al-Hujra Information Technology Company / Limited Liability`.
      A name mismatch is the most common rejection, and this string ends at
      *Limited Liability* — not *Limited Liability Company*.
- [ ] Obtain a second corroborating document **carrying a street address** — the
      registration gives only "Amman". A utility bill for the registered premises
      is the best fit; no bank account exists, so a statement is unavailable.

## 5. The client

- [ ] **Their test accounts must be Business or Creator.** A personal account
      cannot expose insights at all, so this blocks the connect flow entirely.
      Hand this over now — it is on their side and takes minutes.
- [ ] Add their accounts as **Testers** (App roles → Roles). They accept from
      their own Instagram settings.
- [x] Client has provided `iron_jor` (IRON_JO, calisthenics gear, Amman) as a
      test account — **already a professional account**, ~1,483 followers, posts
      from Jan–Jul 2026.
- [ ] **Confirm we can open Instagram's own Insights on it.** This is what
      decides whether it can serve as the §3 gate: reconciliation compares our
      numbers against Instagram's for the same account, so we need to see both
      sides. Login access is ideal; screenshots from the client work but are slow
      to debug against.
- [ ] Note: a *fresh* test account cannot validate numbers — below ~100 followers
      demographics come back empty and there is no settled history to compare.
      `iron_jor` is not that: it is a real account with real followers, so it can
      carry the gate. Do not skip reconciliation on the assumption that a "test"
      account cannot support it.
- [ ] It is also the screencast account for App Review. A dashboard with real
      followers and populated demographics reads as a product; an empty one reads
      as a prototype.
- [ ] The account has been quiet since 31 July. Posting two or three times during
      the sync window gives real day-to-day movement, which is what makes a
      one-day date-boundary error obvious rather than subtle.

## 6. Background — weeks, blocks nothing above

- [ ] Business Verification (`docs/SETUP-META.md` §1). 10 minutes to 14 working
      days. Note the correction recorded there: our registration carries no stamp
      **by design**, saying so in its own footer, which contradicts the inherited
      guidance that Meta rejects unstamped documents.
- [ ] App Review, once real data exists to screencast. Advanced access for both
      scopes.
- [ ] Data Use Checkup and Data Protection Assessment. The transfer question needs
      the sub-processor list — Supabase, Netlify, Anthropic, all outside Jordan.

**This is what lifts the ceiling past a handful of accounts.** The vendor route
does not: its permissions objection grows with client count while its cost
objection shrinks. App Review is the scale answer, and it has a long lead time —
so start §4 now even though nothing this week waits on it.

## 7. Known gaps, deliberately deferred

- [ ] Share-link expiry and revocation — **not built.** See §0.
- [ ] Retention purge job — **not built.** See §0.
- [ ] Queue-backed sync. The hourly cron is fine to a few hundred accounts.
- [ ] PWA polish: manifest, icons, installability.
- [ ] DPO question under the PDPL; counsel sign-off on the legal pages.
- [ ] A standing watch on Meta's deprecation schedule. `CLAUDE.md` calls this a
      permanent tax on the product, and its absence caused most of the audit
      findings.
