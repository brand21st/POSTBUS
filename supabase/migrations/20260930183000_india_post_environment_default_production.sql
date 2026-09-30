-- Align new India Post connections with the Live (PRODUCTION) UI default.
-- Existing UAT rows are unchanged.
alter table public.india_post_connections
  alter column environment set default 'PRODUCTION'::public.provider_env;
