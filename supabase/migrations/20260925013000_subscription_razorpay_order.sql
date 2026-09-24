-- One-time Razorpay Orders checkout stores the order id on the local subscription
-- until payment is captured. Recurring Razorpay Subscriptions can be wired later.

alter table public.subscriptions
  add column if not exists razorpay_order_id text;

create unique index if not exists subscriptions_razorpay_order_id_uidx
  on public.subscriptions (razorpay_order_id)
  where razorpay_order_id is not null;
