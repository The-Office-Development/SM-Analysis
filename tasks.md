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

## WHERE THINGS STAND — 2026-09-08

Sections 1 and 2 below were done on 2026-09-04 and are kept for the record, not
as work. Migrations 0001-0012 are all applied.

### Settled

0. **Reconcile against the Instagram app.** DONE. Views within 0.7%,
   interactions within 7%, net followers exact against @malekismaiil's own
   30-day panel. First number in this project ever checked against reality.
   It also found the follows_and_unfollows dimension misread, which had the
   follower line pointing the wrong way. `DATA-INTEGRITY.md`.
1. **`content` nullable.** DONE, migration 0009. A post Instagram has not
   reported on stores null, not 0, so a just-published item reads "n/a" rather
   than "reached 0 people". Widening the type surfaced 39 call sites and each
   got a decision rather than a blanket `?? 0`.
2. **Cloudflare.** DONE. Pages serves the app and `/api/*`; `worker-cron` carries
   both schedules with no HTTP route. The handlers were not rewritten — an
   adapter translates the runtime to them, so every security decision the audit
   produced survived the move.
2b. **Netlify cut off.** DONE. It was rewriting the trailing seven days hourly
   with the pre-fix arithmetic.
3. **Story capture.** Built, migration 0010. **NOT verified, and now with a
   reason to doubt it.** On 2026-09-07 a story was live on @malekismaiil while
   `/stories` returned `{"data":[]}` with HTTP 200 and
   `x-app-usage {"call_volume":0}` — the API succeeding and reporting nothing, not
   throttled and not erroring. `/me/media` showed no STORY entries either.

   **2026-09-08, second data point.** Two different accounts — @malekismaiil and
   @heath_ens21 — each had a live story that was a RESHARE of the same feed post.
   Both returned `{"data":[]}`. Two independent accounts behaving identically
   makes the reshare explanation much the strongest:

   > **Working conclusion: `/stories` returns the account's OWN media. A post
   > reshared to a story is someone else's media and does not appear.**

   Consistent with the one earlier observation where the edge DID return a story,
   and with `/me` reporting `media_count: 10` and no STORY entries.

   **Still unconfirmed**, because the control has never been run: a plain,
   original story — a photo or text card the account holder made themselves —
   has not been tested. Until it is, "reshares are excluded" is the best
   explanation rather than a demonstrated fact.

   **If it holds, it is a real product limitation and not a small one.** Creators
   reshare constantly: brand tags, collaborations, sponsor posts. A sponsor
   asking "how did my campaign story perform?" is asking about exactly the
   category that would be invisible.

   ### UNFINISHED — carried into the drinkat pilot

   As of 2026-09-08, **zero stories have ever been captured**. The code path is
   built and no longer competes for budget (stories are fetched first in a run,
   before the day metrics), but Instagram has not yet handed us a single story,
   so nothing about it has been exercised end to end.

   Deliberately left to the pilot rather than forced now: a month of a real
   creator's output is a better experiment than anything that can be staged. He
   will post original stories, reshares, and sponsor content, and every sync
   already logs `sync.stories_checked` with a count — so the evidence collects
   itself.

   **What to watch during the pilot, and what each outcome means:**

   - **A count above zero at any point** — capture works. Check what kind of
     story it was, because that identifies the boundary.
   - **Always zero, while he is visibly posting stories** — the API does not
     expose them to us at all, and the feature must be withdrawn from the pitch
     rather than quietly under-delivering.
   - **Non-zero for original stories, zero for reshares** — confirms the
     hypothesis. Document it plainly: sponsor and collaboration stories, which
     are usually reshares, cannot be measured.

   **Do not describe stories as a working feature to a client until one has been
   captured.** Unlike every other gap here, this one loses data permanently while
   it goes unnoticed: a story and its insights are gone in 24 hours.

   Until this is understood, story capture cannot be described as working, and
   the honest statement to a client is that stories are captured **when Instagram
   exposes them**, which is not always. See §6c.
4. **Per-post page.** DONE. `/content/:id` with rank, comparison against the
   typical post of that format, engagement composition, a distribution chart,
   and "Check now" for a live single-post fetch (migration 0012 rate-limits it).
5. **Token scope audit.** DONE, and the answer was bad. An OAuth token inherits
   whatever the ACCOUNT previously granted the app, so the request is a floor,
   not a ceiling. The callback now audits every new token (0011).
   `API-VERIFICATION.md` §7.5.
7. **Sync call budget.** DONE. Not theoretical: production runs were exceeding
   Cloudflare's 50-subrequest cap, which refuses the WRITES too, so a run
   reported success while losing demographics, online_followers and its own
   sync_log entry.
+  **Security review.** DONE, unplanned. `SECURITY-REVIEW-2026-09-07.md`.
   Cleared a React Router advisory and rate-limited /api/refresh-post.

6. **Pagination past 25 posts.** DONE 2026-09-08. Media follows Meta's cursor to
   100 posts, degrading per page when the insights expansion is refused. The mock
   had never paginated either, which is why nothing caught it.

**Also done 2026-09-08, none of it on the original list:**

- **The sync now fits.** A complete run needed ~55 subrequests against a free-tier
  cap of 50, so runs were losing their WRITES at the end. Content and stories are
  fetched first, demographics once a day instead of hourly, the trailing window
  rotates across runs, and truncation drops the oldest days rather than the
  newest. A run costs 22 calls now, not 46. **This removed the reason to pay for
  Workers Paid.**
- **The cron runs every 15 minutes**, not hourly. A firing is one request against
  100,000 a day; the 50 limit is per run and resets each time. The two were being
  conflated.
- **A backfilling account keeps its today.** The backfill branch returned
  unconditionally, so recent days froze for the whole dig — hours at 30 days, two
  days at the two years Meta allows. One run in four now goes to the present.
- **The Sync button works again.** Making the cron 15-minutely silently disabled
  it: its throttle was also 15 minutes, so every press answered "already up to
  date". Now two minutes.
- **A full sweep of user-facing copy**, after three occasions where the code
  improved and the interface kept describing the old behaviour.

### Still open

8. **What a "day" means.** ANSWERED 2026-09-08, and the answer removes the
   choice. The app's per-day figures cannot be reproduced from the API by ANY
   window: Instagram's app shows 441 views for 31 August, and every 24-hour
   window from UTC-14 to UTC+10 returns 396 or 60, never 441. `views` ignores
   since/until entirely and snaps to Meta's own day; `reach` honours it. See
   `API-VERIFICATION.md` §6.8.

   **Corrected the same day, and the item is reopened in part.** The sweep
   proves we cannot re-bucket `views` through the API, because Meta will not
   return anything smaller than its own day for it. It does NOT prove the gap is
   unexplainable by a boundary shift: for `views` the window is ignored, so the
   sweep could not vary the thing it was testing. Per-day disagreement with
   monthly totals agreeing to 0.7% is precisely the shape a boundary shift has.

   The sentence has been added to the Overview regardless, since it is true
   today and cheaper said first than discovered by a client.

   - [ ] **Observe when the day-to-date `views` figure RESETS.** That hour is
         Meta's boundary, seen rather than inferred. One day of polling, and it
         may settle the whole question on its own.
   - [ ] Only if that is not enough: difference the 15-minute cron's readings
         into a sub-day series and re-sum it against the observed boundary.
         Forward only; nothing recovers 31 August.

9. **The Analysis page and the export.** DONE 2026-09-08. Four things the native
   app does not compute: when posts actually performed (not when followers are
   online), which days cost followers and what went out on them, how far a post
   travelled past the following it had at the time, and how few posts carry half
   the reach. Every bucket refuses a result below three posts and the timing
   panel stays silent below twelve, because an analysis cannot be checked against
   a phone the way a metric can.

   The CSV was rewritten. It had been exporting the literal text "null" for every
   unreported metric, which breaks SUM in the client's spreadsheet and reads as a
   broken product to whoever they forwarded it to. It now carries its own context
   (source, window, timezone, what a blank means), a summary with the discovery
   split and concentration, every stored day, every post with derived columns,
   and a definitions block — plus a UTF-8 BOM so Arabic captions survive Excel.

   - [ ] **Check the Discovery panel against Malek's account before the drinkat
         call.** `reach_non_followers` was null on every day ever stored as of the
         last audit. It is the most sponsor-relevant number in the product, and
         the summary line in the export quotes it.

**Carried into the pilot:** story capture (§6c) — built, never once verified,
zero stories captured to date.

**Parallel, blocking nothing:** Business Verification and App Review (§6), the
PDPL questions and legal-page placeholders (§0).

**Deferred:** everything in §7 — share-link expiry is the largest security gap —
plus TikTok (never worked live), the Facebook path, and LinkedIn.

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

## 6b. Open question — what our tokens can actually do

**Status: open. Partly answered, not settled. Do not repeat the claim to a
client until the audit has been run on a live token.**

This came up when asked, reasonably, whether a creator handing over access is
handing over control of an account they have spent years building. It deserves a
better answer than a policy paragraph.

**What is settled.**

- The OAuth flow requests exactly `instagram_business_basic` and
  `instagram_business_manage_insights`. Both read-only. A test asserts the list
  and rejects `business_management` and `instagram_business_content_publish`; a
  mutation adds a write scope and confirms the test fires.
- Meta enforces scopes server-side, so a token from that flow cannot publish,
  message, moderate or modify. Not "we choose not to" — the calls are refused.
- Every call the product makes maps to those two scopes. `API-VERIFICATION.md`
  §7.3 has the exhaustive table.

**What is NOT settled.**

- [ ] **Does a token issued by our OAuth flow inherit permissions granted
      earlier by other means?** The App Dashboard's "Generate token" button asks
      the operator to choose nothing and granted `publish content as a business`,
      `business message information` and `business comment information` on
      `@heath_ens21`. Whether an OAuth token issued afterwards carries those is
      unknown. Run `verify/audit-token.mjs --account <id>` against a live stored
      token to find out. **This is the one that matters** — if tokens do inherit,
      the read-only claim is wrong as stated and the design needs revisiting.
- [ ] **Revoke the excess on `@heath_ens21`** (Instagram → Settings → Apps and
      websites → toggles), then re-run the audit and confirm the write-gated
      endpoints go from whatever they were to refused. That second run is the
      demonstration to give a client.
- [ ] **Confirm nothing breaks after revoking.** `comments_count` is a media
      field under `basic`, so revoking comment access should cost nothing — but
      `comments: m.comments_count ?? 0` means a field that stopped arriving would
      read as **0 comments, not unknown**. A quiet failure. Verify on an account
      with real posts and real comments.
- [ ] **Decide the standing policy on dashboard-generated tokens.** They are
      long-lived (60 days), broader than OAuth tokens, and not constrained by
      anything in this codebase. Current thinking: use for probing, then let
      expire and never treat as equivalent to a user token.
- [ ] **Write the client-facing answer** once the above is done: the scope list,
      what each is for, what the token cannot do, and that the audit can be run
      in front of them. Against tools that ask for a password, this is the
      strongest thing the product can say — which is exactly why it must be true
      before it is said.

**Why this is open-ended rather than a task with a tick box.** The honest answer
today is "provably read-only by request, not yet verified by audit on a live
token." That gap is small but real, and the difference between those two
sentences is the difference between a claim and evidence.

## 6c. MISSING FEATURE — "how is this post doing right now?"

**Raised 2026-09-06. This is a product gap, not a bug, and it may be the most
valuable thing not yet built.**

The use case: a creator posts something, wants to know within the hour whether it
is working, and decides whether to keep it, boost it, or delete and repost at a
better time. That decision has a deadline measured in hours. Nothing in
PulseBoard serves it today.

### What exists now

- `content` rows are written **only** by the scheduled sync — hourly at best,
  and only if that account comes up in the batch.
- The media fetch takes the **25 most recent posts** with no pagination.
- There is **no way to refresh a single post on demand.** No endpoint, no button.
- **Stories are not synced at all.** No `media_product_type`, no `/me/stories`
  call, nothing. They are absent from the schema, the sync and the UI.

### What the API can actually do — verified live, 2026-09-06

- **`/me/stories` works.** Returned an active story on the first call. Stories
  are available on this API path and we are simply not asking.
- **One post's complete metrics arrive in ONE call.** `/me/media` with
  `insights.metric(reach,saved,shares,views)` returned reach 846, views 1610,
  likes 81, saved 0, shares 4 for a single item. A per-post refresh costs one
  request, not a sync.

### Why this is not just "run the sync more often"

The daily-metrics sync is heavy — about five calls per day of history — which is
what forces `IG_DAY_BUDGET` and the multi-run backfill. **A single post refresh
is one call.** They are different shapes of work and should not share a path:
making the whole sync real-time is impossible, making one post real-time is
trivial.

### STORIES ARE PERISHABLE — this is the urgent half

A story is gone after 24 hours, **and so are its insights**. A post's numbers can
be backfilled two years later; a story's cannot be recovered at all once it
expires. Every hour without story capture is data permanently lost for any
connected account.

That also makes stories the strongest argument for a real cron: a missed post
sync self-heals through the trailing re-fetch, a missed story window does not.

### Design sketch, to be decided

- [ ] **Per-post refresh.** A control on Content and on a post detail view that
      calls a new endpoint, does the single live fetch and updates that row.
      Costs one API call. Should be rate-limited per account.
- [ ] **A "just posted" view.** The newest item, with its numbers and its age,
      and honest treatment of a post too young to judge.
- [ ] **Story capture.** `/me/stories` on a schedule frequent enough to catch
      them before expiry, plus story rows in the schema. Decide the cadence
      against the 24-hour window, not against the daily sync's cadence.
- [ ] **Pagination past 25 posts**, or a documented statement that Content shows
      the most recent 25.

### A view per post or story — the shape the operator asked for

Content today is a flat sortable table: one row per post, columns for views,
reach, likes, comments, shares, saves, watch time and retention. The only click
target is a column header, for sorting. **There is no per-item view**, no route,
no drill-down.

- [x] A route per item — `/content/:id`. DONE 2026-09-07. Every metric can say
      "not reported", nothing is judged before 24 hours, and each figure sits
      beside the median for the SAME format with its sample size shown.
- [ ] The **Refresh** control on that page, doing the single live call. Not yet
      built — it needs a new endpoint, and it is what makes the page answer
      "how is it doing RIGHT NOW" rather than "as of the last sync".
- [x] Context, not just figures. DONE — postContext() compares against the
      MEDIAN of the same format, never the mean: this account has a reel at 4.8M
      views against a typical few thousand, and a mean would make its entire
      normal output look like failure.
- [ ] Stories need their own shape. They are not posts: no permalink worth
      showing, a 24-hour life, and different metrics.

### BLOCKER for this feature: content columns cannot express "unknown"

```sql
views  bigint not null default 0,
reach  bigint not null default 0,
saves  bigint not null default 0,
```

Every metric on `content` is `not null default 0`, so a post Instagram has not
reported on is stored as **0** and is indistinguishable from a post that genuinely
reached nobody. `metrics_daily` was deliberately made nullable for exactly this
reason; `content` never was.

This is the same fabricated-zero defect fixed three times on 2026-09-06, except
it lives in the schema rather than the display, so **no UI change can fix it** —
it needs a migration making these columns nullable, and a sync that writes null
rather than `?? 0`.

It bites hardest precisely where this feature goes. A post published twenty
minutes ago is the case where Instagram reports nothing yet, so a detail view
built on the current schema would tell a creator their new post reached **0
people** — the single most damaging wrong number the product could show, at the
exact moment they are deciding whether to delete it.

**Do the migration first. The feature is not safe to build on these columns.**

### How real-time can it honestly be?

The API answers immediately, but **Instagram's own insight numbers lag** — a
post minutes old may report zeros or partial figures through the API and in
Instagram's own app alike. So "live" means as fresh as Instagram will admit to,
not as fresh as reality.

That must be shown honestly. A post twenty minutes old reading `reach 0` is not
a failed sync and must not look like one — and, per the rule this project keeps
relearning, must not be rendered as a confident zero either.

---

## 6e. ANSWERED 2026-09-08 — which day a number belongs to

**Closed. The question below turned out to have no answer available, which is
itself the answer.** The app's per-day figure cannot be reproduced from the API
under any 24-hour window, so aligning to it is not a choice between conventions,
it is not achievable. See `API-VERIFICATION.md` 6.8 and item 8 of the board
above. The material below is kept as the record of how the question was framed
before it was settled; the open checkboxes in it are superseded except the last,
which is a support matter and still stands.

The product now states the difference in the interface rather than waiting to be
asked: a line under the Overview says daily figures come from Instagram's data
feed, the app computes its own, and monthly totals agree to about 1%.

### What is now known

Meta buckets this account's insights on a **UTC-7** boundary while the account
sits at **UTC+3** (Amman). The sync detects the mismatch and re-fetches per day
against the account's own offset:

```
sync.day_boundary_mismatch  account_offset_hours: 3  meta_offset_hours: -7
```

Two accounts have reported -7, both operated from Jordan, which points at the
boundary being fixed platform-side rather than following the account. That is
not proven — a third account could still say otherwise.

### What was verified on 2026-09-06/07, and what was NOT

The gate passed **on 30-day aggregates**: views within 0.7%, interactions within
7%, net followers exact. That validates the pipeline end to end.

**It does not validate per-day alignment.** Instagram's mobile date picker is
offset by two days (selecting 17-18 August returns 15-16), so a per-day
comparison through the app is not trustworthy, and the one attempted looked
catastrophically wrong when nothing was. **Per-day correctness remains
unverified**, and totals agreeing is compatible with individual days being
shifted and cancelling out.

### The open question, which is a product decision not a bug

Our days are **Amman days**. Instagram's app appears to show **Meta's buckets**.
Both cannot be labelled "Monday" for the same client.

- Amman days are what a Jordanian creator means by a day, and what a sponsor
  report should say.
- Meta's buckets are what the client sees in their own app, and **the client
  will trust their app over us.**

Totals agree either way. Individual days will not. A creator who posts on a
schedule and checks "how did Tuesday do?" will notice.

- [ ] **Verify per-day alignment by a route that avoids the broken picker.**
      Per-post insights carry their own timestamps, or compare a day with a very
      distinctive value against the app's own chart rather than its range picker.
- [ ] **Decide what a "day" means in the product**, and say so in the UI. Options:
      label days in the account's timezone and explain the difference when a
      client asks; follow Meta's buckets so the app always agrees; or show both.
      Silence is the one option that guarantees an argument with a client.
- [ ] **Confirm whether the -7 boundary follows the account or is fixed
      platform-side**, with a third account. This changes whether the offset is
      per-account configuration or a global assumption.
- [ ] **Pre-empt the picker bug with clients.** Instagram's own app returns the
      wrong range when a custom range is selected. A client comparing our figures
      to their app that way will conclude WE are wrong. Decide how support
      answers this before a client hits it.

---

## 6d. PARKED — hosting, sync depth and what it costs

**Parked 2026-09-06 to return to. Nothing here blocks the reconciliation gate.**

Netlify paused production deploys mid-session when build credits ran out, pinning
the live site to a commit that still contained the follows/unfollows defect. The
code is now ported to Cloudflare Pages and Workers (`927f228`) and builds
cleanly, but **nothing is deployed and no Cloudflare account is connected.**

**Where it stands.**

- A `pulseboard` Pages project was created on the personal Cloudflare account and
  **deleted again** — that account serves other clients' sites and should not
  host this. No secrets were set, no domain attached, no DNS changed.
- The domain `theoffice.it.com` already sits on that account's Cloudflare DNS
  (`handbook.theoffice.it.com` runs there), so a project on a *separate* account
  would need a CNAME from the existing zone rather than a zone move.

**The limit that actually matters, measured.**

Request volume is a non-issue — the account runs at ~1.3% of the free 100k/day.
The binding constraint is **50 subrequests per invocation on Workers Free**, and
a sync run at `IG_DAY_BUDGET=10` makes ~57. Roughly `7 + 5 x days`:

| DAY_BUDGET | Subrequests | Fits free tier |
|---|---|---|
| 10 | ~57 | no |
| 8 | ~47 | barely |
| 7 | ~42 | yes, with headroom |

**This cannot be optimised away.** Three of the four daily metrics — `views`,
`total_interactions`, `follows_and_unfollows` — are `total_value` only: Meta
returns one aggregate for any range, so a per-day series requires a call per day.
Only `reach` supports `time_series`, and its buckets come back on Meta's own day
boundary (UTC-7 for a Jordanian account), which is the defect `CLAUDE.md`
forbids reintroducing. The call volume is the price of correct dates.

**What it buys.** Insights go back **two years** (§6.7), about 3,650 calls:

| Tier | Subrequests | DAY_BUDGET | Runs | At hourly cron |
|---|---|---|---|---|
| Free | 50 | 7 | ~104 | ~4 days |
| Paid, $5/mo | 10,000 | 100+ | ~8 | ~8 hours |

Free does not prevent a deep backfill; it decides how long a new client waits to
see their own history. Two years is a genuine differentiator — the Instagram app
shows only a rolling window, so a creator cannot see their own campaign from last
year, and we could.

**Open decisions:**

- [ ] Which Cloudflare account hosts this — separate one for isolation and
      billing clarity, or the existing one. **Not a capacity question**; the
      subrequest cap is per plan, so a second free account changes nothing.
- [ ] Free at `IG_DAY_BUDGET=7`, or $5/month. Recommendation: ship free now,
      pay when there is a paying client and a deep backfill is worth an
      afternoon instead of four days.
- [ ] Deploy, set secrets, deploy `worker-cron`, then move DNS. The Meta OAuth
      redirect URI does not change, but the callback breaks until DNS cuts over,
      so do it before touching a client's account.
- [ ] Decide whether the sync should fail loudly when a run approaches the
      subrequest cap, rather than being discovered later as a partial sync.

## 7. Known gaps, deliberately deferred

- [ ] Share-link expiry and revocation — **not built.** See §0.
- [ ] Retention purge job — **not built.** See §0.
- [ ] Queue-backed sync. The hourly cron is fine to a few hundred accounts.
- [ ] PWA polish: manifest, icons, installability.
- [ ] DPO question under the PDPL; counsel sign-off on the legal pages.
- [ ] A standing watch on Meta's deprecation schedule. `CLAUDE.md` calls this a
      permanent tax on the product, and its absence caused most of the audit
      findings.
