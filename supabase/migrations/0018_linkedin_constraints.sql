-- LinkedIn could never have connected: three check constraints refused it.
--
-- Found 2026-09-14 by reading the live catalog (pg_constraint), not the code:
--
--   provider_identities.provider   meta, tiktok, instagram          (0005)
--   social_accounts.platform       facebook, instagram, tiktok      (schema.sql)
--   social_accounts.auth_mode      facebook_login, instagram_login, tiktok (0005)
--
-- The LinkedIn integration (f74f7d1, 2026-09-10 onward) writes provider
-- 'linkedin', platform 'linkedin' and auth_mode 'linkedin_organization', and no
-- migration ever widened the constraints. The first real connection would have
-- failed at the identity upsert and redirected with linkedin_callback_failed.
-- Every test passed throughout, because the fake database enforces no
-- constraints. verify/tests/constraints.test.mjs now checks every value the code
-- writes against the latest definition in these migrations.
--
-- 'linkedin_member' is added for the personal-profile connection
-- (docs/LINKEDIN-PLAN.md), which shares platform 'linkedin' and provider
-- 'linkedin' with the Company Page path.
--
-- Widening only: every value previously allowed is still allowed, so no existing
-- row can violate the new definitions.

alter table pulseboard.provider_identities
  drop constraint if exists provider_identities_provider_check;
alter table pulseboard.provider_identities
  add constraint provider_identities_provider_check
  check (provider in ('meta', 'tiktok', 'instagram', 'linkedin'));

alter table pulseboard.social_accounts
  drop constraint if exists social_accounts_platform_check;
alter table pulseboard.social_accounts
  add constraint social_accounts_platform_check
  check (platform in ('facebook', 'instagram', 'tiktok', 'linkedin'));

alter table pulseboard.social_accounts
  drop constraint if exists social_accounts_auth_mode_check;
alter table pulseboard.social_accounts
  add constraint social_accounts_auth_mode_check
  check (auth_mode in ('facebook_login', 'instagram_login', 'tiktok', 'linkedin_organization', 'linkedin_member'));

insert into pulseboard.schema_migrations (version) values ('0018_linkedin_constraints')
  on conflict (version) do nothing;
