select current_database() as db;
select count(*) as override_col
from information_schema.columns
where table_schema = 'public' and table_name = 'addresses' and column_name = 'address_manual_override';
select version
from supabase_migrations.schema_migrations
where version like '202610301430%';
select count(*) as address_rows from public.addresses;
select count(*) as org_rows from public.organizations;
