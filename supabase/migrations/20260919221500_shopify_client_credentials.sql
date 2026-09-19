alter table public.shopify_connections
  add column if not exists client_id text;

alter table public.shopify_connections
  add column if not exists encrypted_client_secret text;

alter table public.shopify_connections
  add column if not exists encrypted_previous_client_secret text;

comment on column public.shopify_connections.client_id is
  'Shopify app Client ID (public identifier). Never treat as a secret.';

comment on column public.shopify_connections.encrypted_client_secret is
  'AES-GCM encrypted Shopify Client secret used for OAuth and webhook HMAC.';

comment on column public.shopify_connections.encrypted_previous_client_secret is
  'Previous Client secret kept during rotation so webhooks signed with the old secret still verify.';
