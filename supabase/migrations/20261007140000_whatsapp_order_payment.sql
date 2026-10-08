alter table public.storefront_settings
  add column if not exists upi_id text,
  add column if not exists gpay_number text,
  add column if not exists qr_image_path text;

comment on column public.storefront_settings.upi_id is
  'Merchant UPI ID for WhatsApp storefront customer payments. Not Postbus SaaS billing.';
comment on column public.storefront_settings.gpay_number is
  'Merchant GPay number for WhatsApp storefront customer payments.';
comment on column public.storefront_settings.qr_image_path is
  'Storage path of merchant UPI/GPay QR image in product-images.';

create table if not exists public.order_payment_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null default 'OPEN',
  amount numeric(12,2),
  customer_phone text,
  reference text,
  claimed_via text not null default 'whatsapp',
  claimed_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_payment_claims_status_chk check (status in ('OPEN', 'CONFIRMED', 'REJECTED'))
);

create unique index if not exists order_payment_claims_one_open_uidx
  on public.order_payment_claims (order_id)
  where status = 'OPEN';

create index if not exists order_payment_claims_org_order_idx
  on public.order_payment_claims (organization_id, order_id, created_at desc);

alter table public.order_payment_claims enable row level security;

drop policy if exists order_payment_claims_select on public.order_payment_claims;
create policy order_payment_claims_select on public.order_payment_claims
  for select using (public.is_org_member(organization_id));

drop policy if exists order_payment_claims_write on public.order_payment_claims;
create policy order_payment_claims_write on public.order_payment_claims
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  )
  with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

comment on table public.order_payment_claims is
  'Customer WhatsApp payment claims. Not Postbus SaaS Razorpay billing.';
