-- Auto Label Printing: org flag, printer prefs, local print agent, idempotent jobs.

alter table public.automation_settings
  add column if not exists auto_label_printing boolean not null default false;

comment on column public.automation_settings.auto_label_printing is
  'Automatically enqueue a print job after a shipping label PDF is saved.';

create table if not exists public.print_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  selected_printer_name text,
  paper_size text not null default 'A6',
  orientation text not null default 'portrait',
  copies integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_settings_paper_size_chk check (paper_size in ('A6', 'A5', 'A4')),
  constraint print_settings_orientation_chk check (orientation in ('portrait', 'landscape')),
  constraint print_settings_copies_chk check (copies >= 1 and copies <= 5)
);

create table if not exists public.print_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  name text not null default 'Print agent',
  token_prefix text not null,
  token_hash text not null,
  last_seen_at timestamptz,
  printers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  printer_name text,
  source text not null,
  status text not null default 'PENDING',
  error_message text,
  claimed_at timestamptz,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_jobs_source_chk check (source in ('AUTO', 'MANUAL')),
  constraint print_jobs_status_chk check (status in ('PENDING', 'PRINTING', 'PRINTED', 'FAILED'))
);

create unique index if not exists print_jobs_auto_label_uidx
  on public.print_jobs (label_id)
  where source = 'AUTO';

create index if not exists print_jobs_org_status_idx
  on public.print_jobs (organization_id, status, created_at);

create index if not exists print_agents_token_prefix_idx
  on public.print_agents (token_prefix);

drop trigger if exists set_print_settings_updated_at on public.print_settings;
create trigger set_print_settings_updated_at
  before update on public.print_settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_print_agents_updated_at on public.print_agents;
create trigger set_print_agents_updated_at
  before update on public.print_agents
  for each row execute function public.set_updated_at();

drop trigger if exists set_print_jobs_updated_at on public.print_jobs;
create trigger set_print_jobs_updated_at
  before update on public.print_jobs
  for each row execute function public.set_updated_at();

alter table public.print_settings enable row level security;
alter table public.print_agents enable row level security;
alter table public.print_jobs enable row level security;

drop policy if exists print_settings_select on public.print_settings;
create policy print_settings_select on public.print_settings
  for select using (public.is_org_member(organization_id));
drop policy if exists print_settings_write on public.print_settings;
create policy print_settings_write on public.print_settings
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  );

drop policy if exists print_agents_select on public.print_agents;
create policy print_agents_select on public.print_agents
  for select using (public.is_org_member(organization_id));
drop policy if exists print_agents_write on public.print_agents;
create policy print_agents_write on public.print_agents
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  );

drop policy if exists print_jobs_select on public.print_jobs;
create policy print_jobs_select on public.print_jobs
  for select using (public.is_org_member(organization_id));
drop policy if exists print_jobs_write on public.print_jobs;
create policy print_jobs_write on public.print_jobs
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

alter table public.print_jobs replica identity full;
alter table public.print_agents replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.print_jobs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.print_agents;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
