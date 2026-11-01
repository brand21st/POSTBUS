-- Subscription tax-invoice drafts and issued snapshots.
-- Does not change plan prices, payment amounts, or affiliate ledger rows.
-- Issuance stays behind the application flag. Empty supplier fields cannot issue.

create table public.subscription_invoice_settings (
  id boolean primary key default true check (id),
  legal_name text not null default '',
  address text not null default '',
  gstin text not null default '',
  numbering_prefix text not null default 'PB',
  financial_year_start_month integer not null default 4 check (financial_year_start_month between 1 and 12),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.subscription_invoice_settings(id) values (true);

create table public.subscription_invoice_counters (
  series text primary key,
  last_value bigint not null check (last_value >= 0)
);

create table public.organization_billing_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  legal_name text not null default '',
  address text not null default '',
  gstin text not null default '',
  updated_at timestamptz not null default now()
);

create table public.subscription_tax_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  subscription_id uuid not null,
  payment_id uuid not null unique references public.payments(id),
  plan_name text not null,
  billing_cycle text not null,
  period_start date,
  period_end date,
  invoice_number text not null unique,
  status text not null default 'ISSUED' check (status = 'ISSUED'),
  gross_paise bigint not null check (gross_paise > 0),
  taxable_paise bigint not null check (taxable_paise >= 0),
  cgst_paise bigint not null check (cgst_paise >= 0),
  sgst_paise bigint not null check (sgst_paise >= 0),
  igst_paise bigint not null check (igst_paise >= 0),
  total_tax_paise bigint not null check (total_tax_paise >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  policy_id uuid not null references public.subscription_tax_policies(id),
  policy_version integer not null,
  supplier_legal_name text not null,
  supplier_address text not null,
  supplier_gstin text not null,
  customer_legal_name text not null,
  customer_address text not null,
  customer_gstin text not null default '',
  place_of_supply text,
  service_description text not null,
  payment_reference text,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint subscription_tax_invoice_balances check (
    taxable_paise + total_tax_paise = gross_paise
    and cgst_paise + sgst_paise + igst_paise = total_tax_paise
  )
);

create index subscription_tax_invoices_org on public.subscription_tax_invoices (organization_id, issued_at desc);

create function public.subscription_tax_invoice_guard() returns trigger language plpgsql as $$
begin
  raise exception 'Issued subscription tax invoices are immutable';
end $$;

create trigger subscription_tax_invoice_guard
  before update or delete on public.subscription_tax_invoices
  for each row execute function public.subscription_tax_invoice_guard();

create function public.subscription_allocate_invoice_number(p_prefix text, p_series text) returns text
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if p_prefix !~ '^[A-Za-z0-9]{1,8}$' or p_series !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Invoice numbering policy is incomplete';
  end if;
  insert into subscription_invoice_counters(series, last_value) values (p_series, 1)
    on conflict (series) do update set last_value = subscription_invoice_counters.last_value + 1
    returning last_value into n;
  return upper(p_prefix) || '/' || p_series || '/' || lpad(n::text, 6, '0');
end $$;

create function public.subscription_issue_tax_invoice(p_actor uuid, p_data jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  existing text;
  stored_gross bigint;
  number text;
  pay public.payments;
  gross bigint := (p_data->>'grossPaise')::bigint;
  taxable bigint := (p_data->>'taxablePaise')::bigint;
  tax bigint := (p_data->>'totalTaxPaise')::bigint;
  cgst bigint := (p_data->>'cgstPaise')::bigint;
  sgst bigint := (p_data->>'sgstPaise')::bigint;
  igst bigint := (p_data->>'igstPaise')::bigint;
  v_payment uuid := (p_data->>'paymentId')::uuid;
begin
  if not exists (select 1 from platform_admins where user_id = p_actor) then raise exception 'Platform admin required'; end if;
  if taxable + tax <> gross or cgst + sgst + igst <> tax or gross <= 0 then raise exception 'Invoice amounts do not reconcile'; end if;
  if btrim(coalesce(p_data->>'supplierLegalName', '')) = '' or btrim(coalesce(p_data->>'supplierAddress', '')) = ''
     or coalesce(p_data->>'supplierGstin', '') !~ '^[0-9A-Za-z]{15}$' then
    raise exception 'Supplier identity is incomplete';
  end if;
  if btrim(coalesce(p_data->>'customerLegalName', '')) = '' or btrim(coalesce(p_data->>'customerAddress', '')) = '' then
    raise exception 'Customer billing identity is incomplete';
  end if;
  if coalesce(p_data->>'customerGstin', '') <> '' and p_data->>'customerGstin' !~ '^[0-9A-Za-z]{15}$' then
    raise exception 'Customer GSTIN is invalid';
  end if;
  select * into pay from payments where id = v_payment;
  if pay.id is null or pay.organization_id <> (p_data->>'organizationId')::uuid or pay.subscription_id <> (p_data->>'subscriptionId')::uuid
     or pay.amount_paise <> gross or pay.currency <> 'INR' or pay.billing_cycle = 'ai_credits' then
    raise exception 'Payment does not match the invoice';
  end if;
  if not exists (
    select 1 from subscription_tax_breakdowns
    where payment_id = pay.id and gross_paise = gross and taxable_paise = taxable and total_tax_paise = tax
      and cgst_paise = cgst and sgst_paise = sgst and igst_paise = igst
      and policy_id = (p_data->>'policyId')::uuid
  ) then raise exception 'Approved tax breakdown is missing'; end if;
  if not exists (select 1 from subscription_tax_policies where id = (p_data->>'policyId')::uuid and status = 'APPROVED') then
    raise exception 'Tax policy is not approved';
  end if;
  select invoice_number, gross_paise into existing, stored_gross from subscription_tax_invoices where payment_id = pay.id;
  if existing is not null then
    if stored_gross <> gross then raise exception 'Invoice conflict'; end if;
    return existing;
  end if;
  number := subscription_allocate_invoice_number(coalesce(nullif(p_data->>'prefix', ''), 'PB'), p_data->>'series');
  insert into subscription_tax_invoices(
    organization_id, subscription_id, payment_id, plan_name, billing_cycle, period_start, period_end,
    invoice_number, gross_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_tax_paise,
    policy_id, policy_version, supplier_legal_name, supplier_address, supplier_gstin,
    customer_legal_name, customer_address, customer_gstin, place_of_supply, service_description, payment_reference
  ) values (
    pay.organization_id, pay.subscription_id, pay.id, p_data->>'planName', p_data->>'billingCycle',
    nullif(p_data->>'periodStart', '')::date, nullif(p_data->>'periodEnd', '')::date,
    number, gross, taxable, cgst, sgst, igst, tax,
    (p_data->>'policyId')::uuid, (p_data->>'policyVersion')::integer,
    btrim(p_data->>'supplierLegalName'), btrim(p_data->>'supplierAddress'), upper(p_data->>'supplierGstin'),
    btrim(p_data->>'customerLegalName'), btrim(p_data->>'customerAddress'), upper(coalesce(p_data->>'customerGstin', '')),
    nullif(p_data->>'placeOfSupply', ''), coalesce(nullif(p_data->>'serviceDescription', ''), 'PostBus subscription'),
    nullif(p_data->>'paymentReference', '')
  );
  insert into billing_audit_logs(actor_id, actor_type, action, target_type, target_id, organization_id, metadata)
  values (p_actor, 'SUPER_ADMIN', 'tax_invoice.issued', 'subscription_tax_invoice', number, pay.organization_id, jsonb_build_object('paymentId', pay.id));
  return number;
end $$;

create function public.subscription_invoice_reconcile(p_payment uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when pay.id is null then 'PAYMENT_MISMATCH'
    when pay.currency <> 'INR' or pay.billing_cycle = 'ai_credits' or pay.subscription_id is null then 'PAYMENT_MISMATCH'
    when not exists (select 1 from subscriptions s where s.id = pay.subscription_id and s.organization_id = pay.organization_id) then 'OWNERSHIP_MISMATCH'
    when b.id is null then 'MISSING_TAX_POLICY'
    when b.gross_paise <> pay.amount_paise or b.taxable_paise + b.total_tax_paise <> b.gross_paise then 'TAX_MISMATCH'
    when i.id is not null and (i.organization_id <> pay.organization_id or i.gross_paise <> pay.amount_paise) then 'OWNERSHIP_MISMATCH'
    when i.id is null then 'MISSING_INVOICE'
    when not exists (select 1 from affiliate_tax_evidence t where t.payment_id = pay.id and t.tax_paise = b.total_tax_paise) then 'MISSING_TAX_EVIDENCE'
    when exists (select 1 from affiliate_payment_evidence e where e.payment_id = pay.id and e.refunded_paise > 0) then 'REFUND_REVIEW'
    else 'MATCHED'
  end
  from (select p_payment as requested_id) requested
  left join payments pay on pay.id = requested.requested_id
  left join subscription_tax_breakdowns b on b.payment_id = pay.id
  left join subscription_tax_invoices i on i.payment_id = pay.id
$$;

create function public.subscription_invoice_org_visible(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = p_org and user_id = auth.uid()
  )
$$;

revoke all on function public.subscription_invoice_org_visible(uuid) from public;
grant execute on function public.subscription_invoice_org_visible(uuid) to authenticated;
revoke all on function public.subscription_allocate_invoice_number(text, text) from public;
revoke all on function public.subscription_issue_tax_invoice(uuid, jsonb) from public;
revoke all on function public.subscription_invoice_reconcile(uuid) from public;
grant execute on function public.subscription_allocate_invoice_number(text, text) to service_role;
grant execute on function public.subscription_issue_tax_invoice(uuid, jsonb) to service_role;
grant execute on function public.subscription_invoice_reconcile(uuid) to service_role;

alter table public.subscription_invoice_settings enable row level security;
alter table public.subscription_invoice_counters enable row level security;
alter table public.organization_billing_profiles enable row level security;
alter table public.subscription_tax_invoices enable row level security;
revoke all on public.subscription_invoice_settings from anon, authenticated;
revoke all on public.subscription_invoice_counters from anon, authenticated;
revoke all on public.organization_billing_profiles from anon, authenticated;
revoke all on public.subscription_tax_invoices from anon, authenticated;
grant all on public.subscription_invoice_settings to service_role;
grant all on public.subscription_invoice_counters to service_role;
grant all on public.organization_billing_profiles to service_role;
grant all on public.subscription_tax_invoices to service_role;
grant select on public.subscription_tax_invoices to authenticated;
create policy own_org_tax_invoice on public.subscription_tax_invoices
  for select to authenticated
  using (public.subscription_invoice_org_visible(organization_id));
