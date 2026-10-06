-- Per-user table column widths (Orders # Order / Customer / Items, etc.)

create table if not exists public.user_table_layouts (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  table_key text not null,
  column_widths jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id, table_key),
  constraint user_table_layouts_table_key_chk check (table_key ~ '^[a-z0-9_-]{1,64}$')
);

comment on table public.user_table_layouts is
  'Saved dashboard table column widths per signed-in member and workspace.';

drop trigger if exists set_user_table_layouts_updated_at on public.user_table_layouts;
create trigger set_user_table_layouts_updated_at
  before update on public.user_table_layouts
  for each row execute function public.set_updated_at();

alter table public.user_table_layouts enable row level security;

drop policy if exists user_table_layouts_self on public.user_table_layouts;
create policy user_table_layouts_self on public.user_table_layouts
  for all
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
