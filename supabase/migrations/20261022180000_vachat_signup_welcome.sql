alter table public.platform_settings
  add column if not exists vachat_signup_welcome_enabled boolean,
  add column if not exists vachat_signup_welcome_template_name text;

comment on column public.platform_settings.vachat_signup_welcome_enabled is
  'When true, PostBus sends the selected VaChat template after a merchant first workspace is created.';
comment on column public.platform_settings.vachat_signup_welcome_template_name is
  'Approved VaChat UTILITY/MARKETING template name for new-signup WhatsApp. Not a shipment event.';

alter table public.profiles
  add column if not exists signup_welcome_sent_at timestamptz;

comment on column public.profiles.signup_welcome_sent_at is
  'Set after the new-signup VaChat welcome template is sent. Idempotency for enqueue.';
