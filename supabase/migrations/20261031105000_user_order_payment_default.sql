-- Saved payment choice for Add order, per signed-in member and workspace.

create table if not exists public.user_order_defaults (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_status public.payment_status not null default 'PAID',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id),
  constraint user_order_defaults_payment_chk check (
    payment_status = any (array['PAID', 'PARTIAL', 'COD']::public.payment_status[])
  )
);

comment on table public.user_order_defaults is
  'Default payment status for manual Add order, per signed-in member and workspace.';

drop trigger if exists set_user_order_defaults_updated_at on public.user_order_defaults;
create trigger set_user_order_defaults_updated_at
  before update on public.user_order_defaults
  for each row execute function public.set_updated_at();

alter table public.user_order_defaults enable row level security;

drop policy if exists user_order_defaults_self on public.user_order_defaults;
create policy user_order_defaults_self on public.user_order_defaults
  for all
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

revoke all on public.user_order_defaults from public, anon;
grant select, insert, update, delete on table public.user_order_defaults to authenticated;
