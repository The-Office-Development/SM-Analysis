-- ===========================================================================
-- 0006 — revoke the anon/authenticated grants 0001 missed
--
-- `schema.sql` opens with a blanket grant (lines 25 and 166):
--
--     grant all on all tables in schema pulseboard to anon, authenticated, service_role;
--
-- 0001 undid that, but only for a NAMED LIST: metrics_daily, content,
-- audience_snapshots, social_accounts, report_shares. Four tables created in
-- schema.sql were never on the list and kept `grant all` for `anon` — the key
-- that ships in every visitor's browser:
--
--     account_secrets      OAuth access AND refresh tokens
--     provider_identities  per-provider identity and refresh state
--     sync_log             operational history
--     goals                user-created targets
--
-- Confirmed against a live project on 2026-09-04: those four answered a bare
-- publishable key with `200 []`, while every revoked table answered `42501`.
--
-- >>> This was NOT a live leak, and the distinction matters. <<<
-- All four have RLS enabled. account_secrets and provider_identities carry no
-- policies at all, so every row is denied; sync_log and goals carry owner-scoped
-- policies an anonymous caller cannot satisfy. Nothing was ever readable.
--
-- It is fixed anyway because a single layer was holding it. `grant all` includes
-- INSERT, UPDATE and DELETE, and the only thing standing between a browser-side
-- key and the OAuth token table was RLS being on with no policy. One
-- `disable row level security` typed into the SQL editor, or one permissive
-- policy added later by someone who did not know, and a client's Instagram token
-- is world-readable. Defence in depth is the whole point: the grant should never
-- have been there, so it goes.
--
-- Applied while every table was still empty — no client data existed yet.
-- ===========================================================================

-- The four 0001 missed. service_role is untouched: it bypasses RLS and is the
-- only thing that may read account_secrets, from inside the Netlify Functions.
revoke all on pulseboard.account_secrets     from anon, authenticated;
revoke all on pulseboard.provider_identities from anon, authenticated;
revoke all on pulseboard.sync_log            from anon, authenticated;
revoke all on pulseboard.goals               from anon, authenticated;

-- Re-grant only what the app actually needs, matching 0001's pattern.
-- sync_log: 0001 granted this and the grant was then swept up by the revoke
-- above, so it is restored here. Read-only; the dashboard shows sync history.
grant select on pulseboard.sync_log to authenticated;

-- goals: users create and delete their own. The owner policy in schema.sql
-- ("goals owner all") already scopes which rows; this is the table-level
-- privilege that policy operates within.
grant select, insert, update, delete on pulseboard.goals to authenticated;

-- account_secrets and provider_identities get NOTHING back. Tokens are read
-- only by the service role inside Netlify Functions. If a future change makes a
-- client need something from these tables, that is the signal the design went
-- wrong, not a reason to grant.

-- A defensive DO block re-revoking the same two tables was dropped here: it was
-- redundant with the explicit revokes above, and its PL/pgSQL `begin` trips the
-- concatenation guard in build-bootstrap.mjs. The guard is deliberately blunt —
-- keeping it strict is worth more than letting this file be clever.
