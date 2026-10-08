alter table public.platform_settings
  add column if not exists encrypted_openrouter_api_key text,
  add column if not exists openrouter_model text not null default 'openai/gpt-4o-mini',
  add column if not exists openrouter_enabled boolean not null default false;

comment on column public.platform_settings.encrypted_openrouter_api_key is
  'AES-GCM encrypted OpenRouter API key for WhatsApp paste autofill. Super Admin only.';
comment on column public.platform_settings.openrouter_model is
  'OpenRouter model id used to extract customer fields from pasted WhatsApp text.';
comment on column public.platform_settings.openrouter_enabled is
  'When true and a key is saved, Parse message uses OpenRouter; otherwise the rules parser runs.';
