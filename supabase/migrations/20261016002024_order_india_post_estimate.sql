alter table public.orders
  add column if not exists india_post_estimate_amount numeric(12,2),
  add column if not exists india_post_estimated_at timestamptz;

comment on column public.orders.india_post_estimate_amount is
  'Latest pre-booking India Post tariff estimate. This is not the customer shipping charge or booked shipment tariff.';

comment on column public.orders.india_post_estimated_at is
  'Time at which the latest India Post tariff estimate was calculated.';
