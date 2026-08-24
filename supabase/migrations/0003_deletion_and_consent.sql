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
