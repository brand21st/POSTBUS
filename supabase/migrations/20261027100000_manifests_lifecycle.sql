-- Manifests lifecycle: one open DRAFT per IST date per India Post booking office,
-- explicit close (locked + numbered), pickup handover, and one manifest per shipment.
-- Functions are SECURITY INVOKER so tenant callers stay under is_org_member RLS.

alter table public.shipments
  add column if not exists booking_office_id text;

comment on column public.shipments.booking_office_id is
  'India Post office_id the article was booked against (pickup_dropoff_office_id in the booking payload). Groups manifests.';

alter table public.manifests
  add column if not exists manifest_number text,
  add column if not exists manifest_date date,
  add column if not exists office_id text,
  add column if not exists office_name text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid,
  add column if not exists reopened_at timestamptz,
  add column if not exists handed_over_at timestamptz,
  add column if not exists handed_over_by uuid,
  add column if not exists handed_over_to text,
  add column if not exists handover_notes text,
  add column if not exists proof_path text;

alter table public.manifest_shipments
  add column if not exists added_at timestamptz not null default now(),
  add column if not exists added_by uuid,
  add column if not exists previous_status public.shipment_status;

-- Legacy rows (status READY/PENDING from the old daily regenerator) become CLOSED history.
-- IST has no DST, so +330 minutes on UTC is exact and needs no tz database.
update public.manifests
set manifest_date = ((created_at at time zone 'UTC') + interval '330 minutes')::date
where manifest_date is null;

with legacy as (
  select
    id,
    row_number() over (partition by organization_id, manifest_date order by created_at, id) as seq
  from public.manifests
  where status not in ('DRAFT', 'CLOSED', 'HANDED_OVER')
)
update public.manifests m
set
  status = 'CLOSED',
  closed_at = coalesce(m.closed_at, m.updated_at, m.created_at),
  manifest_number = coalesce(
    m.manifest_number,
    'MF-' || to_char(m.manifest_date, 'YYYYMMDD') || '-LEGACY-' || lpad(legacy.seq::text, 2, '0')
  )
from legacy
where legacy.id = m.id;

-- A shipment may sit on at most one manifest: keep the newest link.
delete from public.manifest_shipments ms
using (
  select ms2.id
  from public.manifest_shipments ms2
  join public.manifests m2 on m2.id = ms2.manifest_id
  where exists (
    select 1
    from public.manifest_shipments other
    join public.manifests mo on mo.id = other.manifest_id
    where other.shipment_id = ms2.shipment_id
      and (mo.created_at, other.id) > (m2.created_at, ms2.id)
  )
) stale
where ms.id = stale.id;

update public.manifests m
set shipment_count = (select count(*) from public.manifest_shipments ms where ms.manifest_id = m.id);

alter table public.manifests
  alter column status set default 'DRAFT',
  alter column manifest_date set default ((now() at time zone 'UTC') + interval '330 minutes')::date,
  alter column manifest_date set not null;

alter table public.manifests drop constraint if exists manifests_status_chk;
alter table public.manifests
  add constraint manifests_status_chk check (status in ('DRAFT', 'CLOSED', 'HANDED_OVER'));

create unique index if not exists manifests_open_draft_uidx
  on public.manifests (organization_id, manifest_date, (coalesce(office_id, '')))
  where status = 'DRAFT';

create unique index if not exists manifests_org_number_uidx
  on public.manifests (organization_id, manifest_number)
  where manifest_number is not null;

create index if not exists manifests_org_status_date_idx
  on public.manifests (organization_id, status, manifest_date desc);

create unique index if not exists manifest_shipments_shipment_uidx
  on public.manifest_shipments (shipment_id);

create index if not exists manifest_shipments_manifest_idx
  on public.manifest_shipments (manifest_id);

-- Adds eligible shipments to the open draft for (org, date, office), creating it if needed.
-- Returns only links created by this call so callers can fan out side effects once.
create or replace function public.manifest_add_shipments(
  p_org uuid,
  p_date date,
  p_office_id text,
  p_office_name text,
  p_shipment_ids uuid[],
  p_user uuid default null
)
returns table (manifest_id uuid, shipment_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_manifest uuid;
  v_status text;
  v_office text := nullif(btrim(coalesce(p_office_id, '')), '');
  v_attempt integer := 0;
begin
  if p_shipment_ids is null or cardinality(p_shipment_ids) = 0 then
    return;
  end if;

  loop
    v_attempt := v_attempt + 1;
    insert into public.manifests (organization_id, name, status, manifest_date, office_id, office_name, created_by)
    values (
      p_org,
      'Manifest ' || to_char(p_date, 'YYYY-MM-DD') || coalesce(' · ' || nullif(btrim(coalesce(p_office_name, '')), ''), ''),
      'DRAFT',
      p_date,
      v_office,
      nullif(btrim(coalesce(p_office_name, '')), ''),
      p_user
    )
    on conflict (organization_id, manifest_date, (coalesce(office_id, ''))) where status = 'DRAFT'
    do nothing;

    select m.id, m.status into v_manifest, v_status
    from public.manifests m
    where m.organization_id = p_org
      and m.manifest_date = p_date
      and coalesce(m.office_id, '') = coalesce(v_office, '')
      and m.status = 'DRAFT'
    limit 1
    for update;

    exit when v_manifest is not null and v_status = 'DRAFT';
    if v_attempt >= 3 then
      raise exception 'Could not open a draft manifest for %', p_date using errcode = '40001';
    end if;
  end loop;

  if v_office is not null then
    update public.manifests
    set office_name = coalesce(nullif(btrim(coalesce(p_office_name, '')), ''), office_name)
    where id = v_manifest and office_name is null;
  end if;

  return query
  with candidates as (
    select s.id, s.status
    from public.shipments s
    where s.id = any(p_shipment_ids)
      and s.organization_id = p_org
      and s.barcode is not null
      and s.status in ('BOOKED', 'LABEL_PENDING', 'LABEL_READY', 'MANIFEST_PENDING', 'MANIFEST_READY')
    for update of s
  ),
  inserted as (
    insert into public.manifest_shipments (organization_id, manifest_id, shipment_id, added_by, previous_status)
    select p_org, v_manifest, c.id, p_user, c.status
    from candidates c
    on conflict (shipment_id) do nothing
    returning manifest_shipments.manifest_id, manifest_shipments.shipment_id
  ),
  marked as (
    update public.shipments s
    set status = 'MANIFEST_READY', updated_at = now()
    from inserted i
    where s.id = i.shipment_id
    returning s.id
  )
  select i.manifest_id, i.shipment_id from inserted i;

  update public.manifests m
  set
    shipment_count = (select count(*) from public.manifest_shipments ms where ms.manifest_id = v_manifest),
    updated_at = now()
  where m.id = v_manifest;
end;
$$;

create or replace function public.manifest_remove_shipment(p_manifest uuid, p_shipment uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_previous public.shipment_status;
begin
  select status into v_status from public.manifests where id = p_manifest for update;
  if v_status is null then
    raise exception 'Manifest not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'Only draft manifests can be edited. Reopen it first.' using errcode = '55000';
  end if;

  delete from public.manifest_shipments
  where manifest_id = p_manifest and shipment_id = p_shipment
  returning previous_status into v_previous;
  if not found then
    return false;
  end if;

  update public.shipments
  set
    status = case
      when v_previous is null or v_previous in ('MANIFEST_PENDING', 'MANIFEST_READY') then 'LABEL_READY'::public.shipment_status
      else v_previous
    end,
    updated_at = now()
  where id = p_shipment and status = 'MANIFEST_READY';

  update public.manifests
  set
    shipment_count = (select count(*) from public.manifest_shipments ms where ms.manifest_id = p_manifest),
    updated_at = now()
  where id = p_manifest;
  return true;
end;
$$;

-- Adds chosen shipments to a specific draft (manual add from the detail page).
create or replace function public.manifest_add_to(p_manifest uuid, p_shipment_ids uuid[], p_user uuid default null)
returns table (shipment_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row public.manifests%rowtype;
begin
  select * into v_row from public.manifests where id = p_manifest for update;
  if v_row.id is null then
    raise exception 'Manifest not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'DRAFT' then
    raise exception 'Only draft manifests can be edited. Reopen it first.' using errcode = '55000';
  end if;
  return query
  select a.shipment_id
  from public.manifest_add_shipments(
    v_row.organization_id, v_row.manifest_date, v_row.office_id, v_row.office_name, p_shipment_ids, p_user
  ) a;
end;
$$;

create or replace function public.manifest_close(p_manifest uuid, p_user uuid default null)
returns public.manifests
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.manifests%rowtype;
  v_count integer;
  v_prefix text;
  v_seq integer;
begin
  select * into v_row from public.manifests where id = p_manifest for update;
  if v_row.id is null then
    raise exception 'Manifest not found.' using errcode = 'P0002';
  end if;
  if v_row.status <> 'DRAFT' then
    raise exception 'This manifest is already closed.' using errcode = '55000';
  end if;
  select count(*) into v_count from public.manifest_shipments where manifest_id = p_manifest;
  if v_count = 0 then
    raise exception 'Add at least one shipment before closing the manifest.' using errcode = '55000';
  end if;

  if v_row.manifest_number is null then
    v_prefix := 'MF-' || to_char(v_row.manifest_date, 'YYYYMMDD') || '-' || coalesce(nullif(v_row.office_id, ''), 'NA') || '-';
    -- Serialise numbering per org so two closes cannot pick the same sequence.
    perform pg_advisory_xact_lock(hashtext('manifest_number:' || v_row.organization_id::text));
    select coalesce(max(nullif(regexp_replace(substr(manifest_number, length(v_prefix) + 1), '\D', '', 'g'), '')::integer), 0) + 1
      into v_seq
    from public.manifests
    where organization_id = v_row.organization_id
      and manifest_number like v_prefix || '%';
    v_row.manifest_number := v_prefix || lpad(v_seq::text, 2, '0');
  end if;

  update public.manifests
  set
    status = 'CLOSED',
    manifest_number = v_row.manifest_number,
    shipment_count = v_count,
    closed_at = now(),
    closed_by = p_user,
    updated_at = now()
  where id = p_manifest
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.manifest_reopen(p_manifest uuid)
returns public.manifests
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.manifests%rowtype;
begin
  select * into v_row from public.manifests where id = p_manifest for update;
  if v_row.id is null then
    raise exception 'Manifest not found.' using errcode = 'P0002';
  end if;
  if v_row.status = 'HANDED_OVER' then
    raise exception 'Handed-over manifests cannot be reopened.' using errcode = '55000';
  end if;
  if v_row.status <> 'CLOSED' then
    raise exception 'Only closed manifests can be reopened.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.manifests m
    where m.organization_id = v_row.organization_id
      and m.manifest_date = v_row.manifest_date
      and coalesce(m.office_id, '') = coalesce(v_row.office_id, '')
      and m.status = 'DRAFT'
  ) then
    raise exception 'Another draft is already open for this date and office. Close it first.' using errcode = '55000';
  end if;

  update public.manifests
  set status = 'DRAFT', reopened_at = now(), file_path = null, file_url = null, updated_at = now()
  where id = p_manifest
  returning * into v_row;
  return v_row;
end;
$$;

-- Signed handover copies may be photos.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
    set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
    where id = 'manifests';
  end if;
end $$;
