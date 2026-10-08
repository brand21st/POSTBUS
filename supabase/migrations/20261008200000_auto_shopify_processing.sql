-- Shopify Auto Processing: newly imported Shopify orders enter Processing only when enabled.

alter table public.automation_settings
  add column if not exists auto_shopify_processing boolean not null default false;

comment on column public.automation_settings.auto_shopify_processing is
  'When true, newly imported Shopify orders enter the existing Processing workflow.';
