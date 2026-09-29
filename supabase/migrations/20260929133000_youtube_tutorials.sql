create table if not exists public.tutorial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutorials (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.tutorial_categories(id) on delete restrict,
  title text not null,
  slug text not null unique,
  description text,
  youtube_url text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutorial_categories_active_sort_idx
  on public.tutorial_categories (is_active, sort_order, name);

create index if not exists tutorials_category_id_idx
  on public.tutorials (category_id);

create index if not exists tutorials_status_sort_idx
  on public.tutorials (status, sort_order, created_at desc);

drop trigger if exists set_tutorial_categories_updated_at on public.tutorial_categories;
create trigger set_tutorial_categories_updated_at
  before update on public.tutorial_categories
  for each row execute function public.set_updated_at();

drop trigger if exists set_tutorials_updated_at on public.tutorials;
create trigger set_tutorials_updated_at
  before update on public.tutorials
  for each row execute function public.set_updated_at();

alter table public.tutorial_categories enable row level security;
alter table public.tutorials enable row level security;

drop policy if exists tutorial_categories_authenticated_read on public.tutorial_categories;
create policy tutorial_categories_authenticated_read on public.tutorial_categories
  for select using (
    (is_active = true and auth.uid() is not null)
    or public.is_platform_admin()
  );

drop policy if exists tutorials_authenticated_read on public.tutorials;
create policy tutorials_authenticated_read on public.tutorials
  for select using (
    (
      status = 'published'
      and auth.uid() is not null
      and exists (
        select 1
        from public.tutorial_categories c
        where c.id = tutorials.category_id
          and c.is_active = true
      )
    )
    or public.is_platform_admin()
  );

revoke all on public.tutorial_categories from public, anon, authenticated;
revoke all on public.tutorials from public, anon, authenticated;
grant select on public.tutorial_categories to authenticated;
grant select on public.tutorials to authenticated;
grant all on public.tutorial_categories to service_role;
grant all on public.tutorials to service_role;
