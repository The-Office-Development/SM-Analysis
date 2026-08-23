# Data-integrity defects in the sync

Companion to [`LAUNCH-AUDIT.md`](LAUNCH-AUDIT.md). That document covers whether the integration is
*allowed* to run and whether it is *safe*. This one covers a separate and equally serious question:
**when it does run, are the numbers right?**

They are not. Three defects are demonstrated numerically by the scripts in
[`verify/proofs/`](../verify/proofs/), each of which drives the real `syncAccount()` against a mock
whose correct answer is known in advance. All three are silent — nothing errors, no test fails, and
the dashboard renders a confident, wrong chart.

These matter more than they look. A client comparing PulseBoard against the native Instagram or
Facebook insights app will find that every single day disagrees. That is how trust is lost, and it
is not recoverable by fixing the bug afterwards — the historical rows stay wrong until backfilled.

---

## D1. Every day after connection is frozen at ~6 hours of data. P0, CONFIRMED.

`backfillStart()` in `netlify/functions/_sync.ts` fetches only days *after* the newest stored row.
`verify/proofs/p3-frozen-days.mjs` replicates it across four consecutive cron runs:

```
cron on 2026-08-20: start=2026-07-22 -> refetches 30 days   (initial backfill: complete days)
cron on 2026-08-21: start=2026-08-21 -> refetches 1 day
cron on 2026-08-22: start=2026-08-22 -> refetches 1 day
cron on 2026-08-23: start=2026-08-23 -> refetches 1 day

each day written exactly 1x, on the day itself
```

`sync-cron.ts:34` fires at `0 6 * * *`. So each day is written once, at 06:00 UTC, holding at most
the first six hours of that day — and is never revisited. Platform insight values also keep settling
for hours or days after the fact, so even those six hours are provisional.

Worse branch: days are built as `reach: reachByDate[date] ?? 0` (`_sync.ts` ~line 117). Any day the
platform does not return a value for — very likely including the current, incomplete day — is
written as a fabricated **0** and frozen at 0 permanently.

**What the client sees.** Thirty complete days of backfilled history, then a cliff at the moment they
connected, with every subsequent day at a fraction of truth or zero. The anomaly detector
(`src/lib/analytics.ts:51`) fires "Reach dropped" at that boundary, and the AI assistant repeats it
as fact. A client reasonably concludes their reach collapsed the day they started using PulseBoard.

**Fix.** Always re-fetch a trailing window (at least 7 days) on every sync rather than only the gap;
the upsert overwrites, so this is cheap and self-healing. Separately, never write a fabricated `0`:
distinguish "the platform returned 0" from "the platform returned nothing", and mark the current
day provisional so the UI can render it as incomplete rather than as a drop.

---

## D2. Every daily metric is filed under the wrong date for accounts at UTC offset ≤ 0. P0, CONFIRMED*

`seriesFromInsight()` (`_sync.ts`) keys each value by `v.end_time.slice(0, 10)`. Meta's `end_time`
is the **end** of the period — local midnight at the start of the *following* day, expressed in UTC.
For an account at a non-positive UTC offset that instant falls on the next calendar date, so day D's
value is stored under D+1.

`verify/proofs/p1-date-shift.mjs` plants a known reach value per day and reports what was stored:

| Account timezone | Offset | Rows wrong |
|---|---|---|
| America/Los_Angeles (PDT) | −7 | **30 / 30** |
| America/New_York (EDT) | −4 | **30 / 30** |
| UTC (Accra, London in winter) | 0 | **30 / 30** |
| Europe/London (BST) | +1 | 0 / 30 |
| Asia/Tokyo (JST) | +9 | 0 / 30 |

```
2026-08-23: stored reach=1022  true=1023  WRONG (this is the value for 2026-08-22)
```

So the entire Americas — where most large creator accounts are — gets every day shifted by one.
Window totals stay almost right (they differ only at the edges, 0.00% here), which is exactly why
this survives review: the headline number looks fine while every point on the chart is wrong.

**Consequences.** Day-level charts are off by one; anomaly alerts fire on the wrong date; day-of-week
analysis is shifted; and every day disagrees with the client's native insights app. It also compounds
D1: on the incremental path the single day written holds the *previous* day's value under today's
date.

**Fix.** Read each account's timezone (`timezone_id` / `timezone_offset_hours_utc` on the Page,
and the IG account's own setting), convert `end_time` to that timezone before taking the date, and
store the account timezone alongside the row so the frontend can label it. Decide explicitly whether
the product reports in account-local time (right for "best time to post") or a single reporting
timezone, and state it in the UI.

\* CONFIRMED against Meta's *documented* `end_time` convention, which the proof models. Validate
against one real Graph API response before acting — see `verify/proofs/README.md`.

---

## D3. "Best time to post" tells US accounts the wrong day. P0, CONFIRMED*

The same day-boundary error propagates through `bucketOnline()` (`_sync.ts`, which buckets by
`getUTCDay()` and uses the hour keys verbatim) into `activeGrid()` / `bestTimes()`
(`src/lib/analytics.ts:15-39`). `verify/proofs/p2-best-time.mjs` plants an audience that genuinely
peaks **Saturday 20:00 local** and asks the Planner what it advises:

| Account | Truth | App advises |
|---|---|---|
| America/Los_Angeles (PDT) | Saturday 8pm | **Sunday · 8pm** |
| Asia/Tokyo (JST) | Saturday 8pm | Saturday · 8pm ✓ |
| Europe/London (BST) | Saturday 8pm | Saturday · 8pm ✓ |

Note also the spurious `12am` / `1am` windows that appear in every account's top three — an artifact
of summing across the day boundary — and that the UI states no timezone at all next to the
recommendation, so even a correct hour is ambiguous.

This is the most action-driving feature in the product: it is advice a client will actually follow,
and for US accounts it names the wrong day.

**Fix.** As D2, plus label every recommendation with the timezone it is expressed in, and suppress
windows whose support comes from fewer than N observed days.

---

## D4. Content is never filtered by the selected date range. P1, CONFIRMED.

`fetchContent()` (`src/lib/api.ts:38`) selects the top 200 posts by views **across all time**, with
no date predicate, and `Content.tsx:32` then filters by platform only. The range control does not
reach it. So:

- the Content page shows all-time posts while the header says "Last 7 days";
- `buildCsv()` writes `Window,7 days` and then lists all-time content (`src/lib/reports.ts`);
- `buildSnapshot()` puts all-time top posts under a "last 7 days" heading — including in the
  **public share link** (`src/lib/snapshot.ts:194`);
- `summarizeForAI()` feeds them to the assistant as the window's top performers
  (`src/lib/analytics.ts:128`), so it will attribute a post from eight months ago to this week.

A client sends a sponsor a seven-day report headlined by last year's viral post.

**Fix.** Filter content by `published_at` against the active range everywhere the range is claimed,
and fetch content per range rather than all-time.

---

## D5. CSV export is open to formula injection. P1, CONFIRMED.

`esc()` (`src/lib/reports.ts:108`) wraps in quotes and doubles inner quotes. Quoting does **not**
stop Excel or Google Sheets evaluating a field beginning with `=`, `+`, `-`, `@`, tab or CR. Post
titles come from platform captions, and these exports get emailed to sponsors and brands — so the
blast radius is the client's commercial contacts, not the client.

**Fix.** On export, prefix any value starting with those characters with a `'`, in addition to
quoting.

---

## D6. Checked and NOT a defect

Recorded so it is not re-raised: `buildCsv` uses `seriesByDay(..., "followers")` while the dashboard
uses `followersByDay()`. These look inconsistent but agree, because `metrics_daily`'s primary key is
`(account_id, date)` — exactly one row per account per day — so both reduce to the same per-day sum.

---

## Why the existing test suite passes anyway

`verify/` asserts on shape, not truth: it scans for `NaN`, `Infinity`, negatives and thrown errors.
Every defect above produces a clean, plausible, finite number. D1 additionally passes because the
suite tests a *first* sync (30 complete days) and never simulates the second day's incremental run.

Any fix should land with the corresponding proof script promoted to an assertion, plus a test that
runs two consecutive syncs and checks that day one's value is corrected on day two.
