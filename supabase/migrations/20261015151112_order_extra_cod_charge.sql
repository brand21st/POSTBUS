-- Additive extra COD collection amount for manual orders.
-- Existing rows stay 0. Historical cod_amount values are not rewritten.

alter table public.orders
  add column if not exists extra_cod_charge numeric(12,2) not null default 0;

alter table public.orders
  drop constraint if exists orders_extra_cod_charge_nonnegative;

alter table public.orders
  add constraint orders_extra_cod_charge_nonnegative check (extra_cod_charge >= 0);

comment on column public.orders.extra_cod_charge is
  'Additional customer COD collection entered on a manual order. Excluded from product subtotal and India Post tariff. 0 on existing orders.';
