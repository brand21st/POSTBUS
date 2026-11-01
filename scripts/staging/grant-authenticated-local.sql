-- Local CLI 2.115 no longer auto-exposes public tables to authenticated.
-- Production already has these grants (verified read-only 2026-10-31).
-- Do not apply this file to production.

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

revoke all on table public.platform_settings from authenticated;
revoke all on table public.platform_settings from anon;
revoke all on table public.platform_settings from public;
