-- One-time public customer address-collection links for manual orders.
-- Public GET/submit uses the service role after hashing the URL token. No anon policies.

create table if not exists public.customer_order_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  token_hash text not null unique,
  status text not null default 'CREATED'
    check (status in (
      'CREATED',
      'OPENED',
      'SUBMITTED',
      'CONFIRMED',
      'EXPIRED',
      'DISABLED'
    )),
  expires_at timestamptz not null default (now() + interval '7 days'),
  customer_name text,
  phone text,
  line1 text,
  line2 text,
  city text,
  state text,
  pincode text,
  opened_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  disabled_at timestamptz,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_order_links_phone_chk
    check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  constraint customer_order_links_pincode_chk
    check (pincode is null or pincode ~ '^[0-9]{6}$')
);

create unique index if not exists customer_order_links_token_hash_idx
  on public.customer_order_links (token_hash);

create index if not exists customer_order_links_org_status_created_idx
  on public.customer_order_links (organization_id, status, created_at desc);

create index if not exists customer_order_links_org_created_idx
  on public.customer_order_links (organization_id, created_at desc);

comment on table public.customer_order_links is
  'One-time hashed customer address collection links. Token is never stored in plaintext.';

drop trigger if exists set_customer_order_links_updated_at on public.customer_order_links;
create trigger set_customer_order_links_updated_at
  before update on public.customer_order_links
  for each row execute function public.set_updated_at();

alter table public.customer_order_links enable row level security;

drop policy if exists customer_order_links_tenant_all on public.customer_order_links;
create policy customer_order_links_tenant_all on public.customer_order_links
  for all using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

revoke all on table public.customer_order_links from anon;
grant select, insert, update, delete on table public.customer_order_links to authenticated;
