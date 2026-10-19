-- AI Accountant full build: double-entry ledger, GST tax profiles, expenses,
-- purchases, COD import metadata, assistant tool calls, exports.
-- Also hardens RLS from 20261019120000: merchants could write their own
-- entitlement, add-on subscription and usage rows. Those are now service-role
-- writes only. App routes write books through the service role after the
-- accounting.write permission check; RLS here is defence in depth.

-- ---------------------------------------------------------------------------
-- Billing-owned tables: members may read, never write.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'organization_addon_subscriptions',
    'organization_entitlements',
    'addon_usage_events',
    'accounting_audit_logs'
  ]
  loop
    execute format('drop policy if exists %I_tenant_all on public.%I', t, t);
    execute format('drop policy if exists %I_tenant_read on public.%I', t, t);
    execute format(
      'create policy %I_tenant_read on public.%I for select using (public.is_org_member(organization_id))',
      t, t
    );
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------
alter table public.ledger_accounts
  add column if not exists system_key text,
  add column if not exists is_system boolean not null default false,
  add column if not exists parent_code text,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists ledger_accounts_org_system_key_uidx
  on public.ledger_accounts (organization_id, system_key)
  where system_key is not null;

alter table public.journal_entries
  add column if not exists entry_date date not null default current_date,
  add column if not exists status text not null default 'POSTED',
  add column if not exists source_event text,
  add column if not exists reversal_of uuid,
  add column if not exists created_by uuid;

alter table public.journal_entries drop constraint if exists journal_entries_status_check;
alter table public.journal_entries
  add constraint journal_entries_status_check check (status in ('DRAFT', 'POSTED', 'VOID'));

create unique index if not exists journal_entries_source_uidx
  on public.journal_entries (organization_id, source_type, source_id, source_event)
  where source_type is not null and source_id is not null and source_event is not null;

create index if not exists journal_entries_org_date_idx
  on public.journal_entries (organization_id, entry_date desc);

alter table public.journal_lines
  add column if not exists memo text,
  add column if not exists party text,
  add column if not exists gst_component text;

alter table public.journal_lines drop constraint if exists journal_lines_gst_component_check;
alter table public.journal_lines
  add constraint journal_lines_gst_component_check
  check (gst_component is null or gst_component in ('CGST', 'SGST', 'IGST', 'CESS'));

create index if not exists journal_lines_org_entry_idx on public.journal_lines (organization_id, entry_id);
create index if not exists journal_lines_org_account_idx on public.journal_lines (organization_id, account_id);

-- A posted entry must balance and carry at least two lines. Deferred so the
-- entry and its lines can be written in one transaction. Fires on line writes
-- and on entry insert/status change, so a DRAFT cannot be filled with
-- unbalanced lines and then flipped to POSTED. SECURITY DEFINER: the check must
-- see every line regardless of the caller's RLS visibility.
create or replace function public.accounting_assert_entry_balanced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry uuid;
  v_status text;
  v_debit bigint;
  v_credit bigint;
  v_count integer;
begin
  if tg_table_name = 'journal_entries' then
    v_entry := new.id;
  else
    v_entry := coalesce(new.entry_id, old.entry_id);
  end if;
  select status into v_status from public.journal_entries where id = v_entry;
  if v_status is null or v_status <> 'POSTED' then
    return null;
  end if;
  select coalesce(sum(debit_paise), 0), coalesce(sum(credit_paise), 0), count(*)
    into v_debit, v_credit, v_count
  from public.journal_lines
  where entry_id = v_entry;
  if v_count < 2 or v_debit <> v_credit then
    raise exception 'journal entry % is unbalanced (debit %, credit %, lines %)', v_entry, v_debit, v_credit, v_count
      using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists journal_lines_balanced on public.journal_lines;
create constraint trigger journal_lines_balanced
  after insert or update on public.journal_lines
  deferrable initially deferred
  for each row execute function public.accounting_assert_entry_balanced();

drop trigger if exists journal_entries_balanced on public.journal_entries;
create constraint trigger journal_entries_balanced
  after insert or update of status on public.journal_entries
  deferrable initially deferred
  for each row execute function public.accounting_assert_entry_balanced();

-- Posted lines and entries are immutable; corrections are reversing entries.
create or replace function public.accounting_block_posted_line_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.journal_entries e
    where e.id = old.entry_id and e.status = 'POSTED'
  ) then
    raise exception 'posted journal lines cannot be changed; post a reversal instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists journal_lines_immutable on public.journal_lines;
create trigger journal_lines_immutable
  before update on public.journal_lines
  for each row execute function public.accounting_block_posted_line_update();

create or replace function public.accounting_block_posted_entry_update()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'POSTED' then
    raise exception 'posted journal entries cannot be changed; post a reversal instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_immutable on public.journal_entries;
create trigger journal_entries_immutable
  before update on public.journal_entries
  for each row execute function public.accounting_block_posted_entry_update();

-- Atomic, idempotent posting. Lines: [{account_key|account_code, debit_paise,
-- credit_paise, memo, party, gst_component}]. Returns the entry id (existing
-- one when the source key was already posted).
create or replace function public.accounting_post_entry(
  p_org uuid,
  p_entry jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry uuid;
  v_line jsonb;
  v_account uuid;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'journal entry needs at least two lines' using errcode = '23514';
  end if;
  if p_entry ? 'source_type' and p_entry ? 'source_id' and p_entry ? 'source_event' then
    select id into v_entry
    from public.journal_entries
    where organization_id = p_org
      and source_type = p_entry->>'source_type'
      and source_id = (p_entry->>'source_id')::uuid
      and source_event = p_entry->>'source_event';
    if v_entry is not null then
      return v_entry;
    end if;
  end if;

  insert into public.journal_entries (
    organization_id, memo, source_type, source_id, source_event,
    entry_date, status, reversal_of, created_by, posted_at
  ) values (
    p_org,
    p_entry->>'memo',
    p_entry->>'source_type',
    nullif(p_entry->>'source_id', '')::uuid,
    p_entry->>'source_event',
    coalesce((p_entry->>'entry_date')::date, current_date),
    'POSTED',
    nullif(p_entry->>'reversal_of', '')::uuid,
    nullif(p_entry->>'created_by', '')::uuid,
    now()
  )
  returning id into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select id into v_account
    from public.ledger_accounts
    where organization_id = p_org
      and (
        (v_line ? 'account_key' and system_key = v_line->>'account_key')
        or (v_line ? 'account_code' and code = v_line->>'account_code')
      )
    limit 1;
    if v_account is null then
      raise exception 'unknown ledger account %', coalesce(v_line->>'account_key', v_line->>'account_code')
        using errcode = '23503';
    end if;
    insert into public.journal_lines (
      organization_id, entry_id, account_id, debit_paise, credit_paise, memo, party, gst_component
    ) values (
      p_org,
      v_entry,
      v_account,
      coalesce((v_line->>'debit_paise')::bigint, 0),
      coalesce((v_line->>'credit_paise')::bigint, 0),
      v_line->>'memo',
      v_line->>'party',
      v_line->>'gst_component'
    );
  end loop;

  return v_entry;
exception
  when unique_violation then
    select id into v_entry
    from public.journal_entries
    where organization_id = p_org
      and source_type = p_entry->>'source_type'
      and source_id = (p_entry->>'source_id')::uuid
      and source_event = p_entry->>'source_event';
    if v_entry is null then
      raise;
    end if;
    return v_entry;
end;
$$;

revoke all on function public.accounting_post_entry(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.accounting_post_entry(uuid, jsonb, jsonb) to service_role;

-- Per-account debit/credit totals for a date range; used by trial balance,
-- P&L, cashflow and balance sheet.
create or replace function public.accounting_account_totals(
  p_org uuid,
  p_from date,
  p_to date
)
returns table (
  account_id uuid,
  code text,
  name text,
  type text,
  system_key text,
  debit_paise bigint,
  credit_paise bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.code, a.name, a.type, a.system_key,
         coalesce(sum(l.debit_paise), 0)::bigint,
         coalesce(sum(l.credit_paise), 0)::bigint
  from public.ledger_accounts a
  left join public.journal_lines l
    on l.account_id = a.id
   and l.organization_id = p_org
   and exists (
     select 1 from public.journal_entries e
     where e.id = l.entry_id
       and e.status = 'POSTED'
       and (p_from is null or e.entry_date >= p_from)
       and (p_to is null or e.entry_date <= p_to)
   )
  where a.organization_id = p_org
  group by a.id, a.code, a.name, a.type, a.system_key
  order by a.code;
$$;

revoke all on function public.accounting_account_totals(uuid, date, date) from public, anon, authenticated;
grant execute on function public.accounting_account_totals(uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- GST tax profiles and settings
-- ---------------------------------------------------------------------------
create table if not exists public.product_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  hsn_sac text,
  rate_bps integer not null check (rate_bps between 0 and 4000),
  cess_bps integer not null default 0 check (cess_bps >= 0),
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  unique (organization_id, product_id, effective_from)
);

create index if not exists product_tax_profiles_org_product_idx
  on public.product_tax_profiles (organization_id, product_id, effective_from desc);

alter table public.accounting_settings
  add column if not exists default_rate_bps integer check (default_rate_bps is null or default_rate_bps between 0 and 4000),
  add column if not exists default_hsn text,
  add column if not exists books_start_date date,
  add column if not exists last_synced_at timestamptz;

-- ---------------------------------------------------------------------------
-- Expenses and purchases (paise columns are authoritative)
-- ---------------------------------------------------------------------------
alter table public.expenses
  add column if not exists amount_paise bigint,
  add column if not exists tax_paise bigint not null default 0,
  add column if not exists rate_bps integer not null default 0,
  add column if not exists vendor_name text,
  add column if not exists payment_account_key text not null default 'bank',
  add column if not exists receipt_path text,
  add column if not exists purchase_invoice_id uuid references public.purchase_invoices(id) on delete set null,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

create index if not exists expenses_org_date_idx
  on public.expenses (organization_id, incurred_on desc) where deleted_at is null;

alter table public.purchase_invoices
  add column if not exists taxable_paise bigint,
  add column if not exists cgst_paise bigint not null default 0,
  add column if not exists sgst_paise bigint not null default 0,
  add column if not exists igst_paise bigint not null default 0,
  add column if not exists total_paise bigint,
  add column if not exists rate_bps integer not null default 0,
  add column if not exists place_of_supply text,
  add column if not exists itc_eligible boolean not null default true,
  add column if not exists category text not null default 'inventory',
  add column if not exists payment_account_key text not null default 'accounts_payable',
  add column if not exists receipt_path text,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

create index if not exists purchase_invoices_org_date_idx
  on public.purchase_invoices (organization_id, invoice_date desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- COD import metadata and manual resolution
-- ---------------------------------------------------------------------------
alter table public.cod_reports
  add column if not exists format text,
  add column if not exists column_map jsonb,
  add column if not exists row_count integer not null default 0,
  add column if not exists matched_count integer not null default 0;

alter table public.cod_reports drop constraint if exists cod_reports_format_check;
alter table public.cod_reports
  add constraint cod_reports_format_check
  check (format is null or format in ('XLSX', 'CSV', 'PDF', 'TEXT'));

alter table public.cod_reconciliations
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

create index if not exists cod_reconciliations_org_status_idx
  on public.cod_reconciliations (organization_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Assistant: tool calls and an atomic question quota
-- ---------------------------------------------------------------------------
alter table public.ai_accountant_messages
  add column if not exists tool_calls jsonb,
  add column if not exists model text,
  add column if not exists tokens_in integer,
  add column if not exists tokens_out integer;

alter table public.ai_accountant_threads
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid;

create index if not exists ai_accountant_messages_thread_idx
  on public.ai_accountant_messages (organization_id, thread_id, created_at);

create index if not exists addon_usage_events_org_metric_idx
  on public.addon_usage_events (organization_id, addon_slug, metric, created_at desc);

-- Locks per org+slug, counts usage since period start, inserts one usage row
-- when under the limit. Returns the usage row id (null when exhausted) so a
-- failed provider call can be refunded by deleting that row.
create or replace function public.consume_addon_question(
  p_org uuid,
  p_slug text,
  p_metric text,
  p_period_start timestamptz,
  p_limit integer
)
returns table (usage_id uuid, used integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_slug || ':' || p_metric, 0));
  select coalesce(sum(quantity), 0)::integer into v_used
  from public.addon_usage_events
  where organization_id = p_org
    and addon_slug = p_slug
    and metric = p_metric
    and created_at >= coalesce(p_period_start, 'epoch'::timestamptz);
  if v_used >= p_limit then
    return query select null::uuid, v_used, 0;
    return;
  end if;
  insert into public.addon_usage_events (organization_id, addon_slug, metric, quantity, period_start)
  values (p_org, p_slug, p_metric, 1, p_period_start)
  returning id into v_id;
  return query select v_id, v_used + 1, greatest(0, p_limit - v_used - 1);
end;
$$;

revoke all on function public.consume_addon_question(uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_addon_question(uuid, text, text, timestamptz, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------
create table if not exists public.accounting_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('JOURNAL', 'TRIAL_BALANCE', 'PNL', 'CASHFLOW', 'BALANCE', 'GSTR1', 'GSTR3B', 'COD', 'EXPENSES', 'TALLY')),
  format text not null check (format in ('CSV', 'XLSX', 'XML')),
  period_from date,
  period_to date,
  status text not null default 'READY' check (status in ('READY', 'FAILED')),
  file_path text,
  byte_size integer,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists accounting_exports_org_created_idx
  on public.accounting_exports (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Financial tables: members read, OWNER/ADMIN write (accounting.write).
-- ---------------------------------------------------------------------------
alter table public.product_tax_profiles enable row level security;
alter table public.accounting_exports enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounting_settings',
    'gst_registrations',
    'product_costs',
    'product_tax_profiles',
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
    'accounting_exports'
  ]
  loop
    execute format('drop policy if exists %I_tenant_all on public.%I', t, t);
    execute format('drop policy if exists %I_tenant_read on public.%I', t, t);
    execute format('drop policy if exists %I_tenant_write on public.%I', t, t);
    execute format(
      'create policy %I_tenant_read on public.%I for select using (public.is_org_member(organization_id))',
      t, t
    );
    execute format(
      'create policy %I_tenant_write on public.%I for all using (public.has_org_role(organization_id, array[''OWNER'', ''ADMIN'']::public.member_role[])) with check (public.has_org_role(organization_id, array[''OWNER'', ''ADMIN'']::public.member_role[]))',
      t, t
    );
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

-- The ledger is written only through accounting_post_entry (service role).
-- Signed-in users can read it but never insert, edit or delete rows directly.
revoke insert, update, delete on public.journal_entries from authenticated;
revoke insert, update, delete on public.journal_lines from authenticated;

drop policy if exists ai_accountant_storage_insert on storage.objects;
create policy ai_accountant_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'ai-accountant'
    and public.has_org_role((storage.foldername(name))[1]::uuid, array['OWNER', 'ADMIN']::public.member_role[])
  );

-- Receipts (images) and COD spreadsheets need more MIME types than v1 allowed.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'text/csv', 'text/plain', 'application/json',
  'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/xml', 'text/xml', 'application/octet-stream'
]
where id = 'ai-accountant';
