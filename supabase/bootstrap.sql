-- ==========================================================================
-- PulseBoard — full bootstrap for a NEW, EMPTY Supabase project.
--
-- GENERATED FILE. Do not edit. Rebuild with:
--     node supabase/build-bootstrap.mjs
--
-- Contains, in order:
--   1. supabase/schema.sql
--   2. supabase/migrations/0001_audit_fixes.sql
--   3. supabase/migrations/0002_token_refresh.sql
--   4. supabase/migrations/0003_deletion_and_consent.sql
--   5. supabase/migrations/0004_ai_usage.sql
--   6. supabase/migrations/0005_instagram_login.sql
--
-- >>> ONLY for a project with no data. <<<
-- Against an existing project, apply the numbered migrations one at a time and
-- record which you applied. schema.sql is `create table if not exists`
-- throughout, so re-running it after an edit does nothing — silently.
--
-- AFTER RUNNING THIS, one dashboard step is still required:
--   Project Settings -> API -> Exposed schemas -> add `pulseboard`
--   (keep `public` and `graphql_public`). Without it every request
--   returns PGRST106.
-- ==========================================================================

-- ==========================================================================
-- SOURCE: supabase/schema.sql
-- ==========================================================================

-- ===========================================================================
-- PulseBoard database schema  (run in Supabase -> SQL editor)
--
-- ISOLATED SCHEMA: everything lives in its own `pulseboard` schema so it can
-- safely share a Supabase project with your other apps without colliding with
-- their public.* tables. PulseBoard adds NOTHING to auth.users (no triggers),
-- so it cannot disturb any other app in the project.
--
-- Row-level security is ON everywhere. Users read ONLY their own data.
-- OAuth tokens live in account_secrets, which has NO client policies at all --
-- only the service-role key (used inside Netlify Functions) can touch it.
--
-- >>> ONE DASHBOARD STEP REQUIRED <<<
-- After running this, go to Supabase -> Project Settings -> API -> "Exposed
-- schemas" (a.k.a. Data API / schema list) and ADD `pulseboard` to the list
-- (keep `public`, `graphql_public`). Save. Without this the REST API returns
-- PGRST106 "schema must be one of ..." and the app can't read/write.
-- ===========================================================================

create schema if not exists pulseboard;

-- Let the API roles use the schema; RLS still gates every row. The service
-- role bypasses RLS (used only inside Netlify Functions).
grant usage on schema pulseboard to anon, authenticated, service_role;
grant all on all tables    in schema pulseboard to anon, authenticated, service_role;
grant all on all sequences in schema pulseboard to anon, authenticated, service_role;
alter default privileges in schema pulseboard grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema pulseboard grant all on sequences to anon, authenticated, service_role;

-- ---- social_accounts ------------------------------------------------------
create table if not exists pulseboard.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  platform text not null check (platform in ('facebook','instagram','tiktok')),
  external_id text not null,
  username text not null,
  display_name text,
  avatar_url text,
  status text not null default 'connected' check (status in ('connected','expired','revoked')),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (user_id, platform, external_id)
);
alter table pulseboard.social_accounts enable row level security;

drop policy if exists "accounts owner all" on pulseboard.social_accounts;
create policy "accounts owner all" on pulseboard.social_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- account_secrets  (SERVICE ROLE ONLY -- no policies = clients blocked) --
create table if not exists pulseboard.account_secrets (
  account_id uuid primary key references pulseboard.social_accounts on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  extra jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table pulseboard.account_secrets enable row level security;
-- intentionally NO policies: only the service-role key bypasses RLS.

-- ---- helper: does the current user own this account? ----------------------
create or replace function pulseboard.owns_account(acc uuid)
returns boolean language sql stable security definer set search_path = pulseboard as $$
  select exists (select 1 from pulseboard.social_accounts a where a.id = acc and a.user_id = auth.uid());
$$;

-- ---- metrics_daily --------------------------------------------------------
create table if not exists pulseboard.metrics_daily (
  account_id uuid not null references pulseboard.social_accounts on delete cascade,
  platform text not null,
  date date not null,
  followers bigint not null default 0,
  reach bigint not null default 0,
  impressions bigint not null default 0,
  views bigint not null default 0,
  engagements bigint not null default 0,
  primary key (account_id, date)
);
alter table pulseboard.metrics_daily enable row level security;
drop policy if exists "metrics owner read" on pulseboard.metrics_daily;
create policy "metrics owner read" on pulseboard.metrics_daily
  for select using (pulseboard.owns_account(account_id));

-- ---- content --------------------------------------------------------------
create table if not exists pulseboard.content (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pulseboard.social_accounts on delete cascade,
  platform text not null,
  external_id text not null,
  title text not null default '',
  media_type text not null default 'Post',
  permalink text,
  published_at timestamptz not null default now(),
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  reach bigint not null default 0,
  avg_watch_seconds int,
  retention_pct int,
  unique (account_id, external_id)
);
alter table pulseboard.content enable row level security;
drop policy if exists "content owner read" on pulseboard.content;
create policy "content owner read" on pulseboard.content
  for select using (pulseboard.owns_account(account_id));

-- ---- audience_snapshots ---------------------------------------------------
create table if not exists pulseboard.audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pulseboard.social_accounts on delete cascade,
  platform text not null,
  captured_on date not null,
  age jsonb not null default '{}',
  gender jsonb not null default '{}',
  countries jsonb not null default '{}',
  devices jsonb not null default '{}',
  active_hours jsonb not null default '[]',
  unique (account_id, captured_on)
);
alter table pulseboard.audience_snapshots enable row level security;
drop policy if exists "audience owner read" on pulseboard.audience_snapshots;
create policy "audience owner read" on pulseboard.audience_snapshots
  for select using (pulseboard.owns_account(account_id));

-- ---- goals (user-set targets) ---------------------------------------------
create table if not exists pulseboard.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  metric text not null check (metric in ('followers','reach','views','engagements')),
  scope text not null default 'all',   -- 'all' or a platform id
  target bigint not null check (target > 0),
  due_date date,
  created_at timestamptz not null default now()
);
alter table pulseboard.goals enable row level security;
drop policy if exists "goals owner all" on pulseboard.goals;
create policy "goals owner all" on pulseboard.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- report_shares (public read-only report links) -----------------------
-- The payload is a self-contained snapshot (no tokens, no raw rows). There is
-- deliberately NO anon select policy: the public /r/:slug page reads through a
-- Netlify function using the service-role key, so owners keep full control.
create table if not exists pulseboard.report_shares (
  slug text primary key,
  user_id uuid not null references auth.users on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table pulseboard.report_shares enable row level security;
drop policy if exists "shares owner all" on pulseboard.report_shares;
create policy "shares owner all" on pulseboard.report_shares
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- helpful indexes
create index if not exists idx_metrics_account_date on pulseboard.metrics_daily (account_id, date);
create index if not exists idx_content_account_views on pulseboard.content (account_id, views desc);
create index if not exists idx_goals_user on pulseboard.goals (user_id);
create index if not exists idx_shares_user on pulseboard.report_shares (user_id);

-- Re-assert grants for the tables just created (default privileges cover
-- future objects; this covers the ones in this script explicitly).
grant all on all tables    in schema pulseboard to anon, authenticated, service_role;
grant all on all sequences in schema pulseboard to anon, authenticated, service_role;

-- ==========================================================================
-- SOURCE: supabase/migrations/0001_audit_fixes.sql
-- ==========================================================================

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

-- ==========================================================================
-- SOURCE: supabase/migrations/0002_token_refresh.sql
-- ==========================================================================

-- ===========================================================================
-- 0002 — token refresh
--
-- Refresh cannot be added safely without a lock. TikTok rotates the refresh
-- token on every use, so two concurrent refreshes spend it twice and leave the
-- stored chain dead — the account then needs a full re-authorisation, and on a
-- daily cron that happens every day.
-- ===========================================================================

alter table pulseboard.provider_identities
  add column if not exists refresh_lock_at timestamptz,
  add column if not exists last_refresh_at timestamptz,
  add column if not exists refresh_failures int not null default 0;

create index if not exists idx_identities_expiry
  on pulseboard.provider_identities (expires_at nulls last);

-- ==========================================================================
-- SOURCE: supabase/migrations/0003_deletion_and_consent.sql
-- ==========================================================================

-- ===========================================================================
-- 0003 — deletion requests and consent
--
-- Meta's App Review requires a data-deletion callback that ACTUALLY deletes and
-- returns a confirmation code plus a status URL. Jordan's PDPL requires a lawful
-- basis, and consent is its default basis, so the moment of consent has to be
-- recorded rather than assumed.
-- ===========================================================================

create table if not exists pulseboard.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique,
  provider text not null check (provider in ('meta','tiktok','self')),
  external_user_id text,
  user_id uuid references auth.users on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  accounts_deleted int not null default 0,
  status text not null default 'received' check (status in ('received','completed','not_found'))
);
alter table pulseboard.deletion_requests enable row level security;
-- No client policies: the public status page reads through a function using the
-- service-role key, keyed by a code only the requester was given.

create index if not exists idx_deletion_code on pulseboard.deletion_requests (confirmation_code);

create table if not exists pulseboard.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  purpose text not null,
  version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  evidence jsonb not null default '{}'
);
alter table pulseboard.consents enable row level security;
drop policy if exists "consents owner read" on pulseboard.consents;
create policy "consents owner read" on pulseboard.consents
  for select using (auth.uid() = user_id);
grant select on pulseboard.consents to authenticated;
create index if not exists idx_consents_user on pulseboard.consents (user_id, purpose);

-- ==========================================================================
-- SOURCE: supabase/migrations/0004_ai_usage.sql
-- ==========================================================================

-- ===========================================================================
-- 0004 — AI usage accounting
--
-- /api/ai had no cap of any kind and spends the organisation's Anthropic budget.
-- At roughly $0.09 a request, one scripted caller is tens of thousands of
-- dollars a day, and exhausting the budget takes the assistant down for every
-- tenant at once.
-- ===========================================================================

create table if not exists pulseboard.ai_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  input_tokens int not null default 0,
  output_tokens int not null default 0
);
alter table pulseboard.ai_usage enable row level security;
drop policy if exists "ai usage owner read" on pulseboard.ai_usage;
create policy "ai usage owner read" on pulseboard.ai_usage
  for select using (auth.uid() = user_id);
grant select on pulseboard.ai_usage to authenticated;
create index if not exists idx_ai_usage_user_time on pulseboard.ai_usage (user_id, created_at desc);

-- ==========================================================================
-- SOURCE: supabase/migrations/0005_instagram_login.sql
-- ==========================================================================

-- ===========================================================================
-- 0005 — Instagram API with Instagram Login
--
-- Adds a third provider. Instagram Login authenticates directly against
-- Instagram and does NOT require the professional account to be linked to a
-- Facebook Page, which on the Facebook Login path is a hard block rather than
-- friction: a creator without a linked Page simply cannot connect.
-- It also needs a smaller permission set (no pages_* scopes at all).
--
-- The Facebook Login path is retained and unchanged.
-- ===========================================================================

alter table pulseboard.provider_identities
  drop constraint if exists provider_identities_provider_check;
alter table pulseboard.provider_identities
  add constraint provider_identities_provider_check
  check (provider in ('meta', 'tiktok', 'instagram'));

-- Which authentication path an account was connected through. Determines the
-- API host and whether appsecret_proof applies.
alter table pulseboard.social_accounts
  add column if not exists auth_mode text
  check (auth_mode in ('facebook_login', 'instagram_login', 'tiktok'));

-- ==========================================================================
-- Verification. Should list every pulseboard table, each with rowsecurity = t.
-- ==========================================================================
select tablename, rowsecurity
from pg_tables
where schemaname = 'pulseboard'
order by tablename;
