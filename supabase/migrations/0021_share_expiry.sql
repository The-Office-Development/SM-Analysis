-- Give a shared report link an end.
--
-- Until now a link was permanent and irrevocable: `createShare` minted a slug
-- and that was the whole lifecycle. The privacy policy had to tell clients to
-- "treat one as public once you have sent it", which is honest about the product
-- rather than a description of a control they have. A creator who sends a
-- sponsor their numbers cannot withdraw them, and cannot even list what they
-- have sent, which is the part that matters when the question is "what is out
-- there under my name".
--
-- Two halves, and this migration is the first:
--   expires_at  null = never expires, which is what every existing row is and
--               must remain. Backfilling a date onto links already sent would
--               break them, so the default is deliberately null rather than
--               "now() + 30 days".
--   revocation  needs no column: `report_shares` already grants delete to the
--               owner under RLS (`0001_audit_fixes.sql`), so revoking is a
--               delete, and the row stops existing rather than lingering in a
--               state that still holds the payload.
--
-- The GET path in `share.ts` reads with the service-role key and therefore
-- bypasses RLS, so the expiry check lives in that function. A policy would not
-- be consulted there, which is exactly the trap `CLAUDE.md` records about
-- grants versus policies.

alter table pulseboard.report_shares add column if not exists expires_at timestamptz;

comment on column pulseboard.report_shares.expires_at is
  'When this link stops resolving. Null = never, which is what all links created
   before 2026-09-19 are. Enforced in share.ts, not by RLS: the public read uses
   the service-role key and no policy is consulted on that path.';

-- Finding an owner's links for the "shared links" list, newest first.
create index if not exists idx_shares_user_created
  on pulseboard.report_shares (user_id, created_at desc);

insert into pulseboard.schema_migrations (version) values ('0021_share_expiry')
  on conflict (version) do nothing;
