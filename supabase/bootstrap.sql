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
--   7. supabase/migrations/0006_revoke_anon_grants.sql
--   8. supabase/migrations/0007_account_timezone.sql
--   9. supabase/migrations/0008_advanced_metrics.sql
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
-- SOURCE: supabase/migrations/0006_revoke_anon_grants.sql
-- ==========================================================================

-- ===========================================================================
-- 0006 — revoke the anon/authenticated grants 0001 missed
--
-- `schema.sql` opens with a blanket grant (lines 25 and 166):
--
--     grant all on all tables in schema pulseboard to anon, authenticated, service_role;
--
-- 0001 undid that, but only for a NAMED LIST: metrics_daily, content,
-- audience_snapshots, social_accounts, report_shares. Four tables created in
-- schema.sql were never on the list and kept `grant all` for `anon` — the key
-- that ships in every visitor's browser:
--
--     account_secrets      OAuth access AND refresh tokens
--     provider_identities  per-provider identity and refresh state
--     sync_log             operational history
--     goals                user-created targets
--
-- Confirmed against a live project on 2026-09-04: those four answered a bare
-- publishable key with `200 []`, while every revoked table answered `42501`.
--
-- >>> This was NOT a live leak, and the distinction matters. <<<
-- All four have RLS enabled. account_secrets and provider_identities carry no
-- policies at all, so every row is denied; sync_log and goals carry owner-scoped
-- policies an anonymous caller cannot satisfy. Nothing was ever readable.
--
-- It is fixed anyway because a single layer was holding it. `grant all` includes
-- INSERT, UPDATE and DELETE, and the only thing standing between a browser-side
-- key and the OAuth token table was RLS being on with no policy. One
-- `disable row level security` typed into the SQL editor, or one permissive
-- policy added later by someone who did not know, and a client's Instagram token
-- is world-readable. Defence in depth is the whole point: the grant should never
-- have been there, so it goes.
--
-- Applied while every table was still empty — no client data existed yet.
-- ===========================================================================

-- The four 0001 missed. service_role is untouched: it bypasses RLS and is the
-- only thing that may read account_secrets, from inside the Netlify Functions.
revoke all on pulseboard.account_secrets     from anon, authenticated;
revoke all on pulseboard.provider_identities from anon, authenticated;
revoke all on pulseboard.sync_log            from anon, authenticated;
revoke all on pulseboard.goals               from anon, authenticated;

-- Re-grant only what the app actually needs, matching 0001's pattern.
-- sync_log: 0001 granted this and the grant was then swept up by the revoke
-- above, so it is restored here. Read-only; the dashboard shows sync history.
grant select on pulseboard.sync_log to authenticated;

-- goals: users create and delete their own. The owner policy in schema.sql
-- ("goals owner all") already scopes which rows; this is the table-level
-- privilege that policy operates within.
grant select, insert, update, delete on pulseboard.goals to authenticated;

-- account_secrets and provider_identities get NOTHING back. Tokens are read
-- only by the service role inside Netlify Functions. If a future change makes a
-- client need something from these tables, that is the signal the design went
-- wrong, not a reason to grant.

-- A defensive DO block re-revoking the same two tables was dropped here: it was
-- redundant with the explicit revokes above, and its PL/pgSQL `begin` trips the
-- concatenation guard in build-bootstrap.mjs. The guard is deliberately blunt —
-- keeping it strict is worth more than letting this file be clever.

-- ==========================================================================
-- SOURCE: supabase/migrations/0007_account_timezone.sql
-- ==========================================================================

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

-- ==========================================================================
-- SOURCE: supabase/migrations/0008_advanced_metrics.sql
-- ==========================================================================

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

-- ==========================================================================
-- Verification. Should list every pulseboard table, each with rowsecurity = t.
-- ==========================================================================
select tablename, rowsecurity
from pg_tables
where schemaname = 'pulseboard'
order by tablename;
