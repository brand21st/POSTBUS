-- Parcel weight chosen before India Post booking.
-- auto: box weight is the sum of line weights. manual: merchant typed the box weight.

alter table public.orders
  add column if not exists parcel_weight_mode text not null default 'auto';

alter table public.orders
  drop constraint if exists orders_parcel_weight_mode_check;

alter table public.orders
  add constraint orders_parcel_weight_mode_check
  check (parcel_weight_mode in ('auto', 'manual'));

alter table public.orders
  add column if not exists parcel_weight_grams integer;

alter table public.orders
  drop constraint if exists orders_parcel_weight_grams_check;

alter table public.orders
  add constraint orders_parcel_weight_grams_check
  check (
    (parcel_weight_mode = 'auto' and parcel_weight_grams is null)
    or (parcel_weight_mode = 'manual' and parcel_weight_grams >= 1)
  );

alter table public.order_line_items
  add column if not exists weight_edited boolean not null default false;
