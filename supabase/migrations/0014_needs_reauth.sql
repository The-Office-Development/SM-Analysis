-- When an account's authorisation must be renewed by the client, in a browser.
--
-- WHY A COLUMN AND NOT AN INFERENCE FROM expires_at
--
-- Every other platform here refreshes server-side: the cron swaps an old token
-- for a new one and nobody is troubled. LinkedIn does not offer that to this
-- app. Its documentation is explicit on both halves — "To refresh an access
-- token, go through the authorization process again to fetch a new token", and
-- "Programmatic refresh tokens are available for a limited set of partners."
--
-- So a LinkedIn connection has a hard 60-day life and the only way to extend it
-- is a round trip through the client's own browser. That round trip is silent
-- while the token is still valid — LinkedIn skips the consent screen if the
-- member is still signed in and the token has not expired — and becomes a full
-- consent screen once it lapses. For a Company Page that means finding an
-- administrator and walking them through it, which is a support call rather than
-- a click.
--
-- The whole point is therefore to ask EARLY, and that needs a flag the interface
-- can read. Deriving it from expires_at in the UI would spread the rule across
-- every page that shows an account, and would silently break the moment one
-- platform's expiry means something different from another's — which is exactly
-- the situation here.
--
-- Set by the token-refresh cron ten days out. Cleared when the client reconnects.
-- NULL and false both mean "fine"; only true means "ask them".

alter table pulseboard.social_accounts
  add column if not exists needs_reauth boolean not null default false;

comment on column pulseboard.social_accounts.needs_reauth is
  'True when the client must re-authorise this account from a browser. Set by the
   token-refresh job for platforms that cannot be refreshed server-side (LinkedIn),
   ten days before expiry so a single silent click still fixes it. Cleared on
   reconnect.';
