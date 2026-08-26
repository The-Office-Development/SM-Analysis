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
