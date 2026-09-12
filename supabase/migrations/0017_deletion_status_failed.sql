-- A deletion request that did not delete needs somewhere to say so.
--
-- 0003 gave `status` three values: 'received', 'completed', 'not_found'. There
-- was no way to record a request we accepted and could not carry out, so the
-- handlers wrote 'completed' whenever they found anything to delete — whether or
-- not the deletes succeeded. supabase-js resolves rather than throws on a
-- PostgREST error, so an RLS change or a constraint could leave every row in
-- place while the request was recorded as done and a confirmation code was
-- handed to the subject.
--
-- 'failed' is the missing value. It means: the request was genuine, we tried,
-- and some of the data is still here.
--
-- WHY IT MATTERS BEYOND TIDINESS
--
-- Meta requires the confirmation URL to give "a human-readable explanation of
-- the status of their request, including a legitimate justification for any
-- refusal to delete" (Data Deletion Callback, developers.facebook.com, read
-- 2026-09-12). The callback response itself has no failure channel — Meta
-- documents exactly two fields, `url` and `confirmation_code`, and nothing for
-- a partial or failed erasure. So the status PAGE is the only place the truth
-- can be told, and it can only tell it if the row can hold it.
--
-- NOTE THE CIRCULARITY, IT IS THE POINT
--
-- Until this migration is applied, writing status='failed' violates the 0003
-- check constraint and PostgREST refuses the insert — so the record of a failed
-- deletion would itself be silently lost, which is the exact defect this
-- migration exists to let us report. That write is now checked
-- (`writeFailed` in _lib.ts), so the loss is logged rather than invisible, but
-- the row is still gone. Apply this before relying on any of it.

alter table pulseboard.deletion_requests
  drop constraint if exists deletion_requests_status_check;

alter table pulseboard.deletion_requests
  add constraint deletion_requests_status_check
  check (status in ('received', 'completed', 'not_found', 'failed'));

comment on column pulseboard.deletion_requests.status is
  'received = accepted, not yet processed. completed = every row deleted.
   not_found = nothing was held for this subject. failed = we tried and some of
   the data is still here; the confirmation page must say so, and an operator
   must finish it by hand.';

-- Renumbered from 0016 on merge: 0016 was taken by the migrations ledger, which
-- was written in parallel and is already applied in production. Every migration
-- from 0016 onward records itself; see docs/DEPLOY-RUNBOOK.md.
insert into pulseboard.schema_migrations (version) values ('0017_deletion_status_failed')
  on conflict (version) do nothing;
