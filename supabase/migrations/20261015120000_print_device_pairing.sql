-- Additive device pairing for the Windows Print Agent.
-- Does not alter print_agents, print_jobs, print_settings, or automation_settings.

create table if not exists public.print_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_name text not null,
  platform text not null default 'windows',
  os_version text not null default '',
  agent_version text not null default '',
  credential_version integer not null default 1,
  status text not null default 'active',
  last_seen_at timestamptz,
  last_printers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint print_devices_status_chk check (status in ('active', 'revoked')),
  constraint print_devices_name_chk check (char_length(btrim(device_name)) between 1 and 80)
);

create index if not exists print_devices_org_idx on public.print_devices (organization_id, status);

create table if not exists public.print_pairing_challenges (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null,
  verifier_hash text not null unique,
  device_name text not null,
  platform text not null,
  os_version text not null default '',
  agent_version text not null default '',
  status text not null default 'pending',
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  approved_by uuid,
  approved_organization_id uuid references public.organizations(id) on delete cascade,
  approved_organization_name text,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint print_pairing_status_chk check (status in ('pending', 'approved', 'consumed', 'expired', 'locked'))
);

create unique index if not exists print_pairing_open_code_idx
  on public.print_pairing_challenges (code_hash)
  where status in ('pending', 'approved');

create table if not exists public.print_device_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.print_devices(id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create index if not exists print_device_sessions_device_idx on public.print_device_sessions (device_id);

create table if not exists public.print_device_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  device_id uuid references public.print_devices(id) on delete set null,
  challenge_id uuid references public.print_pairing_challenges(id) on delete set null,
  event_type text not null,
  event_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists print_device_events_org_idx on public.print_device_events (organization_id, created_at desc);

alter table public.print_devices enable row level security;
alter table public.print_pairing_challenges enable row level security;
alter table public.print_device_sessions enable row level security;
alter table public.print_device_events enable row level security;

drop policy if exists print_devices_member_select on public.print_devices;
create policy print_devices_member_select on public.print_devices
  for select using (public.is_org_member(organization_id));

drop policy if exists print_device_events_member_select on public.print_device_events;
create policy print_device_events_member_select on public.print_device_events
  for select using (organization_id is not null and public.is_org_member(organization_id));

-- Challenges and sessions have no member policies. The service role bypasses RLS.
-- Anon and authenticated clients cannot read token hashes or pairing hashes.
