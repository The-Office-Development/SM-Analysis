-- ===========================================================================
-- 0001 — audit remediation
--
-- Run migrations IN ORDER, once each, and record which have been applied.
-- Re-running supabase/schema.sql does NOT apply changes: every statement in it
-- is `create table if not exists`, so the second edit is a silent no-op that
-- leaves deployed code hitting PGRST204 against a schema that never changed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Metrics must be able to say "unknown".
--
-- Previously every column was `bigint not null default 0`, so a failed or
-- throttled API call was written to the database as a real zero, overwriting
-- good data and then marked synced so it was never refetched. A metric the
-- platform did not report is now NULL, and NULL is never written over a value.
-- ---------------------------------------------------------------------------
alter table pulseboard.metrics_daily alter column followers   drop not null;
alter table pulseboard.metrics_daily alter column followers   drop default;
alter table pulseboard.metrics_daily alter column reach       drop not null;
alter table pulseboard.metrics_daily alter column reach       drop default;
alter table pulseboard.metrics_daily alter column impressions drop not null;
alter table pulseboard.metrics_daily alter column impressions drop default;
alter table pulseboard.metrics_daily alter column views       drop not null;
alter table pulseboard.metrics_daily alter column views       drop default;
alter table pulseboard.metrics_daily alter column engagements drop not null;
alter table pulseboard.metrics_daily alter column engagements drop default;

-- A day is provisional until the platform's numbers have settled; the UI must
-- be able to mark it rather than present a partial day as a drop.
alter table pulseboard.metrics_daily add column if not exists provisional boolean not null default true;
alter table pulseboard.metrics_daily add column if not exists updated_at timestamptz not null default now();

-- The timezone the account's own day boundaries follow. Without it, `end_time`
-- cannot be resolved to a calendar date and every day is filed one day out for
-- accounts at a non-positive UTC offset.
alter table pulseboard.social_accounts add column if not exists timezone_name text;
alter table pulseboard.social_accounts add column if not exists timezone_offset_hours numeric;

-- ---------------------------------------------------------------------------
-- 2. Provider identities — the long-lived USER token.
--
-- Only per-Page tokens were stored, so revoking the app's access
-- (DELETE /{user-id}/permissions), refreshing, and re-discovering Pages were
-- all impossible. Service-role only: no client policies, same as account_secrets.
-- ---------------------------------------------------------------------------
create table if not exists pulseboard.provider_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('meta','tiktok')),
  external_user_id text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_user_id)
);
alter table pulseboard.provider_identities enable row level security;
-- intentionally NO policies: only the service-role key bypasses RLS.

alter table pulseboard.social_accounts
  add column if not exists identity_id uuid references pulseboard.provider_identities on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Sync log — so a failed sync leaves an artefact a human can find.
--
-- Never store token material here. Owner-readable so a client can see when
-- their data was last refreshed and whether it failed.
-- ---------------------------------------------------------------------------
create table if not exists pulseboard.sync_log (
  id bigserial primary key,
  account_id uuid references pulseboard.social_accounts on delete cascade,
  user_id uuid references auth.users on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  calls int not null default 0,
  rows_written int not null default 0,
  error_code text,
  error_message text
);
alter table pulseboard.sync_log enable row level security;
drop policy if exists "sync log owner read" on pulseboard.sync_log;
create policy "sync log owner read" on pulseboard.sync_log
  for select using (auth.uid() = user_id);
create index if not exists idx_sync_log_account on pulseboard.sync_log (account_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 4. Close the forward-looking privilege hole.
--
-- `alter default privileges ... grant all to anon` in schema.sql means any table
-- created later is world-writable the moment someone forgets one RLS line.
-- Future tables must be granted explicitly instead.
-- ---------------------------------------------------------------------------
alter default privileges in schema pulseboard revoke all on tables from anon, authenticated;
alter default privileges in schema pulseboard revoke all on sequences from anon, authenticated;

-- Clients read their own rows; all writes go through the service role.
revoke all on pulseboard.metrics_daily      from anon, authenticated;
revoke all on pulseboard.content            from anon, authenticated;
revoke all on pulseboard.audience_snapshots from anon, authenticated;
revoke all on pulseboard.social_accounts    from anon, authenticated;
revoke all on pulseboard.report_shares      from anon, authenticated;
grant select on pulseboard.metrics_daily      to authenticated;
grant select on pulseboard.content            to authenticated;
grant select on pulseboard.audience_snapshots to authenticated;
grant select on pulseboard.social_accounts    to authenticated;
grant select on pulseboard.sync_log           to authenticated;
-- Report shares stay owner-managed from the client; goals remain fully client-managed.
grant select, insert, delete on pulseboard.report_shares to authenticated;

-- Accounts are created and mutated only by the service role now (the client used
-- to hold `for all`, which let a tenant bulk-insert rows into the shared cron).
drop policy if exists "accounts owner all" on pulseboard.social_accounts;
create policy "accounts owner read" on pulseboard.social_accounts
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Indexes matching the real query patterns.
-- ---------------------------------------------------------------------------
-- idx_metrics_account_date duplicated the primary key; date-ranged scans need date.
drop index if exists pulseboard.idx_metrics_account_date;
create index if not exists idx_metrics_date on pulseboard.metrics_daily (date);
create index if not exists idx_content_published on pulseboard.content (account_id, published_at desc);
create index if not exists idx_audience_captured on pulseboard.audience_snapshots (account_id, captured_on desc);
