-- Merchant packing labels: org templates, label kind, unique files, per-job paper size.

alter table public.print_settings
  drop constraint if exists print_settings_paper_size_chk;

alter table public.print_settings
  add constraint print_settings_paper_size_chk
  check (paper_size in ('A6', 'A5', 'A4', '4x6'));

alter table public.print_settings
  add column if not exists auto_print_merchant boolean not null default true;

comment on column public.print_settings.auto_print_merchant is
  'Automatically enqueue a print job for the merchant packing label after it is saved.';

alter table public.print_jobs
  add column if not exists paper_size text;

alter table public.print_jobs
  drop constraint if exists print_jobs_paper_size_chk;

alter table public.print_jobs
  add constraint print_jobs_paper_size_chk
  check (paper_size is null or paper_size in ('A6', 'A5', 'A4', '4x6'));

alter table public.print_jobs
  add column if not exists copies integer;

alter table public.print_jobs
  drop constraint if exists print_jobs_copies_chk;

alter table public.print_jobs
  add constraint print_jobs_copies_chk
  check (copies is null or (copies >= 1 and copies <= 5));

alter table public.labels
  add column if not exists kind text not null default 'INDIA_POST';

alter table public.labels
  drop constraint if exists labels_kind_chk;

alter table public.labels
  add constraint labels_kind_chk
  check (kind in ('INDIA_POST', 'MERCHANT'));

alter table public.labels
  add column if not exists template_snapshot jsonb;

create table if not exists public.label_templates (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  template jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.label_templates enable row level security;

drop policy if exists label_templates_select on public.label_templates;
create policy label_templates_select on public.label_templates
  for select using (public.is_org_member(organization_id));

drop policy if exists label_templates_write on public.label_templates;
create policy label_templates_write on public.label_templates
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop trigger if exists set_label_templates_updated_at on public.label_templates;
create trigger set_label_templates_updated_at
  before update on public.label_templates
  for each row execute function public.set_updated_at();

insert into public.label_templates (organization_id, template)
select id, '{}'::jsonb
from public.organizations
on conflict (organization_id) do nothing;
