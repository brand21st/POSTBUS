-- Direct USB printers. One default per organization. Agent jobs stay on delivery = agent.

alter table public.print_jobs
  add column if not exists delivery text not null default 'agent';

alter table public.print_jobs
  drop constraint if exists print_jobs_delivery_chk;

alter table public.print_jobs
  add constraint print_jobs_delivery_chk
  check (delivery in ('webusb', 'agent'));

create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  connection_type text not null,
  device_key text not null,
  protocol text not null,
  is_default boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint printers_connection_type_chk check (connection_type in ('webusb', 'agent')),
  constraint printers_protocol_chk check (protocol in ('tspl', 'zpl', 'escpos', 'unknown')),
  constraint printers_display_name_chk check (char_length(btrim(display_name)) between 1 and 80),
  constraint printers_device_key_chk check (device_key ~ '^[a-f0-9]{64}$')
);

create unique index if not exists printers_org_device_key_uidx
  on public.printers (organization_id, device_key);

create unique index if not exists printers_one_default_uidx
  on public.printers (organization_id)
  where is_default;

create index if not exists printers_org_idx
  on public.printers (organization_id, created_at);

drop trigger if exists set_printers_updated_at on public.printers;
create trigger set_printers_updated_at
  before update on public.printers
  for each row execute function public.set_updated_at();

-- Choosing an OS-agent printer clears any USB default in the same statement.
create or replace function public.print_settings_clear_usb_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.selected_printer_name is null or btrim(new.selected_printer_name) = '' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.selected_printer_name is not distinct from old.selected_printer_name then
    return new;
  end if;
  update public.printers
    set is_default = false
    where organization_id = new.organization_id
      and is_default = true;
  return new;
end;
$$;

revoke all on function public.print_settings_clear_usb_default() from public, anon;
grant execute on function public.print_settings_clear_usb_default() to authenticated, service_role;

drop trigger if exists print_settings_clear_usb_default on public.print_settings;
create trigger print_settings_clear_usb_default
  before insert or update on public.print_settings
  for each row execute function public.print_settings_clear_usb_default();

-- One USB default, and the agent printer name is cleared, in a single transaction.
create or replace function public.set_default_printer(p_printer_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.printers;
begin
  select * into v_row
  from public.printers
  where id = p_printer_id;

  if not found then
    raise exception 'Printer not found' using errcode = 'P0002';
  end if;

  if not public.has_org_role(v_row.organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[]) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  update public.printers
    set is_default = false
    where organization_id = v_row.organization_id
      and is_default = true
      and id <> p_printer_id;

  update public.printers
    set is_default = true
    where id = p_printer_id
      and organization_id = v_row.organization_id
    returning * into v_row;

  insert into public.print_settings (organization_id, selected_printer_name)
  values (v_row.organization_id, null)
  on conflict (organization_id) do update
    set selected_printer_name = null;

  return jsonb_build_object(
    'id', v_row.id,
    'organization_id', v_row.organization_id,
    'display_name', v_row.display_name,
    'connection_type', v_row.connection_type,
    'device_key', v_row.device_key,
    'protocol', v_row.protocol,
    'is_default', v_row.is_default,
    'last_seen_at', v_row.last_seen_at
  );
end;
$$;

revoke all on function public.set_default_printer(uuid) from public, anon;
grant execute on function public.set_default_printer(uuid) to authenticated, service_role;

alter table public.printers enable row level security;

drop policy if exists printers_select on public.printers;
create policy printers_select on public.printers
  for select using (public.is_org_member(organization_id));

drop policy if exists printers_write on public.printers;
create policy printers_write on public.printers
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  );

comment on table public.printers is
  'Saved printers for an organization. Live USB connection state is not stored here.';

comment on column public.print_jobs.delivery is
  'webusb jobs are claimed by the browser. agent jobs are claimed by the print agent.';
