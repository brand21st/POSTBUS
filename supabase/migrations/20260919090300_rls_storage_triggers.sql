create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','addresses','pickup_locations','orders','order_line_items','shipments','labels',
    'manifests','shopify_connections','shopify_stores','india_post_connections','barcode_ranges',
    'automation_settings','background_jobs','api_keys','webhook_endpoints','organization_subscriptions'
  ]
  loop
    execute format('drop trigger if exists set_%s_updated_at on public.%I', t, t);
    execute format(
      'create trigger set_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;
alter table public.customers enable row level security;
alter table public.addresses enable row level security;
alter table public.pickup_locations enable row level security;
alter table public.orders enable row level security;
alter table public.order_line_items enable row level security;
alter table public.external_order_references enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_packages enable row level security;
alter table public.labels enable row level security;
alter table public.manifests enable row level security;
alter table public.manifest_shipments enable row level security;
alter table public.tracking_events enable row level security;
alter table public.shopify_connections enable row level security;
alter table public.shopify_stores enable row level security;
alter table public.india_post_connections enable row level security;
alter table public.barcode_ranges enable row level security;
alter table public.automation_settings enable row level security;
alter table public.background_jobs enable row level security;
alter table public.shipment_job_attempts enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.billing_plans enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.invoices enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_org_visible on public.profiles;
create policy profiles_org_visible on public.profiles
  for select using (
    exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on mine.organization_id = theirs.organization_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

drop policy if exists orgs_member on public.organizations;
create policy orgs_member on public.organizations
  for select using (public.is_org_member(id));

drop policy if exists orgs_insert on public.organizations;
create policy orgs_insert on public.organizations
  for insert with check (auth.uid() is not null);

drop policy if exists orgs_update on public.organizations;
create policy orgs_update on public.organizations
  for update using (public.is_org_member(id));

drop policy if exists members_self_or_org on public.organization_members;
create policy members_self_or_org on public.organization_members
  for select using (user_id = auth.uid() or public.is_org_member(organization_id));

drop policy if exists members_insert on public.organization_members;
create policy members_insert on public.organization_members
  for insert with check (user_id = auth.uid() or public.is_org_member(organization_id));

drop policy if exists members_update on public.organization_members;
create policy members_update on public.organization_members
  for update using (public.is_org_member(organization_id));

drop policy if exists members_delete on public.organization_members;
create policy members_delete on public.organization_members
  for delete using (public.is_org_member(organization_id));

drop policy if exists billing_plans_read on public.billing_plans;
create policy billing_plans_read on public.billing_plans
  for select using (auth.uid() is not null);

do $$
declare
  t text;
begin
  foreach t in array array[
    'organization_invites','customers','addresses','pickup_locations','orders','order_line_items',
    'external_order_references','shipments','shipment_packages','labels','manifests','manifest_shipments',
    'tracking_events','shopify_connections','shopify_stores','india_post_connections','barcode_ranges',
    'automation_settings','background_jobs','shipment_job_attempts','idempotency_keys','api_keys',
    'webhook_endpoints','webhook_deliveries','notifications','audit_logs','organization_subscriptions',
    'usage_events','invoices'
  ]
  loop
    execute format('drop policy if exists %I_tenant_all on public.%I', t, t);
    execute format(
      'create policy %I_tenant_all on public.%I for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))',
      t, t
    );
  end loop;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('labels', 'labels', false, 10485760, array['application/pdf']),
  ('manifests', 'manifests', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists labels_tenant_select on storage.objects;
create policy labels_tenant_select on storage.objects
  for select using (
    bucket_id in ('labels', 'manifests')
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists labels_tenant_insert on storage.objects;
create policy labels_tenant_insert on storage.objects
  for insert with check (
    bucket_id in ('labels', 'manifests')
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
