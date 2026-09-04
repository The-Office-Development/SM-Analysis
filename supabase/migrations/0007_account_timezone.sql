-- ===========================================================================
-- 0007 — the day boundary becomes an explicit property of the account
--
-- THE DEFECT
-- `offsetFrom()` learned the account's UTC offset by reading `end_time` off a
-- `metric_type=time_series` response. That is the right way to READ Meta's
-- buckets, and the wrong way to DECIDE what a day is.
--
-- The first live call, 2026-09-04, returned:
--
--     {"value":0,"end_time":"2026-08-29T07:00:00+0000"}
--
-- 07:00 UTC is midnight US Pacific. Midnight in Amman is 21:00 UTC the previous
-- day. So the sync derived -7, requested its per-day `total_value` windows on a
-- Pacific boundary, and every daily figure for a Jordanian account covered
-- 10:00 to 10:00 Amman time. Nothing errored. The numbers were simply for a
-- different day than the label said — which is precisely the failure this
-- project treats as worse than an outage.
--
-- THE FIX
-- A day is a property of the ACCOUNT, not of whatever timezone Meta happens to
-- aggregate in. It is stored here, and every daily window is built from it.
--
-- Default 180 = UTC+3, Asia/Amman. Jordan has no DST, so a fixed offset is
-- exact rather than an approximation — see PROJECT-STATE.md §1. Minutes rather
-- than hours because half-hour zones exist (Tehran +3:30, Delhi +5:30) and a
-- Jordanian agency may well have Gulf or South Asian clients.
--
-- This is deliberately NOT nullable and NOT inferred. An account whose timezone
-- nobody set is an account whose numbers nobody can defend, so it gets the
-- operator's own zone and a visible column rather than a silent guess.
-- ===========================================================================

alter table pulseboard.social_accounts
  add column if not exists tz_offset_minutes int not null default 180;

comment on column pulseboard.social_accounts.tz_offset_minutes is
  'Minutes east of UTC defining this account''s calendar day. Every daily metric '
  'window is built from this. Default 180 (Asia/Amman, no DST). NOT derived from '
  'the platform''s own bucketing: see migration 0007 and API-VERIFICATION.md 6.2.';

-- A sanity bound. Real offsets run -12:00 to +14:00; anything outside that is a
-- typo or a units mix-up (hours entered where minutes belong), and both would
-- silently shift every number this account reports.
alter table pulseboard.social_accounts
  drop constraint if exists social_accounts_tz_offset_sane;
alter table pulseboard.social_accounts
  add constraint social_accounts_tz_offset_sane
  check (tz_offset_minutes between -720 and 840);
