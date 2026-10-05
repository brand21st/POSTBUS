alter table public.india_post_connections
  add column if not exists pickup_dropoff_office_pincode text;

comment on column public.india_post_connections.pickup_dropoff_office_pincode is
  'Six-digit pincode of the configured drop-off India Post office. Used as sender/origin pin for DROPOFF bookings.';
