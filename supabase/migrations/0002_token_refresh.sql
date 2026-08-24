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
