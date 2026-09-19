-- A security audit log: what happened to whose account, and whether it worked.
--
-- Meta's Data Protection Assessment (v3.1, questions 3.1-22.b to .e) asks for
-- application event logs carrying a user id, the event, the time and a
-- success/failure indicator, kept at least 30 days, protected from tampering,
-- and reviewed at least weekly. Measured 2026-09-19: we kept none. Function
-- logs exist only as a live stream (no Cloudflare observability configured),
-- and sync_log covers syncing, not security.
--
-- Design:
--   * 90 days, not 30: long enough to look back across a quarter.
--   * APPEND-ONLY, enforced here rather than by convention. Rows cannot be
--     updated at all, and cannot be deleted until they are 90 days old, by
--     anyone, including the service role the functions use. TRUNCATE is
--     refused too, since it bypasses row triggers.
--   * No foreign key to users. An erased user's security events must outlive
--     the erasure for their 90 days; the row holds an opaque id and what
--     happened, never platform data or tokens. The privacy policy says so.
--   * Share links are created and revoked from the BROWSER, under RLS, where no
--     function sees it happen. So they are recorded by a trigger on
--     report_shares. Only the slug's first four characters are kept: the full
--     slug is the secret that opens the report.

create table if not exists pulseboard.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  event            text not null,
  outcome          text not null check (outcome in ('success', 'failure')),
  user_id          uuid,          -- ours; null when not yet known (a Meta callback before matching)
  platform         text,
  account_id       uuid,
  platform_user_id text,          -- the platform's own id for the person, as Meta asks
  detail           jsonb
);

create index if not exists idx_audit_log_at on pulseboard.audit_log (at desc);
create index if not exists idx_audit_log_event_at on pulseboard.audit_log (event, at desc);

-- Browser keys get nothing. Default-deny RLS with no policy, AND no grant: two
-- layers, per 0006. The service role writes, reads and (after 90 days) deletes.
alter table pulseboard.audit_log enable row level security;
revoke all on pulseboard.audit_log from anon, authenticated;
grant select, insert, delete on pulseboard.audit_log to service_role;

create or replace function pulseboard.audit_log_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_log is append-only';
  end if;
  if tg_op = 'DELETE' and old.at > now() - interval '90 days' then
    raise exception 'audit_log rows are kept for 90 days';
  end if;
  return old;
end $$;

create or replace function pulseboard.audit_log_no_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log cannot be truncated';
end $$;

drop trigger if exists audit_log_guard on pulseboard.audit_log;
create trigger audit_log_guard before update or delete on pulseboard.audit_log
  for each row execute function pulseboard.audit_log_guard();

drop trigger if exists audit_log_no_truncate on pulseboard.audit_log;
create trigger audit_log_no_truncate before truncate on pulseboard.audit_log
  for each statement execute function pulseboard.audit_log_no_truncate();

-- Share links, recorded where they happen.
create or replace function pulseboard.audit_share() returns trigger
language plpgsql security definer set search_path = pulseboard, pg_temp as $$
begin
  insert into pulseboard.audit_log (event, outcome, user_id, detail)
  values (
    case tg_op when 'INSERT' then 'share.created' else 'share.revoked' end,
    'success',
    coalesce(new.user_id, old.user_id),
    jsonb_build_object(
      'slug_prefix', left(coalesce(new.slug, old.slug), 4),
      'expires_at', coalesce(new.expires_at, old.expires_at)
    )
  );
  return coalesce(new, old);
end $$;

drop trigger if exists report_shares_audit on pulseboard.report_shares;
create trigger report_shares_audit after insert or delete on pulseboard.report_shares
  for each row execute function pulseboard.audit_share();

-- None of these is meant to be called directly.
revoke all on function pulseboard.audit_log_guard() from public, anon, authenticated;
revoke all on function pulseboard.audit_log_no_truncate() from public, anon, authenticated;
revoke all on function pulseboard.audit_share() from public, anon, authenticated;

comment on table pulseboard.audit_log is
  'Security events: connections, disconnections, deletions, token failures, share
   links. Append-only; rows deletable only after 90 days. Meta DPA 3.1-22.';

insert into pulseboard.schema_migrations (version) values ('0023_audit_log')
  on conflict (version) do nothing;
