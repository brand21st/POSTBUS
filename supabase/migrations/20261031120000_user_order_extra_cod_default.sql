-- Default extra COD amount for Add order, stored with the member's payment default.
-- Payment status stays null until the member saves one, so saving only the amount
-- does not invent a payment default.

alter table public.user_order_defaults
  alter column payment_status drop not null;

alter table public.user_order_defaults
  alter column payment_status drop default;

alter table public.user_order_defaults
  drop constraint if exists user_order_defaults_payment_chk;

alter table public.user_order_defaults
  add constraint user_order_defaults_payment_chk check (
    payment_status is null
    or payment_status = any (array['PAID', 'PARTIAL', 'COD']::public.payment_status[])
  );

alter table public.user_order_defaults
  add column if not exists extra_cod_charge numeric(12,2);

alter table public.user_order_defaults
  drop constraint if exists user_order_defaults_extra_cod_nonnegative;

alter table public.user_order_defaults
  add constraint user_order_defaults_extra_cod_nonnegative
  check (extra_cod_charge is null or extra_cod_charge >= 0);

comment on column public.user_order_defaults.extra_cod_charge is
  'Default extra cash-on-delivery charge in rupees for Add order. Null means none has been saved.';
