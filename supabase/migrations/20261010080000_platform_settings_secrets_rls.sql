-- Domain A: platform_settings holds PostBus Razorpay/Vachat/OpenRouter secrets.
-- JWT anon/authenticated must not SELECT ciphertext or key ids via PostgREST.
-- Super Admin and billing loaders use service_role (bypasses RLS).
-- SECURITY DEFINER RPCs that read trial_enabled / trial_days keep working.

revoke all on table public.platform_settings from public;
revoke all on table public.platform_settings from anon;
revoke all on table public.platform_settings from authenticated;

grant select, insert, update, delete on table public.platform_settings to service_role;

drop policy if exists platform_settings_admin_select on public.platform_settings;

comment on table public.platform_settings is
  'Singleton platform config including encrypted Razorpay credentials. Readable only via service_role / SECURITY DEFINER. Domain A (PostBus billing) only.';
