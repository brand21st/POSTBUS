alter table public.orders
  add column if not exists amount_paid numeric(12,2) not null default 0,
  add column if not exists cod_amount numeric(12,2) not null default 0;

update public.orders
set
  amount_paid = case
    when payment_status = 'PAID' then total_amount
    else coalesce(amount_paid, 0)
  end,
  cod_amount = case
    when payment_status = 'COD' then total_amount
    else coalesce(cod_amount, 0)
  end
where payment_status in ('PAID', 'COD');

comment on column public.orders.amount_paid is 'Amount already received before dispatch.';
comment on column public.orders.cod_amount is 'Amount still to collect on delivery.';
