-- ===========================================================================
-- 0008 — the numbers a sponsor actually asks about
--
-- Every column here is nullable, and that is the invariant, not an oversight:
-- NULL means the platform did not report it. A zero would mean "we reached
-- nobody", and writing one where we mean "we do not know" is how a rate-limit
-- response once erased thirty days of a client's history. See CLAUDE.md §5.
--
-- WHAT THIS UNLOCKS, AND WHY IT IS WORTH A MIGRATION
--
-- follows / unfollows — gross, not net.
--   `netFollowDelta()` already parsed both directions out of the
--   follows_and_unfollows breakdown and then threw them away, returning only the
--   difference. "+20" and "gained 412, lost 392" are the same net and completely
--   different businesses. The second one is a retention problem you can act on;
--   the first is a number that looks fine. The data was already being fetched.
--
-- reach_followers / reach_non_followers — the discovery split.
--   From reach's `follow_type` breakdown. This is the number a sponsor is
--   actually buying: reach among people who do NOT already follow the account is
--   new audience, and reach among existing followers is not. Consumer tools
--   almost never separate them, and a creator who can show "63% of last month's
--   reach was non-followers" is negotiating from a different position than one
--   showing a follower count.
--
-- Their sum is NOT constrained to equal `reach`. Meta returns an UNKNOWN bucket
-- alongside FOLLOWER and NON_FOLLOWER, and its own documentation warns that
-- summing a breakdown may come to less than the total. A constraint asserting
-- otherwise would fail on correct data.
-- ===========================================================================

alter table pulseboard.metrics_daily
  add column if not exists follows              bigint,
  add column if not exists unfollows            bigint,
  add column if not exists reach_followers      bigint,
  add column if not exists reach_non_followers  bigint;

comment on column pulseboard.metrics_daily.follows is
  'Gross new follows on this day. NULL = not reported. Net growth is '
  'follows - unfollows; storing only the net hides churn.';
comment on column pulseboard.metrics_daily.unfollows is
  'Gross unfollows on this day. NULL = not reported.';
comment on column pulseboard.metrics_daily.reach_non_followers is
  'Reach among accounts that do not follow this one — the discovery half of '
  'reach, and the half a sponsor is paying for. NULL = not reported. Does not '
  'sum with reach_followers to reach: Meta also returns an UNKNOWN bucket.';

-- Counts, so negative values are always a parsing fault rather than real data.
-- Follower LOSS is carried by `unfollows` being positive, never by a negative
-- `follows`. Without this a sign error would quietly invert a growth chart.
alter table pulseboard.metrics_daily
  drop constraint if exists metrics_daily_counts_non_negative;
alter table pulseboard.metrics_daily
  add constraint metrics_daily_counts_non_negative check (
    (follows             is null or follows             >= 0) and
    (unfollows           is null or unfollows           >= 0) and
    (reach_followers     is null or reach_followers     >= 0) and
    (reach_non_followers is null or reach_non_followers >= 0)
  );
