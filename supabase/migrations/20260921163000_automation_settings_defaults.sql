alter table public.automation_settings
  alter column auto_shopify_sync set default true,
  alter column auto_manifest set default true,
  alter column auto_shopify_fulfillment set default true;
