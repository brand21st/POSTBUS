-- Per-order Speed Post parcel / Business Parcel pin, and a workspace override
-- above the India Post integration default. Null means follow the next level.

alter table public.orders
  add column if not exists india_post_service text;

alter table public.orders
  drop constraint if exists orders_india_post_service_check;

alter table public.orders
  add constraint orders_india_post_service_check
  check (india_post_service is null or india_post_service in ('SP_INLAND_PARCEL', 'BUSINESS_PARCEL'));

alter table public.india_post_connections
  add column if not exists booking_service_override text;

alter table public.india_post_connections
  drop constraint if exists india_post_connections_booking_service_override_check;

alter table public.india_post_connections
  add constraint india_post_connections_booking_service_override_check
  check (
    booking_service_override is null
    or booking_service_override in ('SP_INLAND_PARCEL', 'BUSINESS_PARCEL')
  );
