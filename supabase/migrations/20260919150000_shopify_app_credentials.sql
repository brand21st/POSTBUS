alter table public.shopify_connections
  add column if not exists encrypted_api_key text;

alter table public.shopify_connections
  add column if not exists encrypted_api_secret text;

alter table public.shopify_connections
  add column if not exists requested_scopes text;

comment on column public.shopify_connections.encrypted_api_key is
  'AES-GCM encrypted Shopify custom app API key for this organization.';

comment on column public.shopify_connections.encrypted_api_secret is
  'AES-GCM encrypted Shopify custom app API secret for this organization.';

comment on column public.shopify_connections.requested_scopes is
  'OAuth scopes requested at install. Null uses the platform default.';
