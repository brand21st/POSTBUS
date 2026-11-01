-- Isolated local Docker only.

grant usage on schema public to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on function public.replace_shopify_order_line_items(uuid, uuid, timestamptz, jsonb) to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, statements, name)
select '20261101090000', array[]::text[], 'replace_shopify_order_line_items'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '20261101090000');

notify pgrst, 'reload schema';

select json_build_object(
  'rpc_exists', exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='replace_shopify_order_line_items'
  ),
  'authenticated_execute', exists(
    select 1 from information_schema.routine_privileges
    where specific_schema='public'
      and routine_name='replace_shopify_order_line_items'
      and grantee='authenticated'
      and privilege_type='EXECUTE'
  ),
  'service_role_execute', exists(
    select 1 from information_schema.routine_privileges
    where specific_schema='public'
      and routine_name='replace_shopify_order_line_items'
      and grantee='service_role'
      and privilege_type='EXECUTE'
  ),
  'migration_recorded', exists(select 1 from supabase_migrations.schema_migrations where version='20261101090000')
);
