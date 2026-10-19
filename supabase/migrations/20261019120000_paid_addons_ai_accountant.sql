-- Generic paid add-on catalog, independent of shipping subscriptions.
-- AI Accountant financial tables are organization-scoped. Platform admins
-- do not receive default SELECT on merchant books.

alter table public.payments
  add column if not exists payment_purpose text not null default 'subscription';

update public.payments
set payment_purpose = 'ai_credits'
where billing_cycle = 'ai_credits' and payment_purpose = 'subscription';

alter table public.payments
  drop constraint if exists payments_payment_purpose_check;
alter table public.payments
  add constraint payments_payment_purpose_check
  check (payment_purpose in ('subscription', 'ai_credits', 'addon'));

create index if not exists payments_purpose_org_idx
  on public.payments (organization_id, payment_purpose, created_at desc);

create table if not exists public.addon_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  category text,
  monthly_price_paise bigint not null default 0,
  yearly_price_paise bigint not null default 0,
  promo_monthly_price_paise bigint,
  promo_yearly_price_paise bigint,
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  included_assistant_questions integer not null default 50,
  is_active boolean not null default false,
  display_order integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_addon_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  addon_id uuid not null references public.addon_catalog(id) on delete restrict,
  addon_slug text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  status text not null check (status in (
    'PAYMENT_PENDING', 'ACTIVE', 'PAYMENT_FAILED', 'SUSPENDED', 'CANCELLED', 'EXPIRED'
  )),
  amount_paise bigint not null,
  started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  razorpay_order_id text,
  razorpay_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, addon_id)
);

create index if not exists organization_addon_subscriptions_org_status_idx
  on public.organization_addon_subscriptions (organization_id, status);

create table if not exists public.organization_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  addon_slug text not null,
  status text not null,
  access_mode text not null check (access_mode in ('FULL', 'READ_ONLY', 'NONE')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  source_subscription_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, addon_slug)
);

create table if not exists public.accounting_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency text not null default 'INR',
  tax_inclusive boolean not null default true,
  fiscal_year_start_month integer not null default 4,
  gst_registered boolean,
  setup_completed boolean not null default false,
  costs_acknowledged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gst_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  gstin text not null,
  legal_name text,
  state_code text not null,
  scheme text not null default 'REGULAR',
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  unique (organization_id, gstin, effective_from)
);

create table if not exists public.gst_tax_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  hsn_sac text,
  rate_bps integer not null check (rate_bps >= 0),
  cess_bps integer not null default 0,
  effective_from date not null,
  effective_to date,
  label text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  unit_cost numeric(12,2) not null,
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);

create unique index if not exists orders_id_org_uidx on public.orders (id, organization_id);
create unique index if not exists shipments_id_org_uidx on public.shipments (id, organization_id);
create index if not exists shipments_org_barcode_idx on public.shipments (organization_id, barcode);

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in (
    'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'
  )),
  unique (organization_id, code)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_number bigint generated by default as identity,
  memo text,
  source_type text,
  source_id uuid,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, entry_number),
  unique (organization_id, id)
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null,
  account_id uuid not null references public.ledger_accounts(id),
  debit_paise bigint not null default 0 check (debit_paise >= 0),
  credit_paise bigint not null default 0 check (credit_paise >= 0),
  constraint journal_lines_debit_xor_credit check (
    (debit_paise > 0 and credit_paise = 0) or (credit_paise > 0 and debit_paise = 0)
  ),
  constraint journal_lines_entry_org_fk
    foreign key (organization_id, entry_id)
    references public.journal_entries (organization_id, id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null,
  amount numeric(12,2) not null,
  incurred_on date not null,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_name text not null,
  invoice_number text,
  invoice_date date not null,
  taxable_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  gstin text,
  created_at timestamptz not null default now()
);

create table if not exists public.gst_return_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_type text not null check (return_type in ('GSTR1', 'GSTR3B')),
  period_month integer not null check (period_month between 1 and 12),
  period_year integer not null,
  status text not null default 'DRAFT',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, return_type, period_month, period_year)
);

create table if not exists public.gst_filing_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  draft_id uuid references public.gst_return_drafts(id) on delete set null,
  status text not null,
  arn text,
  acknowledgement jsonb,
  filed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cod_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text,
  source_hash text not null,
  report_date date,
  status text not null default 'UPLOADED',
  net_amount numeric(12,2),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, source_hash),
  unique (organization_id, id)
);

create table if not exists public.cod_report_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null,
  article_barcode text not null,
  delivered_on date,
  cod_amount numeric(12,2) not null,
  commission_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null,
  unique (organization_id, report_id, article_barcode),
  unique (organization_id, id),
  constraint cod_report_rows_report_org_fk
    foreign key (organization_id, report_id)
    references public.cod_reports (organization_id, id) on delete cascade
);

create table if not exists public.cod_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_row_id uuid not null,
  shipment_id uuid,
  order_id uuid,
  status text not null,
  expected_cod numeric(12,2),
  reported_cod numeric(12,2),
  variance numeric(12,2),
  reason text,
  created_at timestamptz not null default now(),
  unique (organization_id, report_row_id),
  constraint cod_reconciliations_row_org_fk
    foreign key (organization_id, report_row_id)
    references public.cod_report_rows (organization_id, id) on delete cascade
);

create table if not exists public.financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_month integer not null,
  period_year integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, period_month, period_year)
);

create table if not exists public.ai_accountant_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists public.ai_accountant_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_accountant_messages_thread_org_fk
    foreign key (organization_id, thread_id)
    references public.ai_accountant_threads (organization_id, id) on delete cascade
);

create table if not exists public.addon_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  addon_slug text not null,
  metric text not null,
  quantity integer not null default 1,
  period_start timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.addon_catalog (
  slug, name, description, category,
  monthly_price_paise, yearly_price_paise,
  included_assistant_questions, is_active, display_order
) values (
  'ai-accountant',
  'AI Accountant',
  'AI-powered accounting, automatic GST calculations, COD reconciliation, profit tracking and business insights.',
  'Finance & Accounting',
  99900,
  959040,
  50,
  false,
  10
) on conflict (slug) do nothing;

insert into public.gst_tax_rules (organization_id, hsn_sac, rate_bps, effective_from, label)
select null, null, rate_bps, date '2017-07-01', label
from (values
  (0, 'GST 0%'),
  (500, 'GST 5%'),
  (1200, 'GST 12%'),
  (1800, 'GST 18%'),
  (2800, 'GST 28%')
) as seed(rate_bps, label)
where not exists (
  select 1 from public.gst_tax_rules r
  where r.organization_id is null and r.hsn_sac is null and r.rate_bps = seed.rate_bps
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-accountant',
  'ai-accountant',
  false,
  20971520,
  array['application/pdf', 'text/csv', 'text/plain', 'application/json']
) on conflict (id) do nothing;

alter table public.addon_catalog enable row level security;
alter table public.organization_addon_subscriptions enable row level security;
alter table public.organization_entitlements enable row level security;
alter table public.accounting_settings enable row level security;
alter table public.gst_registrations enable row level security;
alter table public.gst_tax_rules enable row level security;
alter table public.product_costs enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.expenses enable row level security;
alter table public.purchase_invoices enable row level security;
alter table public.gst_return_drafts enable row level security;
alter table public.gst_filing_records enable row level security;
alter table public.cod_reports enable row level security;
alter table public.cod_report_rows enable row level security;
alter table public.cod_reconciliations enable row level security;
alter table public.financial_snapshots enable row level security;
alter table public.ai_accountant_threads enable row level security;
alter table public.ai_accountant_messages enable row level security;
alter table public.addon_usage_events enable row level security;
alter table public.accounting_audit_logs enable row level security;

drop policy if exists addon_catalog_read on public.addon_catalog;
create policy addon_catalog_read on public.addon_catalog
  for select to authenticated using (is_active = true or public.is_platform_admin());

drop policy if exists addon_catalog_admin_write on public.addon_catalog;
create policy addon_catalog_admin_write on public.addon_catalog
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

do $$
declare
  t text;
begin
  foreach t in array array[
    'organization_addon_subscriptions',
    'organization_entitlements',
    'accounting_settings',
    'gst_registrations',
    'product_costs',
    'ledger_accounts',
    'journal_entries',
    'journal_lines',
    'expenses',
    'purchase_invoices',
    'gst_return_drafts',
    'gst_filing_records',
    'cod_reports',
    'cod_report_rows',
    'cod_reconciliations',
    'financial_snapshots',
    'ai_accountant_threads',
    'ai_accountant_messages',
    'addon_usage_events',
    'accounting_audit_logs'
  ]
  loop
    execute format('drop policy if exists %I_tenant_all on public.%I', t, t);
    execute format(
      'create policy %I_tenant_all on public.%I for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))',
      t, t
    );
  end loop;
end $$;

drop policy if exists gst_tax_rules_read on public.gst_tax_rules;
create policy gst_tax_rules_read on public.gst_tax_rules
  for select to authenticated using (organization_id is null or public.is_org_member(organization_id));

drop policy if exists gst_tax_rules_write on public.gst_tax_rules;
create policy gst_tax_rules_write on public.gst_tax_rules
  for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists ai_accountant_storage_select on storage.objects;
create policy ai_accountant_storage_select on storage.objects
  for select using (
    bucket_id = 'ai-accountant'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists ai_accountant_storage_insert on storage.objects;
create policy ai_accountant_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'ai-accountant'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

grant select on public.addon_catalog to authenticated;
grant select, insert, update, delete on public.organization_addon_subscriptions to authenticated;
grant select, insert, update, delete on public.organization_entitlements to authenticated;
grant select, insert, update, delete on public.accounting_settings to authenticated;
grant select, insert, update, delete on public.gst_registrations to authenticated;
grant select, insert, update, delete on public.gst_tax_rules to authenticated;
grant select, insert, update, delete on public.product_costs to authenticated;
grant select, insert, update, delete on public.ledger_accounts to authenticated;
grant select, insert, update, delete on public.journal_entries to authenticated;
grant select, insert, update, delete on public.journal_lines to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.purchase_invoices to authenticated;
grant select, insert, update, delete on public.gst_return_drafts to authenticated;
grant select, insert, update, delete on public.gst_filing_records to authenticated;
grant select, insert, update, delete on public.cod_reports to authenticated;
grant select, insert, update, delete on public.cod_report_rows to authenticated;
grant select, insert, update, delete on public.cod_reconciliations to authenticated;
grant select, insert, update, delete on public.financial_snapshots to authenticated;
grant select, insert, update, delete on public.ai_accountant_threads to authenticated;
grant select, insert, update, delete on public.ai_accountant_messages to authenticated;
grant select, insert, update, delete on public.addon_usage_events to authenticated;
grant select, insert, update, delete on public.accounting_audit_logs to authenticated;
