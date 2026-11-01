-- Isolated local Docker only (supabase_db_postbuslocal). Do not apply to production.

select json_build_object(
  'rpc_exists', exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'replace_shopify_order_line_items'
  ),
  'source_line_item_id', exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_line_items' and column_name = 'source_line_item_id'
  ),
  'unfulfilled_quantity', exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_line_items' and column_name = 'unfulfilled_quantity'
  ),
  'requires_shipping', exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_line_items' and column_name = 'requires_shipping'
  ),
  'applied_20261101090000', exists(
    select 1 from supabase_migrations.schema_migrations where version = '20261101090000'
  )
);
