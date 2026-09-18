-- When each account last had its turn in the scheduled sync's queue.
--
-- Measured 2026-09-18 from the Worker's own log: every 15-minute cron run
-- synced the first account and then FAILED the second with "Too many
-- subrequests by single Worker invocation". Cloudflare's free plan gives one
-- invocation 50 outbound requests; one Instagram account uses about 27 calls
-- plus its database reads and writes. The failure could not even be recorded,
-- because the sync_log insert is a request too, so sync_log showed zero
-- failures while half of all runs failed, and the run still returned 200.
--
-- The fix is one account per invocation, with the cron firing every minute and
-- taking only accounts that are due. That needs a queue position that moves
-- whether or not the run succeeds:
--
--   last_synced_at     moves only on SUCCESS. Ordered by it, an account that
--                      fails every time stays at the front forever and, with
--                      one account per run, takes every slot.
--   sync_turn_at       moves when the account is TAKEN, before its run starts,
--                      so a run that dies part-way (the subrequest cap, a
--                      Worker kill) still sends it to the back of the queue.
--                      A LinkedIn page skipped for its own daily call limit has
--                      had its turn too.
--
-- Null = never had a turn, which sorts first.

alter table pulseboard.social_accounts add column if not exists sync_turn_at timestamptz;

comment on column pulseboard.social_accounts.sync_turn_at is
  'When the scheduled sync last took this account, successful or not. Queue
   order for the cron; not a freshness claim (that is last_synced_at).';

create index if not exists idx_accounts_sync_turn
  on pulseboard.social_accounts (sync_turn_at nulls first) where status = 'connected';

insert into pulseboard.schema_migrations (version) values ('0022_sync_turn')
  on conflict (version) do nothing;
