select current_database() as db;
select version from supabase_migrations.schema_migrations where version = '20261030143000';
select
  (select count(*) from public.organizations) as orgs,
  (select count(*) from public.addresses) as addrs,
  (select count(*) from public.orders) as orders;
select
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'addresses' and column_name = 'address_manual_override'
  ) as has_override,
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'addresses' and column_name = 'address_validation_status'
  ) as has_status;
