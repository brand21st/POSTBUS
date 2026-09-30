alter table public.india_post_connections
  add column if not exists pickup_dropoff_office_name text;

update public.india_post_connections
set pickup_dropoff_office_name = 'Kolenchery SO'
where pickup_dropoff_office_id = '22660454'
  and coalesce(btrim(pickup_dropoff_office_name), '') = '';
