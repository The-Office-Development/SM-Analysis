# Verification harness

Runs the **real, unmodified** sync and OAuth code against a mocked platform API, so the
integration can be exercised end to end without a live Meta connection (which needs App
Review, a linked Facebook Page, and an unflagged business account).

Only `globalThis.fetch` is faked. Nothing under `netlify/`, `src/`, or `supabase/` is touched.

```bash
npm install          # once
bash verify/run-all.sh            # sync: populated, empty, and failure scenarios
bash verify/run-oauth.sh          # OAuth callback: happy path + every failure mode
bash verify/run-frontend-empty.sh # frontend against a connected-but-empty account
```

Everything should print `PASS` / `ok` and exit 0.

## What each suite covers

**`run-all.sh`** — `syncAccount()` for Instagram against mocked Graph API responses:
a populated account, an account with no posts and permission-gated insights, incremental
gap-fill on a second sync, and Meta rejecting the profile call outright.

**`run-oauth.sh`** — `oauth-meta-callback.ts` end to end: token exchange, long-lived token
swap, Page + linked Instagram discovery, and the rows written for each. Also every failure
mode: no Pages, tampered state (same and differing length), empty signature, missing dot,
expired state, missing code, and a provider error.

**`run-frontend-empty.sh`** — the real `src/lib` aggregation and `src/components` charts
rendered against an account whose metric rows exist but are all zero, plus the ragged-series
case where one platform has 30 days of rows and another has none.

## Regressions these lock down

- Follower reconstruction stepping below zero when `follower_count` deltas exceed the
  current total (`follower_count` reports gross new follows, not net change).
- Engagement rate reading in the hundreds of percent when the account-level
  `total_interactions` metric is permission-gated.
- `Infinity%` reaching the DOM from a zero denominator in the engagement funnel.
- `LineChart` throwing when a later series is shorter than the first.
- A malformed OAuth `state` crashing the callback via `timingSafeEqual`'s length check
  instead of redirecting with `bad_state`.
- The callback reporting Instagram as connected when only Facebook Pages were linked.
