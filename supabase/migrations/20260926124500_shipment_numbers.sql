-- Stable, human-readable shipment numbers scoped to each organization.

alter table public.shipments
  add column if not exists shipment_number bigint;

with existing_max as (
  select organization_id, coalesce(max(shipment_number), 0) as max_number
  from public.shipments
  group by organization_id
),
numbered as (
  select
    shipment.id,
    coalesce(existing_max.max_number, 0) + row_number() over (
      partition by shipment.organization_id
      order by shipment.created_at asc, shipment.id asc
    )::bigint as shipment_number
  from public.shipments as shipment
  left join existing_max using (organization_id)
  where shipment.shipment_number is null
)
update public.shipments as shipment
set shipment_number = numbered.shipment_number
from numbered
where shipment.id = numbered.id;

create table if not exists public.shipment_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number bigint not null default 0,
  constraint shipment_counters_last_number_chk check (last_number >= 0)
);

insert into public.shipment_counters (organization_id, last_number)
select organization_id, max(shipment_number)
from public.shipments
group by organization_id
on conflict (organization_id)
do update set last_number = greatest(
  public.shipment_counters.last_number,
  excluded.last_number
);

create or replace function public.assign_shipment_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  if new.shipment_number is null then
    insert into public.shipment_counters (organization_id, last_number)
    values (new.organization_id, 1)
    on conflict (organization_id)
    do update set last_number = public.shipment_counters.last_number + 1
    returning last_number into v_number;

    new.shipment_number := v_number;
  else
    insert into public.shipment_counters (organization_id, last_number)
    values (new.organization_id, new.shipment_number)
    on conflict (organization_id)
    do update set last_number = greatest(
      public.shipment_counters.last_number,
      excluded.last_number
    );
  end if;

  return new;
end;
$$;

drop trigger if exists assign_shipment_number_before_insert on public.shipments;
create trigger assign_shipment_number_before_insert
  before insert on public.shipments
  for each row execute function public.assign_shipment_number();

alter table public.shipments
  alter column shipment_number set not null;

alter table public.shipments
  drop constraint if exists shipments_shipment_number_positive;
alter table public.shipments
  add constraint shipments_shipment_number_positive check (shipment_number > 0);

create unique index if not exists shipments_org_shipment_number_uidx
  on public.shipments (organization_id, shipment_number);

alter table public.shipment_counters enable row level security;

revoke all on function public.assign_shipment_number() from public;
