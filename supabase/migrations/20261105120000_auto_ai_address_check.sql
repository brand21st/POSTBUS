alter table public.automation_settings
  add column if not exists auto_ai_address_check boolean not null default true;

comment on column public.automation_settings.auto_ai_address_check is
  'When false, skip AI address correction on booking, precheck, and Shopify address jobs. PIN lookup still runs.';
