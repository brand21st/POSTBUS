-- Global VaChat event flags + Super Admin notification log (org-isolated)

alter table public.platform_settings
  add column if not exists vachat_event_settings jsonb not null default '{}'::jsonb,
  add column if not exists vachat_last_test_phone text;

comment on column public.platform_settings.vachat_event_settings is
  'Super Admin kill switches for live VaChat events: order_confirmation, processing, booked, in_transit, delivered.';
comment on column public.platform_settings.vachat_last_test_phone is
  'Last Super Admin TEST WhatsApp number; never a customer phone.';

create table if not exists public.vachat_notification_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  event text not null,
  phone text,
  external_ref text not null,
  vachat_message_id text,
  whatsapp_message_id text,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_ref)
);

create index if not exists vachat_notification_logs_org_created_idx
  on public.vachat_notification_logs (organization_id, created_at desc);
create index if not exists vachat_notification_logs_status_created_idx
  on public.vachat_notification_logs (status, created_at desc);

alter table public.vachat_notification_logs enable row level security;

drop policy if exists vachat_notification_logs_select on public.vachat_notification_logs;
create policy vachat_notification_logs_select on public.vachat_notification_logs
  for select using (public.is_org_member(organization_id));

drop trigger if exists set_vachat_notification_logs_updated_at on public.vachat_notification_logs;
create trigger set_vachat_notification_logs_updated_at
  before update on public.vachat_notification_logs
  for each row execute function public.set_updated_at();

comment on table public.vachat_notification_logs is
  'Per-org VaChat WhatsApp send log. Super Admin reads via service role; merchants see their own org only.';
