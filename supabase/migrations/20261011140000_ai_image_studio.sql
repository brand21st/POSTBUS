-- AI Image Studio: sessions, jobs, assets, OpenRouter image settings, credit reserve/release.

alter table public.platform_settings
  add column if not exists ai_image_studio_enabled boolean not null default false,
  add column if not exists openrouter_image_model text not null default 'google/gemini-2.5-flash-image',
  add column if not exists ai_image_credit_cost integer not null default 10,
  add column if not exists ai_image_max_variations integer not null default 3;

alter table public.platform_settings
  drop constraint if exists platform_settings_ai_image_credit_cost;
alter table public.platform_settings
  add constraint platform_settings_ai_image_credit_cost
    check (ai_image_credit_cost >= 1 and ai_image_credit_cost <= 500);

alter table public.platform_settings
  drop constraint if exists platform_settings_ai_image_max_variations;
alter table public.platform_settings
  add constraint platform_settings_ai_image_max_variations
    check (ai_image_max_variations >= 1 and ai_image_max_variations <= 3);

comment on column public.platform_settings.ai_image_studio_enabled is
  'When true and OpenRouter is connected, merchants can generate product image variants.';
comment on column public.platform_settings.openrouter_image_model is
  'OpenRouter image-capable model id for AI Image Studio edits.';
comment on column public.platform_settings.ai_image_credit_cost is
  'AI credits charged per generated variation.';

alter table public.ai_credit_ledger
  drop constraint if exists ai_credit_ledger_status_chk;
alter table public.ai_credit_ledger
  add constraint ai_credit_ledger_status_chk
    check (status in ('POSTED', 'REVERSED', 'RESERVED', 'RELEASED'));

create table if not exists public.ai_image_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_image_sessions_org_idx
  on public.ai_image_sessions (organization_id, created_at desc);

create table if not exists public.ai_image_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.ai_image_sessions(id) on delete cascade,
  background_job_id uuid references public.background_jobs(id) on delete set null,
  source_asset_id uuid,
  preset text not null,
  festival text,
  aspect text not null default '1:1',
  role text not null default 'main',
  custom_prompt text,
  category_hint text,
  variation_count integer not null default 1,
  credit_qty integer not null,
  status text not null default 'QUEUED',
  provider text not null default 'openrouter',
  model text,
  prompt_meta jsonb not null default '{}'::jsonb,
  offer jsonb not null default '{}'::jsonb,
  error_message text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_image_jobs_status_chk check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  constraint ai_image_jobs_variations_chk check (variation_count >= 1 and variation_count <= 3)
);

create unique index if not exists ai_image_jobs_org_idempotency_uidx
  on public.ai_image_jobs (organization_id, idempotency_key);
create index if not exists ai_image_jobs_org_idx
  on public.ai_image_jobs (organization_id, created_at desc);
create index if not exists ai_image_jobs_session_idx
  on public.ai_image_jobs (session_id, created_at desc);

create table if not exists public.ai_image_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.ai_image_sessions(id) on delete cascade,
  job_id uuid references public.ai_image_jobs(id) on delete cascade,
  kind text not null,
  role text not null default 'main',
  storage_path text not null,
  selected_for_gallery boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ai_image_assets_kind_chk check (kind in ('source', 'generated'))
);

create index if not exists ai_image_assets_session_idx
  on public.ai_image_assets (session_id, created_at desc);
create index if not exists ai_image_assets_job_idx
  on public.ai_image_assets (job_id);

alter table public.ai_image_jobs
  drop constraint if exists ai_image_jobs_source_asset_fk;
alter table public.ai_image_jobs
  add constraint ai_image_jobs_source_asset_fk
    foreign key (source_asset_id) references public.ai_image_assets(id) on delete set null;

drop trigger if exists set_ai_image_sessions_updated_at on public.ai_image_sessions;
create trigger set_ai_image_sessions_updated_at before update on public.ai_image_sessions
  for each row execute function public.set_updated_at();
drop trigger if exists set_ai_image_jobs_updated_at on public.ai_image_jobs;
create trigger set_ai_image_jobs_updated_at before update on public.ai_image_jobs
  for each row execute function public.set_updated_at();

alter table public.ai_image_sessions enable row level security;
alter table public.ai_image_jobs enable row level security;
alter table public.ai_image_assets enable row level security;

drop policy if exists ai_image_sessions_read on public.ai_image_sessions;
create policy ai_image_sessions_read on public.ai_image_sessions
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists ai_image_sessions_write on public.ai_image_sessions;
create policy ai_image_sessions_write on public.ai_image_sessions
  for all to authenticated using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

drop policy if exists ai_image_jobs_read on public.ai_image_jobs;
create policy ai_image_jobs_read on public.ai_image_jobs
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists ai_image_jobs_write on public.ai_image_jobs;
create policy ai_image_jobs_write on public.ai_image_jobs
  for all to authenticated using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

drop policy if exists ai_image_assets_read on public.ai_image_assets;
create policy ai_image_assets_read on public.ai_image_assets
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists ai_image_assets_write on public.ai_image_assets;
create policy ai_image_assets_write on public.ai_image_assets
  for all to authenticated using (public.inventory_writer(organization_id))
  with check (public.inventory_writer(organization_id));

create or replace function public.reserve_ai_credits(
  p_org uuid,
  p_qty integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty integer := greatest(1, coalesce(p_qty, 1));
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'AI_IMAGE_STUDIO');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing public.ai_credit_ledger%rowtype;
  v_remaining integer;
begin
  if v_key is null then
    raise exception 'idempotency_key required';
  end if;

  perform 1 from public.organizations where id = p_org for update;

  select * into v_existing
  from public.ai_credit_ledger
  where organization_id = p_org
    and idempotency_key = v_key
  limit 1;
  if found then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = p_org;
    return jsonb_build_object(
      'remaining', coalesce(v_remaining, v_existing.balance_after),
      'reserved', v_existing.status = 'RESERVED',
      'duplicate', true,
      'status', v_existing.status
    );
  end if;

  update public.organizations
  set ai_credits_balance = ai_credits_balance - v_qty,
      updated_at = now()
  where id = p_org
    and ai_credits_balance >= v_qty
  returning ai_credits_balance into v_remaining;

  if v_remaining is null then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = p_org;
    return jsonb_build_object(
      'remaining', coalesce(v_remaining, 0),
      'reserved', false,
      'duplicate', false,
      'status', 'INSUFFICIENT'
    );
  end if;

  insert into public.ai_credit_ledger (
    organization_id, type, reason_code, delta, balance_after, status, idempotency_key, metadata
  ) values (
    p_org, v_reason, v_reason, -v_qty, v_remaining, 'RESERVED', v_key,
    jsonb_build_object('qty', v_qty)
  );

  return jsonb_build_object(
    'remaining', v_remaining,
    'reserved', true,
    'duplicate', false,
    'status', 'RESERVED'
  );
end;
$$;

create or replace function public.finalize_ai_credit_reservation(
  p_org uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing public.ai_credit_ledger%rowtype;
  v_remaining integer;
begin
  if v_key is null then
    raise exception 'idempotency_key required';
  end if;

  perform 1 from public.organizations where id = p_org for update;

  select * into v_existing
  from public.ai_credit_ledger
  where organization_id = p_org
    and idempotency_key = v_key
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'MISSING');
  end if;

  if v_existing.status = 'POSTED' then
    select coalesce(ai_credits_balance, 0) into v_remaining from public.organizations where id = p_org;
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'POSTED', 'remaining', coalesce(v_remaining, 0));
  end if;
  if v_existing.status <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'status', v_existing.status);
  end if;

  update public.organizations
  set ai_credits_used = ai_credits_used + abs(v_existing.delta),
      updated_at = now()
  where id = p_org
  returning ai_credits_balance into v_remaining;

  update public.ai_credit_ledger
  set status = 'POSTED'
  where id = v_existing.id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'POSTED', 'remaining', coalesce(v_remaining, 0));
end;
$$;

create or replace function public.release_ai_credit_reservation(
  p_org uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_existing public.ai_credit_ledger%rowtype;
  v_qty integer;
  v_remaining integer;
begin
  if v_key is null then
    raise exception 'idempotency_key required';
  end if;

  perform 1 from public.organizations where id = p_org for update;

  select * into v_existing
  from public.ai_credit_ledger
  where organization_id = p_org
    and idempotency_key = v_key
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'MISSING');
  end if;
  if v_existing.status = 'RELEASED' then
    select coalesce(ai_credits_balance, 0) into v_remaining from public.organizations where id = p_org;
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'RELEASED', 'remaining', coalesce(v_remaining, 0));
  end if;
  if v_existing.status <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'status', v_existing.status);
  end if;

  v_qty := abs(v_existing.delta);

  update public.organizations
  set ai_credits_balance = ai_credits_balance + v_qty,
      updated_at = now()
  where id = p_org
  returning ai_credits_balance into v_remaining;

  update public.ai_credit_ledger
  set status = 'RELEASED',
      balance_after = coalesce(v_remaining, v_existing.balance_after + v_qty),
      metadata = coalesce(v_existing.metadata, '{}'::jsonb) || jsonb_build_object('released', true)
  where id = v_existing.id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'RELEASED', 'remaining', coalesce(v_remaining, 0));
end;
$$;

revoke all on function public.reserve_ai_credits(uuid, integer, text, text) from public, anon;
revoke all on function public.finalize_ai_credit_reservation(uuid, text) from public, anon;
revoke all on function public.release_ai_credit_reservation(uuid, text) from public, anon;
grant execute on function public.reserve_ai_credits(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.finalize_ai_credit_reservation(uuid, text) to authenticated, service_role;
grant execute on function public.release_ai_credit_reservation(uuid, text) to authenticated, service_role;
