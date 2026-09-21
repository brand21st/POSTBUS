alter table public.organizations
  add column if not exists phone text,
  add column if not exists line1 text,
  add column if not exists line2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists pincode text,
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-assets',
  'organization-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists organization_assets_storage_select on storage.objects;
create policy organization_assets_storage_select on storage.objects
  for select using (bucket_id = 'organization-assets');

drop policy if exists organization_assets_storage_write on storage.objects;
create policy organization_assets_storage_write on storage.objects
  for insert with check (
    bucket_id = 'organization-assets'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists organization_assets_storage_update on storage.objects;
create policy organization_assets_storage_update on storage.objects
  for update using (
    bucket_id = 'organization-assets'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists organization_assets_storage_delete on storage.objects;
create policy organization_assets_storage_delete on storage.objects
  for delete using (
    bucket_id = 'organization-assets'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
