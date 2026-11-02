-- Dual-mode Support Center WhatsApp: PostBus global default + optional merchant Vachat.
-- Additive. Does not change shipping vachat_enabled or notification templates.

alter table public.organizations
  add column if not exists support_whatsapp_mode text not null default 'postbus_global';

alter table public.organizations
  drop constraint if exists organizations_support_whatsapp_mode_chk;
alter table public.organizations
  add constraint organizations_support_whatsapp_mode_chk
  check (support_whatsapp_mode in ('postbus_global', 'merchant_vachat'));

comment on column public.organizations.support_whatsapp_mode is
  'Support Center sender. Independent of shipping Vachat credential resolution.';

update public.organizations o
set support_whatsapp_mode = 'merchant_vachat'
where o.support_center_enabled = true
  and exists (
    select 1
    from public.vachat_connections c
    where c.organization_id = o.id
      and c.status = 'CONNECTED'
      and c.encrypted_api_key is not null
  );

alter table public.platform_settings
  add column if not exists vachat_support_enabled boolean not null default false;

comment on column public.platform_settings.vachat_support_enabled is
  'Allow Support Center to send/receive on the Super Admin PostBus WhatsApp number. Does not disable shipping notices.';

alter table public.support_channels
  add column if not exists kind text not null default 'postbus_global';

alter table public.support_channels
  drop constraint if exists support_channels_kind_chk;
alter table public.support_channels
  add constraint support_channels_kind_chk
  check (kind in ('postbus_global', 'merchant_vachat'));

update public.support_channels
set kind = 'merchant_vachat'
where vachat_connection_id is not null;

alter table public.support_channels
  drop constraint if exists support_channels_organization_id_key;

do $$
begin
  alter table public.support_channels drop constraint support_channels_organization_id_key;
exception when undefined_object then null;
end $$;

drop index if exists support_channels_organization_id_key;

create unique index if not exists support_channels_org_kind_uidx
  on public.support_channels (organization_id, kind);

create table if not exists public.support_global_binds (
  id uuid primary key default gen_random_uuid(),
  phone_digits text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists support_global_binds_phone_uidx
  on public.support_global_binds (phone_digits);

create index if not exists support_global_binds_org_idx
  on public.support_global_binds (organization_id, phone_digits);

create table if not exists public.support_unassigned_threads (
  id uuid primary key default gen_random_uuid(),
  phone_digits text not null,
  provider_conversation_id text,
  last_message_preview text,
  last_message_at timestamptz,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists support_unassigned_threads_phone_uidx
  on public.support_unassigned_threads (phone_digits)
  where status = 'open';

create table if not exists public.support_unassigned_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_unassigned_threads(id) on delete cascade,
  provider_message_id text,
  body text,
  content_type text not null default 'text',
  created_at timestamptz not null default now(),
  unique (provider_message_id)
);

alter table public.support_global_binds enable row level security;
alter table public.support_unassigned_threads enable row level security;
alter table public.support_unassigned_messages enable row level security;

revoke all on table public.support_global_binds from anon, authenticated;
revoke all on table public.support_unassigned_threads from anon, authenticated;
revoke all on table public.support_unassigned_messages from anon, authenticated;
grant select, insert, update, delete on table public.support_global_binds to service_role;
grant select, insert, update, delete on table public.support_unassigned_threads to service_role;
grant select, insert, update, delete on table public.support_unassigned_messages to service_role;
