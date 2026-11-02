-- Durable India Post multi-article bulk booking. Off by default in the app
-- (INDIA_POST_BULK_ENABLED=false). Does not change C1 lock RPCs, H3 unique
-- active shipment-booking jobs, or claim_background_jobs ordering.

create table if not exists public.india_post_bulk_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  india_post_customer_id text not null,
  contract_id text not null,
  service_code text not null,
  environment text not null check (environment in ('UAT', 'PRODUCTION')),
  status text not null check (status in (
    'PENDING',
    'BUILDING',
    'READY',
    'SUBMITTING',
    'SUBMITTED',
    'RECONCILING',
    'SUCCEEDED',
    'PARTIAL_SUCCESS',
    'FAILED',
    'RECOVERY_REQUIRED'
  )),
  article_count integer not null check (article_count >= 1),
  request_fingerprint text not null,
  job_id uuid references public.background_jobs(id) on delete set null,
  cept_batch_id text,
  correlation_id text,
  submitted_at timestamptz,
  completed_at timestamptz,
  last_error text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.india_post_bulk_batches is
  'One CEPT multi-article POST. Membership is immutable after READY. Ambiguous CEPT outcomes stay RECOVERY_REQUIRED.';

create table if not exists public.india_post_bulk_batch_articles (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.india_post_bulk_batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  barcode text,
  article_result text not null default 'PENDING' check (article_result in (
    'PENDING',
    'SUBMITTED',
    'SUCCEEDED',
    'FAILED',
    'RECOVERY_REQUIRED'
  )),
  last_error text,
  last_error_code text,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (batch_id, shipment_id),
  unique (batch_id, position)
);

comment on table public.india_post_bulk_batch_articles is
  'Immutable membership of a bulk batch. A shipment may belong to at most one active batch.';

-- Same membership must not be booked again after success or partial success.
-- FAILED (zero booked) may reuse the fingerprint for a later attempt.
create unique index if not exists india_post_bulk_batches_active_fingerprint_uidx
  on public.india_post_bulk_batches (organization_id, request_fingerprint)
  where status in (
    'PENDING',
    'BUILDING',
    'READY',
    'SUBMITTING',
    'SUBMITTED',
    'RECONCILING',
    'RECOVERY_REQUIRED',
    'SUCCEEDED',
    'PARTIAL_SUCCESS'
  );

-- Booked or in-flight articles cannot join another batch. FAILED may retry.
create unique index if not exists india_post_bulk_articles_active_shipment_uidx
  on public.india_post_bulk_batch_articles (shipment_id)
  where article_result in ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'RECOVERY_REQUIRED');

create unique index if not exists india_post_bulk_articles_active_barcode_uidx
  on public.india_post_bulk_batch_articles (barcode)
  where barcode is not null
    and btrim(barcode) <> ''
    and article_result in ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'RECOVERY_REQUIRED');

create index if not exists india_post_bulk_batches_org_status_idx
  on public.india_post_bulk_batches (organization_id, status, created_at desc);

drop trigger if exists set_india_post_bulk_batches_updated_at on public.india_post_bulk_batches;
create trigger set_india_post_bulk_batches_updated_at
  before update on public.india_post_bulk_batches
  for each row execute function public.set_updated_at();

alter table public.india_post_bulk_batches enable row level security;
alter table public.india_post_bulk_batch_articles enable row level security;

drop policy if exists india_post_bulk_batches_member on public.india_post_bulk_batches;
create policy india_post_bulk_batches_member on public.india_post_bulk_batches
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists india_post_bulk_batch_articles_member on public.india_post_bulk_batch_articles;
create policy india_post_bulk_batch_articles_member on public.india_post_bulk_batch_articles
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

revoke all on public.india_post_bulk_batches from public, anon;
revoke all on public.india_post_bulk_batch_articles from public, anon;
grant select on table public.india_post_bulk_batches to authenticated;
grant select on table public.india_post_bulk_batch_articles to authenticated;
grant select, insert, update, delete on table public.india_post_bulk_batches to service_role;
grant select, insert, update, delete on table public.india_post_bulk_batch_articles to service_role;

create or replace function public.india_post_bulk_membership_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.batch_id is distinct from old.batch_id
      or new.shipment_id is distinct from old.shipment_id
      or new.position is distinct from old.position
      or new.organization_id is distinct from old.organization_id
      or (old.barcode is not null and new.barcode is distinct from old.barcode) then
      raise exception 'india_post_bulk_batch_articles membership is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists india_post_bulk_membership_immutable on public.india_post_bulk_batch_articles;
create trigger india_post_bulk_membership_immutable
  before update on public.india_post_bulk_batch_articles
  for each row execute function public.india_post_bulk_membership_immutable();

create or replace function public.india_post_bulk_article_org_guard()
returns trigger
language plpgsql
as $$
declare
  v_batch_org uuid;
  v_ship_org uuid;
begin
  select organization_id into v_batch_org from public.india_post_bulk_batches where id = new.batch_id;
  select organization_id into v_ship_org from public.shipments where id = new.shipment_id;
  if v_batch_org is distinct from new.organization_id or v_ship_org is distinct from new.organization_id then
    raise exception 'bulk article organization_id must match batch and shipment';
  end if;
  return new;
end;
$$;

drop trigger if exists india_post_bulk_article_org_guard on public.india_post_bulk_batch_articles;
create trigger india_post_bulk_article_org_guard
  before insert or update on public.india_post_bulk_batch_articles
  for each row execute function public.india_post_bulk_article_org_guard();

create or replace function public.create_india_post_bulk_batch(
  p_organization_id uuid,
  p_india_post_customer_id text,
  p_contract_id text,
  p_service_code text,
  p_environment text,
  p_request_fingerprint text,
  p_job_id uuid,
  p_shipment_ids uuid[],
  p_barcodes text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if cardinality(p_shipment_ids) is null or cardinality(p_shipment_ids) < 2 then
    raise exception 'bulk batch requires at least 2 articles';
  end if;
  if cardinality(p_barcodes) is distinct from cardinality(p_shipment_ids) then
    raise exception 'barcode list must match membership';
  end if;

  insert into public.india_post_bulk_batches (
    organization_id,
    india_post_customer_id,
    contract_id,
    service_code,
    environment,
    status,
    article_count,
    request_fingerprint,
    job_id
  ) values (
    p_organization_id,
    p_india_post_customer_id,
    p_contract_id,
    p_service_code,
    p_environment,
    'READY',
    cardinality(p_shipment_ids),
    p_request_fingerprint,
    p_job_id
  ) returning id into v_id;

  insert into public.india_post_bulk_batch_articles (
    batch_id,
    organization_id,
    shipment_id,
    barcode,
    article_result,
    position
  )
  select
    v_id,
    p_organization_id,
    member.shipment_id,
    nullif(p_barcodes[member.ordinality], ''),
    'PENDING',
    member.ordinality - 1
  from unnest(p_shipment_ids) with ordinality as member(shipment_id, ordinality);

  return v_id;
end;
$$;

revoke all on function public.create_india_post_bulk_batch(uuid, text, text, text, text, text, uuid, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.create_india_post_bulk_batch(uuid, text, text, text, text, text, uuid, uuid[], text[]) to service_role;
