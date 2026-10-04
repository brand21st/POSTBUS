-- platform VaChat / WhatsApp: one encrypted API key for every merchant

alter table public.platform_settings
  add column if not exists vachat_enabled boolean not null default false,
  add column if not exists vachat_api_base_url text,
  add column if not exists encrypted_vachat_api_key text,
  add column if not exists encrypted_vachat_webhook_secret text,
  add column if not exists vachat_webhook_endpoint_id text,
  add column if not exists vachat_last_verified_at timestamptz,
  add column if not exists vachat_last_error text;

comment on column public.platform_settings.vachat_enabled is
  'When true, every organization uses this platform VaChat connection; merchant keys are ignored.';
comment on column public.platform_settings.vachat_api_base_url is
  'VaChat Cloud origin, e.g. https://cloud.vachat.in';
comment on column public.platform_settings.encrypted_vachat_api_key is
  'AES-GCM encrypted VaChat API key (postbus:send + webhooks:manage).';
comment on column public.platform_settings.encrypted_vachat_webhook_secret is
  'AES-GCM encrypted VaChat outbound webhook HMAC secret.';
comment on column public.platform_settings.vachat_webhook_endpoint_id is
  'VaChat webhook_endpoints.id registered from Super Admin settings.';
