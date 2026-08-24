# Lead auditor's own findings (independent of the agent fleet)

## L1. The daily cron freezes every day at ~6 hours of data. P0, CONFIRMED.

`backfillStart()` (netlify/functions/_sync.ts) fetches only days AFTER the newest stored row.
Proved by replicating the real function in scratchpad/backfill-proof.mjs:

```
cron on 2026-08-20: start=2026-07-22 -> refetches 30 days   (initial backfill, complete days)
cron on 2026-08-21: start=2026-08-21 -> refetches 1 day
cron on 2026-08-22: start=2026-08-22 -> refetches 1 day
cron on 2026-08-23: start=2026-08-23 -> refetches 1 day
each day written exactly 1x, on the day itself
```

`sync-cron.ts:34` runs at `0 6 * * *`. So each day is written once, at 06:00 UTC, containing at
most the first 6 hours of that day, and is never revisited. Platform insight values also settle
for hours-to-days after the fact, so even those 6 hours are provisional.

Worse branch: `days` is built as `reach: reachByDate[date] ?? 0` (_sync.ts ~line 117). Any day the
platform does not return a value for — very likely including the current, incomplete day — is
written as **0** and frozen at 0 forever.

Client-visible effect: the first 30 backfilled days are complete; every day after they connect is
~25% of truth or zero. The chart shows a cliff at the connection date. The anomaly detector
(src/lib/analytics.ts:51) then fires a "Reach dropped" alert at the boundary, and the AI assistant
repeats it as fact. A client concludes their reach collapsed the day they started using PulseBoard.

Fix: always re-fetch a trailing window (>= 7 days) on every sync rather than only the gap; upsert
overwrites, so this is cheap and self-healing. Additionally: distinguish "platform returned 0" from
"platform returned nothing" — never write a fabricated 0 into a metric column. Consider a
`settled_at`/`provisional` marker so the UI can mark the current day as incomplete.

## L2. Content is never filtered by the selected date range. P1, CONFIRMED.

`fetchContent()` (src/lib/api.ts:38) selects the top 200 posts by views across ALL time, with no
date predicate. `Content.tsx:32` then filters by platform only. So:

- the Content page shows all-time posts while the header controls say "Last 7 days";
- `buildCsv()` (src/lib/reports.ts) writes `Window,7 days` and then lists all-time content;
- `buildSnapshot()` (src/lib/snapshot.ts:194) puts all-time top posts into a report headed
  "last 7 days", including the public share link;
- `summarizeForAI()` (src/lib/analytics.ts:128) feeds all-time top posts to the assistant as the
  window's top performers, so it will attribute an 8-month-old viral post to this week.

A client sends a sponsor a "last 7 days" report featuring a post from last year. Fix: filter content
by `published_at` against the range wherever the range is claimed, and fetch content per range.

## L3. CSV export is vulnerable to formula injection. P1, CONFIRMED.

`esc()` (src/lib/reports.ts:108) only wraps in quotes and doubles inner quotes. Quoting does not
stop Excel/Sheets from evaluating a field that begins with `=`, `+`, `-`, `@`, tab or CR. Post
titles come from platform captions, and these CSVs get emailed to sponsors and brands.

Fix: prefix any value beginning with those characters with a single quote (or a leading space) on
export, in addition to quoting.

## L4. `download()` revokes the object URL synchronously. P3, LIKELY.

src/lib/reports.ts:105 calls `URL.revokeObjectURL` immediately after `a.click()`, which can race the
download in some browsers and produce an empty file. Defer with `setTimeout(..., 0)` or longer.

## L5. Checked and NOT a bug (recorded so nobody re-raises it)

`buildCsv` uses `seriesByDay(..., "followers")` while the dashboard uses `followersByDay()`. These
look inconsistent but agree, because `metrics_daily`'s primary key is `(account_id, date)` so there
is exactly one row per account per day and both reduce to the same per-day sum.
