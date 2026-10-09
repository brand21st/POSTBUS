-- PostBus Support Center: ticket projection, WhatsApp conversation store, per-org flag.
-- Default off. Ingest and merchant UI stay disabled until OWNER/ADMIN enable the flag
-- and a merchant Vachat connection is CONNECTED.

alter table public.organizations
  add column if not exists support_center_enabled boolean not null default false;

comment on column public.organizations.support_center_enabled is
  'Merchant Support Center (inbox + tickets). Off by default. Does not affect shipping Vachat notices.';

create table if not exists public.support_ticket_counters (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year integer not null,
  last_value integer not null default 0,
  primary key (organization_id, year)
);

create table if not exists public.support_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vachat_connection_id uuid references public.vachat_connections(id) on delete set null,
  provider text not null default 'vachat',
  provider_account_id text,
  phone_number_id text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null references public.support_channels(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  provider_conversation_id text,
  phone_digits text not null,
  customer_name text,
  last_message_preview text,
  last_message_at timestamptz,
  last_customer_message_at timestamptz,
  service_window_expires_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel_id, phone_digits)
);

create unique index if not exists support_conversations_provider_uidx
  on public.support_conversations (organization_id, channel_id, provider_conversation_id)
  where provider_conversation_id is not null;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  public_number text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  category text not null default 'general_inquiry',
  assigned_to uuid references public.profiles(id) on delete set null,
  classification text,
  sla_due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, public_number)
);

alter table public.support_tickets
  drop constraint if exists support_tickets_status_chk;
alter table public.support_tickets
  add constraint support_tickets_status_chk check (status in (
    'open', 'in_progress', 'pending_customer', 'pending_merchant', 'resolved', 'closed', 'reopened'
  ));

alter table public.support_tickets
  drop constraint if exists support_tickets_priority_chk;
alter table public.support_tickets
  add constraint support_tickets_priority_chk check (priority in ('low', 'normal', 'high', 'urgent'));

alter table public.support_tickets
  drop constraint if exists support_tickets_category_chk;
alter table public.support_tickets
  add constraint support_tickets_category_chk check (category in (
    'order_cancellation', 'product_return', 'product_exchange', 'refund_request',
    'delivery_issue', 'damaged_product', 'wrong_product', 'missing_product',
    'general_inquiry', 'other'
  ));

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  ticket_id uuid references public.support_tickets(id) on delete set null,
  direction text not null,
  body text,
  content_type text not null default 'text',
  status text not null default 'received',
  provider_message_id text,
  whatsapp_message_id text,
  client_send_id text,
  provider_timestamp timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, provider_message_id)
);

alter table public.support_messages
  drop constraint if exists support_messages_direction_chk;
alter table public.support_messages
  add constraint support_messages_direction_chk check (direction in ('inbound', 'outbound'));

create unique index if not exists support_messages_client_send_uidx
  on public.support_messages (organization_id, client_send_id)
  where client_send_id is not null;

create table if not exists public.support_message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.support_messages(id) on delete cascade,
  provider_media_id text,
  source_url text,
  storage_path text,
  mime_type text,
  byte_size integer,
  checksum text,
  created_at timestamptz not null default now()
);

create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  from_value text,
  to_value text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.support_ticket_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null unique references public.support_tickets(id) on delete cascade,
  kind text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.support_workflows
  drop constraint if exists support_workflows_kind_chk;
alter table public.support_workflows
  add constraint support_workflows_kind_chk check (kind in ('cancellation', 'return', 'exchange'));

create table if not exists public.support_notification_prefs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  new_ticket boolean not null default true,
  new_message boolean not null default true,
  request_created boolean not null default true,
  assigned boolean not null default true,
  sla_warning boolean not null default true,
  primary key (organization_id, user_id)
);

create index if not exists support_conversations_org_last_idx
  on public.support_conversations (organization_id, last_message_at desc nulls last);
create index if not exists support_messages_thread_idx
  on public.support_messages (conversation_id, provider_timestamp, created_at);
create index if not exists support_tickets_org_status_idx
  on public.support_tickets (organization_id, status, updated_at desc);
create index if not exists support_tickets_assignee_idx
  on public.support_tickets (organization_id, assigned_to, updated_at desc);
create index if not exists support_workflows_org_kind_idx
  on public.support_workflows (organization_id, kind, status);
create index if not exists support_ticket_events_ticket_idx
  on public.support_ticket_events (ticket_id, created_at);

create or replace function public.next_support_ticket_number(p_organization_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  y integer;
  n integer;
begin
  if p_organization_id is null then
    raise exception 'organization required';
  end if;
  if not public.is_org_member(p_organization_id) and auth.role() <> 'service_role' then
    raise exception 'not authorized';
  end if;
  y := extract(year from timezone('utc', now()))::integer;
  insert into public.support_ticket_counters (organization_id, year, last_value)
  values (p_organization_id, y, 1)
  on conflict (organization_id, year)
  do update set last_value = public.support_ticket_counters.last_value + 1
  returning last_value into n;
  return 'PB-TKT-' || y::text || '-' || lpad(n::text, 6, '0');
end;
$$;

revoke all on function public.next_support_ticket_number(uuid) from public, anon;
grant execute on function public.next_support_ticket_number(uuid) to authenticated, service_role;

drop trigger if exists set_support_channels_updated_at on public.support_channels;
create trigger set_support_channels_updated_at
  before update on public.support_channels
  for each row execute function public.set_updated_at();

drop trigger if exists set_support_conversations_updated_at on public.support_conversations;
create trigger set_support_conversations_updated_at
  before update on public.support_conversations
  for each row execute function public.set_updated_at();

drop trigger if exists set_support_tickets_updated_at on public.support_tickets;
create trigger set_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

drop trigger if exists set_support_workflows_updated_at on public.support_workflows;
create trigger set_support_workflows_updated_at
  before update on public.support_workflows
  for each row execute function public.set_updated_at();

alter table public.support_ticket_counters enable row level security;
alter table public.support_channels enable row level security;
alter table public.support_conversations enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_message_attachments enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.support_ticket_notes enable row level security;
alter table public.support_workflows enable row level security;
alter table public.support_notification_prefs enable row level security;

drop policy if exists support_ticket_counters_select on public.support_ticket_counters;
create policy support_ticket_counters_select on public.support_ticket_counters
  for select using (public.is_org_member(organization_id));

drop policy if exists support_channels_select on public.support_channels;
create policy support_channels_select on public.support_channels
  for select using (public.is_org_member(organization_id));

drop policy if exists support_conversations_select on public.support_conversations;
create policy support_conversations_select on public.support_conversations
  for select using (public.is_org_member(organization_id));

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets
  for select using (public.is_org_member(organization_id));

drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages
  for select using (public.is_org_member(organization_id));

drop policy if exists support_attachments_select on public.support_message_attachments;
create policy support_attachments_select on public.support_message_attachments
  for select using (public.is_org_member(organization_id));

drop policy if exists support_events_select on public.support_ticket_events;
create policy support_events_select on public.support_ticket_events
  for select using (public.is_org_member(organization_id));

drop policy if exists support_notes_select on public.support_ticket_notes;
create policy support_notes_select on public.support_ticket_notes
  for select using (public.is_org_member(organization_id));

drop policy if exists support_workflows_select on public.support_workflows;
create policy support_workflows_select on public.support_workflows
  for select using (public.is_org_member(organization_id));

drop policy if exists support_prefs_select on public.support_notification_prefs;
create policy support_prefs_select on public.support_notification_prefs
  for select using (public.is_org_member(organization_id) and user_id = auth.uid());

drop policy if exists support_tickets_write on public.support_tickets;
create policy support_tickets_write on public.support_tickets
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists support_notes_write on public.support_ticket_notes;
create policy support_notes_write on public.support_ticket_notes
  for insert with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists support_events_write on public.support_ticket_events;
create policy support_events_write on public.support_ticket_events
  for insert with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists support_workflows_write on public.support_workflows;
create policy support_workflows_write on public.support_workflows
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists support_prefs_write on public.support_notification_prefs;
create policy support_prefs_write on public.support_notification_prefs
  for all using (public.is_org_member(organization_id) and user_id = auth.uid())
  with check (public.is_org_member(organization_id) and user_id = auth.uid());

drop policy if exists support_conversations_write on public.support_conversations;
create policy support_conversations_write on public.support_conversations
  for update using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists support_messages_write on public.support_messages;
create policy support_messages_write on public.support_messages
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

drop policy if exists support_attachments_write on public.support_message_attachments;
create policy support_attachments_write on public.support_message_attachments
  for insert with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[])
  );

grant select on table public.support_ticket_counters to authenticated;
grant select, insert, update, delete on table public.support_ticket_counters to service_role;
grant select on table public.support_channels to authenticated;
grant select, insert, update, delete on table public.support_channels to service_role;
grant select, update on table public.support_conversations to authenticated;
grant select, insert, update, delete on table public.support_conversations to service_role;
grant select, insert, update on table public.support_tickets to authenticated;
grant select, insert, update, delete on table public.support_tickets to service_role;
grant select, insert, update on table public.support_messages to authenticated;
grant select, insert, update, delete on table public.support_messages to service_role;
grant select, insert on table public.support_message_attachments to authenticated;
grant select, insert, update, delete on table public.support_message_attachments to service_role;
grant select, insert on table public.support_ticket_events to authenticated;
grant select, insert, update, delete on table public.support_ticket_events to service_role;
grant select, insert on table public.support_ticket_notes to authenticated;
grant select, insert, update, delete on table public.support_ticket_notes to service_role;
grant select, insert, update on table public.support_workflows to authenticated;
grant select, insert, update, delete on table public.support_workflows to service_role;
grant select, insert, update, delete on table public.support_notification_prefs to authenticated;
grant select, insert, update, delete on table public.support_notification_prefs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-media',
  'support-media',
  false,
  16777216,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists support_media_storage_select on storage.objects;
create policy support_media_storage_select on storage.objects
  for select using (
    bucket_id = 'support-media'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

do $$
begin
  alter publication supabase_realtime add table public.support_conversations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.support_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.support_tickets;
exception when duplicate_object then null;
end $$;
