-- One permanent customer collection link per merchant.
-- Submissions become WhatsApp orders; the public URL stays reusable.

do $$
begin
  alter type public.order_source add value 'WHATSAPP';
exception
  when duplicate_object then null;
end $$;

alter table public.customer_order_links
  alter column expires_at drop not null;

do $$
declare
  rec record;
begin
  for rec in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.customer_order_links'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.customer_order_links drop constraint %I', rec.conname);
  end loop;
end $$;

alter table public.customer_order_links
  add constraint customer_order_links_status_chk
  check (status in (
    'CREATED',
    'OPENED',
    'SUBMITTED',
    'CONFIRMED',
    'EXPIRED',
    'DISABLED',
    'ACTIVE'
  ));

-- Keep historical SUBMITTED/CONFIRMED rows so merchants can still confirm them.
-- Promote exactly one reusable ACTIVE link per organization from unused rows.
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id
      order by (status = 'ACTIVE') desc, created_at desc
    ) as rn
  from public.customer_order_links
  where status in ('CREATED', 'OPENED', 'ACTIVE')
)
update public.customer_order_links as link
set
  status = case when ranked.rn = 1 then 'ACTIVE' else 'DISABLED' end,
  disabled_at = case
    when ranked.rn = 1 then null
    else coalesce(link.disabled_at, now())
  end,
  expires_at = case when ranked.rn = 1 then null else link.expires_at end
from ranked
where link.id = ranked.id;

update public.customer_order_links as link
set public_workspace = coalesce(nullif(link.public_workspace, ''), org.slug)
from public.organizations as org
where org.id = link.organization_id
  and link.status = 'ACTIVE'
  and (link.public_workspace is null or link.public_workspace = '');

with dups as (
  select
    id,
    row_number() over (partition by lower(public_workspace) order by created_at) as rn
  from public.customer_order_links
  where status = 'ACTIVE'
    and public_workspace is not null
)
update public.customer_order_links as link
set public_workspace = link.public_workspace || '-' || substr(replace(link.id::text, '-', ''), 1, 4)
from dups
where link.id = dups.id
  and dups.rn > 1;

create unique index if not exists customer_order_links_one_active_org_idx
  on public.customer_order_links (organization_id)
  where status = 'ACTIVE';

create unique index if not exists customer_order_links_active_workspace_idx
  on public.customer_order_links (lower(public_workspace))
  where status = 'ACTIVE' and public_workspace is not null;

comment on table public.customer_order_links is
  'One permanent public customer collection link per merchant. Each form submit creates a WhatsApp order.';
