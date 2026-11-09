-- Merchant override for the amount India Post collects on delivery.
-- auto follows Shopify / WooCommerce remaining. manual keeps the typed amount across store sync.

alter table public.orders
  add column if not exists cod_amount_mode text not null default 'auto';

alter table public.orders
  drop constraint if exists orders_cod_amount_mode_check;

alter table public.orders
  add constraint orders_cod_amount_mode_check check (cod_amount_mode in ('auto', 'manual'));

comment on column public.orders.cod_amount_mode is
  'auto follows Shopify/Woo remaining; manual is the India Post collect override stored in cod_amount.';
