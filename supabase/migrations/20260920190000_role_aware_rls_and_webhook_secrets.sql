-- Role-aware writes for sensitive tenant tables, plus recoverable webhook secrets.

alter table public.webhook_endpoints
  add column if not exists encrypted_secret text;

create or replace function public.has_org_role(org_id uuid, roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role = any(roles)
  );
$$;

revoke all on function public.has_org_role(uuid, public.member_role[]) from public;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;

drop policy if exists orgs_update on public.organizations;
create policy orgs_update on public.organizations
  for update using (public.has_org_role(id, array['OWNER', 'ADMIN']::public.member_role[]));

drop policy if exists members_insert on public.organization_members;
create policy members_insert on public.organization_members
  for insert with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists members_update on public.organization_members;
create policy members_update on public.organization_members
  for update using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists members_delete on public.organization_members;
create policy members_delete on public.organization_members
  for delete using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists organization_invites_tenant_all on public.organization_invites;
create policy organization_invites_select on public.organization_invites
  for select using (public.is_org_member(organization_id));
create policy organization_invites_write on public.organization_invites
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists shopify_connections_tenant_all on public.shopify_connections;
create policy shopify_connections_select on public.shopify_connections
  for select using (public.is_org_member(organization_id));
create policy shopify_connections_write on public.shopify_connections
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists india_post_connections_tenant_all on public.india_post_connections;
create policy india_post_connections_select on public.india_post_connections
  for select using (public.is_org_member(organization_id));
create policy india_post_connections_write on public.india_post_connections
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists barcode_ranges_tenant_all on public.barcode_ranges;
create policy barcode_ranges_select on public.barcode_ranges
  for select using (public.is_org_member(organization_id));
create policy barcode_ranges_write on public.barcode_ranges
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists automation_settings_tenant_all on public.automation_settings;
create policy automation_settings_select on public.automation_settings
  for select using (public.is_org_member(organization_id));
create policy automation_settings_write on public.automation_settings
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[])
  );

drop policy if exists api_keys_tenant_all on public.api_keys;
create policy api_keys_select on public.api_keys
  for select using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );
create policy api_keys_write on public.api_keys
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );

drop policy if exists webhook_endpoints_tenant_all on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints
  for select using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );
create policy webhook_endpoints_write on public.webhook_endpoints
  for all using (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  ) with check (
    public.has_org_role(organization_id, array['OWNER', 'ADMIN']::public.member_role[])
  );
