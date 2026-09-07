-- Record what a stored token can actually do.
--
-- Audited on 2026-09-07: an OAuth token issued by our flow can carry MORE than
-- the two read scopes we request. Meta grants what the ACCOUNT has previously
-- allowed the app, so an account that once generated a token through the App
-- Dashboard hands us a token holding publishing and messaging rights we never
-- asked for. The scope list in an authorisation request is a floor, not a
-- ceiling. See API-VERIFICATION.md §7.5.
--
-- We cannot narrow a token Meta chooses to issue. We can know, say so, and tell
-- the account holder how to revoke the excess themselves — which is worth more
-- to them than silence, and is the difference between a claim and evidence.

alter table pulseboard.social_accounts
  add column if not exists write_scopes text[];

alter table pulseboard.social_accounts
  add column if not exists scopes_checked_at timestamptz;

comment on column pulseboard.social_accounts.write_scopes is
  'Write-capable permissions this token was observed to hold, despite the app
   requesting none. Empty array means audited and clean. NULL means never
   audited — which is not the same as clean and must not be shown as such.';
comment on column pulseboard.social_accounts.scopes_checked_at is
  'When the audit last ran. A stale result is still evidence, but an old one
   should say its age rather than imply it is current.';
