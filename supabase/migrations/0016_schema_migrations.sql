-- A record of which migrations have been applied, in the database itself.
--
-- WHY THIS EXISTS
--
-- `CLAUDE.md` has said "keep a record of what has been applied" since the audit.
-- The record was prose in `tasks.md`, updated by hand, and on 2026-09-12 a
-- session was asked to confirm whether 0014 and 0015 were applied and could not
-- answer. That is the whole problem: every migration here is
-- `add column if not exists`, applied by pasting into the SQL editor, so the
-- database is the only thing that knows the truth and it was not being asked.
--
-- WHY THE FAILURE WAS WORSE THAN "I DON'T KNOW"
--
-- The check available at the time was a PostgREST read with the anon key. It
-- returned `42501 permission denied` — which is exactly what a CORRECTLY locked
-- down database returns, whether or not the column exists. Permission is denied
-- before the column is ever resolved, so a missing column and a healthy refusal
-- are indistinguishable. A verification channel that cannot fail is the same
-- defect as the old `verify/*.mjs` printers that reported PASS while the sync
-- wrote wrong numbers, and it is worth naming as that.
--
-- HONESTY OF THE BACKFILL
--
-- Rows 0001-0015 are inserted on the operator's word that they were applied
-- (confirmed 2026-09-12). That is an assertion, not a measurement, and this
-- table cannot make it true. The independent check is `verify/check-schema.mjs`,
-- which probes for the COLUMNS each migration adds — so a row here without the
-- schema behind it is caught rather than believed. Every migration from 0016
-- onward records itself, in the same transaction as its own DDL.

create table if not exists pulseboard.schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now(),
  -- How the row got here: 'migration' when the file recorded itself,
  -- 'backfill' when a human asserted it after the fact.
  source      text not null default 'migration'
);

alter table pulseboard.schema_migrations enable row level security;

-- No policy, deliberately. RLS with no policy is default-deny for anon and
-- authenticated; only the service role reads this, which is what the checker
-- uses. The migration list is not client data and nothing in the app reads it.
revoke all on pulseboard.schema_migrations from anon, authenticated;

insert into pulseboard.schema_migrations (version, source) values
  ('0001_audit_fixes', 'backfill'),
  ('0002_token_refresh', 'backfill'),
  ('0003_deletion_and_consent', 'backfill'),
  ('0004_ai_usage', 'backfill'),
  ('0005_instagram_login', 'backfill'),
  ('0006_revoke_anon_grants', 'backfill'),
  ('0007_account_timezone', 'backfill'),
  ('0008_advanced_metrics', 'backfill'),
  ('0009_content_nullable', 'backfill'),
  ('0010_stories', 'backfill'),
  ('0011_token_scope_audit', 'backfill'),
  ('0012_content_refreshed_at', 'backfill'),
  ('0013_content_checked_at', 'backfill'),
  ('0014_needs_reauth', 'backfill'),
  ('0015_audience_dimensions', 'backfill'),
  ('0016_schema_migrations', 'migration')
on conflict (version) do nothing;

comment on table pulseboard.schema_migrations is
  'Which migrations have been applied. Rows 0001-0015 were backfilled from the
   operator''s assertion on 2026-09-12; later rows are written by the migration
   itself. verify/check-schema.mjs is the independent check — it probes for the
   columns each migration adds, so a row here without the schema behind it fails.';
