-- Findings of Supabase's security advisor, run against the live project on
-- 2026-09-19 as the cloud-configuration test Meta's DPA asks for (3.1-12.c).
--
-- 1. function_search_path_mutable: audit_log_guard and audit_log_no_truncate
--    (added by 0023 the same day) did not pin their search_path. A function
--    whose search path the caller controls can be steered to a look-alike
--    object planted in another schema. Pinned here, with pg_temp LAST so a
--    temporary object can never shadow a real one.
--
-- 2. anon/authenticated_security_definer_function_executable: owns_account()
--    runs as its owner and was executable by ANY role, including the anonymous
--    browser key, over /rest/v1/rpc/owns_account.
--      * anon: revoked. For anon it could only ever answer false (auth.uid() is
--        null), and anon holds no grant on the tables whose policies call it,
--        so nothing legitimate needs it.
--      * authenticated: KEPT, deliberately. The read policies on metrics_daily,
--        content and audience_snapshots call it; revoking it would make every
--        signed-in dashboard empty. What it can tell a signed-in caller is
--        whether an account id belongs to THEM, which reveals nothing about
--        anyone else. The advisor will keep warning about this one, and that
--        warning is accepted, not overlooked.
--
-- ALTER, never CREATE OR REPLACE: no function body is redefined here, so
-- nothing that has drifted live can be silently reverted to a repo copy.

alter function pulseboard.audit_log_guard() set search_path = pulseboard, pg_temp;
alter function pulseboard.audit_log_no_truncate() set search_path = pulseboard, pg_temp;
alter function pulseboard.owns_account(uuid) set search_path = pulseboard, pg_temp;

revoke execute on function pulseboard.owns_account(uuid) from public, anon;
grant execute on function pulseboard.owns_account(uuid) to authenticated, service_role;

insert into pulseboard.schema_migrations (version) values ('0024_function_hardening')
  on conflict (version) do nothing;
