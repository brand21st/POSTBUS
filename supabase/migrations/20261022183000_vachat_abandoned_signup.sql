alter table public.platform_settings
  add column if not exists vachat_abandoned_signup_enabled boolean,
  add column if not exists vachat_abandoned_signup_template_name text;

comment on column public.platform_settings.vachat_abandoned_signup_enabled is
  'When true, PostBus sends the selected VaChat template as soon as an unconfirmed signup exists.';
comment on column public.platform_settings.vachat_abandoned_signup_template_name is
  'Approved VaChat UTILITY/MARKETING template name for abandoned-signup WhatsApp. Not a shipment event.';

alter table public.profiles
  add column if not exists abandoned_signup_sent_at timestamptz;

comment on column public.profiles.abandoned_signup_sent_at is
  'Set after the abandoned-signup VaChat template is sent. Idempotency for enqueue and sweep.';

alter table public.vachat_notification_logs
  alter column organization_id drop not null;

create unique index if not exists vachat_notification_logs_platform_ref_uidx
  on public.vachat_notification_logs (external_ref)
  where organization_id is null;
