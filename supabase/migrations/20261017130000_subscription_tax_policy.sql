-- Approved GST-inclusive subscription tax policies and immutable breakdowns.
-- Does not change plan prices, payment amounts, or historical commissions.
-- Automatic evidence still requires the application flag and a service-role call.

create table if not exists public.billing_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_type text not null default 'SYSTEM'
    check (actor_type in ('SUPER_ADMIN', 'USER', 'SYSTEM', 'WEBHOOK')),
  action text not null,
  target_type text,
  target_id text,
  organization_id uuid,
  ip text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.subscription_tax_policies (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  status text not null check (status in ('DRAFT', 'APPROVED', 'RETIRED')),
  prices_include_tax boolean not null,
  treatment text not null,
  rate_basis_points integer,
  place_of_supply text,
  effective_at timestamptz not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  retired_at timestamptz,
  reason text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint subscription_tax_policy_shape check (
    prices_include_tax
    and (
      (treatment = 'ZERO_RATED' and rate_basis_points = 0 and place_of_supply is null)
      or (treatment = 'SINGLE_RATE_INCLUSIVE' and rate_basis_points between 1 and 9999 and place_of_supply in ('INTRA', 'INTER'))
    )
    and (
      status <> 'APPROVED'
      or (approved_by is not null and approved_at is not null)
    )
  )
);

create index subscription_tax_policy_lookup on public.subscription_tax_policies (status, effective_at desc, version desc);

create table public.subscription_tax_breakdowns (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id),
  organization_id uuid not null,
  subscription_id uuid not null,
  policy_id uuid not null references public.subscription_tax_policies(id),
  policy_version integer not null,
  gross_paise bigint not null check (gross_paise > 0),
  taxable_paise bigint not null check (taxable_paise >= 0),
  cgst_paise bigint not null check (cgst_paise >= 0),
  sgst_paise bigint not null check (sgst_paise >= 0),
  igst_paise bigint not null check (igst_paise >= 0),
  total_tax_paise bigint not null check (total_tax_paise >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  source text not null,
  created_at timestamptz not null default now(),
  constraint subscription_tax_breakdown_balances check (
    taxable_paise + total_tax_paise = gross_paise
    and cgst_paise + sgst_paise + igst_paise = total_tax_paise
  )
);

create index subscription_tax_breakdown_org on public.subscription_tax_breakdowns (organization_id, created_at desc);

create function public.subscription_tax_policy_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Tax policy history cannot be deleted'; end if;
  if old.status = 'DRAFT' and new.status = 'APPROVED' and (
    new.version <> old.version or new.treatment <> old.treatment or new.prices_include_tax <> old.prices_include_tax
    or new.rate_basis_points is distinct from old.rate_basis_points or new.place_of_supply is distinct from old.place_of_supply
    or new.effective_at <> old.effective_at
  ) then raise exception 'Approval cannot change tax values'; end if;
  if old.status <> 'DRAFT' and (
    new.version <> old.version or new.treatment <> old.treatment or new.prices_include_tax <> old.prices_include_tax
    or new.rate_basis_points is distinct from old.rate_basis_points or new.place_of_supply is distinct from old.place_of_supply
    or new.effective_at <> old.effective_at
  ) then raise exception 'Approved tax policy values are immutable'; end if;
  if old.status = 'DRAFT' and new.status not in ('DRAFT', 'APPROVED') then raise exception 'Draft policies can only be approved'; end if;
  if old.status = 'APPROVED' and new.status not in ('APPROVED', 'RETIRED') then raise exception 'Approved policies can only be retired'; end if;
  if old.status = 'RETIRED' and new.status <> 'RETIRED' then raise exception 'Retired policies stay retired'; end if;
  return new;
end $$;

create trigger subscription_tax_policy_guard
  before update or delete on public.subscription_tax_policies
  for each row execute function public.subscription_tax_policy_guard();

create function public.subscription_tax_breakdown_guard() returns trigger language plpgsql as $$
begin
  raise exception 'Subscription tax breakdowns are immutable';
end $$;

create trigger subscription_tax_breakdown_guard
  before update or delete on public.subscription_tax_breakdowns
  for each row execute function public.subscription_tax_breakdown_guard();

create function public.subscription_propose_tax_policy(p_actor uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_version integer;
  v_treatment text := p_data->>'treatment';
  v_rate integer := nullif(p_data->>'rateBasisPoints', '')::integer;
  v_place text := nullif(p_data->>'placeOfSupply', '');
  v_effective timestamptz := (p_data->>'effectiveAt')::timestamptz;
  v_reason text := btrim(coalesce(p_data->>'reason', ''));
begin
  if not exists (select 1 from platform_admins where user_id = p_actor) then raise exception 'Platform admin required'; end if;
  if v_reason = '' or char_length(v_reason) > 500 or v_effective is null then raise exception 'Tax policy details are incomplete'; end if;
  if coalesce((p_data->>'pricesIncludeTax')::boolean, true) is not true then raise exception 'Subscription prices are GST-inclusive'; end if;
  if v_treatment = 'ZERO_RATED' then
    v_rate := 0;
    v_place := null;
  elsif v_treatment = 'SINGLE_RATE_INCLUSIVE' then
    if v_rate is null or v_rate < 1 or v_rate > 9999 or v_place not in ('INTRA', 'INTER') then raise exception 'Approved rate and place of supply are required'; end if;
  else
    raise exception 'Unsupported tax treatment';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('subscription_tax_policy', 0));
  select coalesce(max(version), 0) + 1 into v_version from subscription_tax_policies;
  insert into subscription_tax_policies(version, status, prices_include_tax, treatment, rate_basis_points, place_of_supply, effective_at, reason, created_by)
  values (v_version, 'DRAFT', true, v_treatment, v_rate, v_place, v_effective, v_reason, p_actor)
  returning id into v_id;
  insert into billing_audit_logs(actor_id, actor_type, action, target_type, target_id, metadata)
  values (p_actor, 'SUPER_ADMIN', 'tax_policy.proposed', 'subscription_tax_policy', v_id::text, jsonb_build_object('version', v_version, 'treatment', v_treatment));
  return v_id;
end $$;

create function public.subscription_approve_tax_policy(p_actor uuid, p_policy uuid) returns text
language plpgsql security definer set search_path = public as $$
declare row public.subscription_tax_policies;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor) then raise exception 'Platform admin required'; end if;
  select * into row from subscription_tax_policies where id = p_policy for update;
  if row.id is null or row.status <> 'DRAFT' then raise exception 'Only a draft tax policy can be approved'; end if;
  update subscription_tax_policies
    set status = 'APPROVED', approved_by = p_actor, approved_at = now()
    where id = p_policy;
  insert into billing_audit_logs(actor_id, actor_type, action, target_type, target_id, metadata)
  values (p_actor, 'SUPER_ADMIN', 'tax_policy.approved', 'subscription_tax_policy', p_policy::text, jsonb_build_object('version', row.version));
  return 'APPROVED';
end $$;

create function public.subscription_retire_tax_policy(p_actor uuid, p_policy uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from platform_admins where user_id = p_actor) then raise exception 'Platform admin required'; end if;
  update subscription_tax_policies set status = 'RETIRED', retired_at = now()
    where id = p_policy and status = 'APPROVED';
  if not found then raise exception 'Only an approved tax policy can be retired'; end if;
  insert into billing_audit_logs(actor_id, actor_type, action, target_type, target_id)
  values (p_actor, 'SUPER_ADMIN', 'tax_policy.retired', 'subscription_tax_policy', p_policy::text);
  return 'RETIRED';
end $$;

create function public.subscription_apply_approved_tax(p_payment uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  p public.payments;
  pol public.subscription_tax_policies;
  existing public.subscription_tax_breakdowns;
  prior public.affiliate_tax_evidence;
  gross bigint;
  divisor bigint;
  taxable bigint;
  tax bigint;
  cgst bigint;
  sgst bigint;
  igst bigint;
  refunded bigint;
  refunded_tax bigint;
  when_at timestamptz;
begin
  select * into p from payments where id = p_payment;
  if p.id is null or p.subscription_id is null or p.currency <> 'INR' or p.billing_cycle = 'ai_credits' or p.amount_paise is null or p.amount_paise <= 0 then
    return 'INELIGIBLE';
  end if;
  if not exists (select 1 from subscriptions where id = p.subscription_id and organization_id = p.organization_id) then
    return 'INELIGIBLE';
  end if;
  when_at := coalesce(p.paid_at, p.created_at);
  select * into pol from subscription_tax_policies
    where status = 'APPROVED' and effective_at <= when_at
    order by effective_at desc, version desc
    limit 1;
  if pol.id is null then return 'MISSING_CONFIGURATION'; end if;
  if pol.prices_include_tax is not true or pol.approved_by is null then return 'UNSUPPORTED_TAX_TREATMENT'; end if;
  gross := p.amount_paise;
  if pol.treatment = 'ZERO_RATED' and pol.rate_basis_points = 0 then
    taxable := gross;
    tax := 0;
    cgst := 0;
    sgst := 0;
    igst := 0;
  elsif pol.treatment = 'SINGLE_RATE_INCLUSIVE' and pol.rate_basis_points between 1 and 9999 and pol.place_of_supply in ('INTRA', 'INTER') then
    divisor := 10000 + pol.rate_basis_points;
    taxable := (gross * 10000 + divisor / 2) / divisor;
    tax := gross - taxable;
    if taxable <= 0 or tax <= 0 or taxable + tax <> gross then return 'REVIEW_REQUIRED'; end if;
    if pol.place_of_supply = 'INTER' then
      cgst := 0; sgst := 0; igst := tax;
    else
      cgst := tax / 2; sgst := tax - cgst; igst := 0;
    end if;
  else
    return 'REVIEW_REQUIRED';
  end if;
  select refunded_paise into refunded from affiliate_payment_evidence
    where payment_id = p_payment
    order by refunded_paise desc
    limit 1;
  refunded := coalesce(refunded, 0);
  if refunded < 0 or refunded > gross then return 'REVIEW_REQUIRED'; end if;
  refunded_tax := case when tax = 0 or refunded = 0 then 0 else (tax * refunded + gross / 2) / gross end;
  if refunded_tax > tax or refunded_tax > refunded then return 'REVIEW_REQUIRED'; end if;
  select * into existing from subscription_tax_breakdowns where payment_id = p_payment;
  if existing.id is not null and (existing.gross_paise <> gross or existing.taxable_paise <> taxable or existing.total_tax_paise <> tax) then
    return 'CONFLICT';
  end if;
  select * into prior from affiliate_tax_evidence where payment_id = p_payment and refunded_paise = refunded;
  if prior.id is not null and (prior.tax_paise <> tax or prior.refunded_tax_paise <> refunded_tax) then
    return 'CONFLICT';
  end if;
  if existing.id is null then
    insert into subscription_tax_breakdowns(
      payment_id, organization_id, subscription_id, policy_id, policy_version,
      gross_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_tax_paise, source
    ) values (
      p_payment, p.organization_id, p.subscription_id, pol.id, pol.version,
      gross, taxable, cgst, sgst, igst, tax, 'approved-subscription-tax-policy'
    );
  end if;
  if prior.id is null then
    insert into affiliate_tax_evidence(payment_id, refunded_paise, tax_paise, refunded_tax_paise, reason, actor_id)
    values (p_payment, refunded, tax, refunded_tax, 'Approved subscription tax policy version ' || pol.version, pol.approved_by);
    return 'RECORDED';
  end if;
  return 'ALREADY_RECORDED';
end $$;

revoke all on function public.subscription_propose_tax_policy(uuid, jsonb) from public;
revoke all on function public.subscription_approve_tax_policy(uuid, uuid) from public;
revoke all on function public.subscription_retire_tax_policy(uuid, uuid) from public;
revoke all on function public.subscription_apply_approved_tax(uuid) from public;
grant execute on function public.subscription_propose_tax_policy(uuid, jsonb) to service_role;
grant execute on function public.subscription_approve_tax_policy(uuid, uuid) to service_role;
grant execute on function public.subscription_retire_tax_policy(uuid, uuid) to service_role;
grant execute on function public.subscription_apply_approved_tax(uuid) to service_role;

alter table public.subscription_tax_policies enable row level security;
alter table public.subscription_tax_breakdowns enable row level security;
revoke all on public.subscription_tax_policies from anon, authenticated;
revoke all on public.subscription_tax_breakdowns from anon, authenticated;
grant all on public.subscription_tax_policies to service_role;
grant all on public.subscription_tax_breakdowns to service_role;
