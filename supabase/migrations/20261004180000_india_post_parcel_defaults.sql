alter table public.india_post_connections
  add column if not exists default_length_cm numeric,
  add column if not exists default_width_cm numeric,
  add column if not exists default_height_cm numeric,
  add column if not exists default_weight_grams integer;

comment on column public.india_post_connections.default_length_cm is
  'Workspace default parcel length (cm) used when an order has no size.';
comment on column public.india_post_connections.default_width_cm is
  'Workspace default parcel width (cm) used when an order has no size.';
comment on column public.india_post_connections.default_height_cm is
  'Workspace default parcel height (cm) used when an order has no size.';
comment on column public.india_post_connections.default_weight_grams is
  'Workspace default parcel weight (g) used when an order has no declared weight.';
