-- Product catalog photos (up to 3). Public bucket so order and inventory UIs can render them.

alter table public.products
  add column if not exists image_urls text[] not null default '{}';

do $$ begin
  alter table public.products
    add constraint products_image_urls_len_chk
    check (cardinality(image_urls) <= 3);
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists product_images_storage_select on storage.objects;
create policy product_images_storage_select on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists product_images_storage_write on storage.objects;
create policy product_images_storage_write on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and public.inventory_writer((storage.foldername(name))[1]::uuid)
  );

drop policy if exists product_images_storage_update on storage.objects;
create policy product_images_storage_update on storage.objects
  for update using (
    bucket_id = 'product-images'
    and public.inventory_writer((storage.foldername(name))[1]::uuid)
  );

drop policy if exists product_images_storage_delete on storage.objects;
create policy product_images_storage_delete on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and public.inventory_writer((storage.foldername(name))[1]::uuid)
  );
