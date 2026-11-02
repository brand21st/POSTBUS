alter table public.orders
  add column if not exists india_post_estimate_key text;

comment on column public.orders.india_post_estimate_key is
  'Normalized tariff request key for determining whether the saved India Post estimate is still current.';
