import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";
import { psql, psqlFile } from "./psql.mjs";
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";

printTarget({
  environment: "postbus-staging-local",
  target_project: "(none — local isolated cluster)",
  action: "apply shopify line-item compat + replace RPC",
});
assertIsolatedTarget("database", "127.0.0.1:55432/postbus_staging");

psqlFile(path.join(REPO_ROOT, "scripts/staging/shopify-compat.sql"));
psqlFile(path.join(REPO_ROOT, "supabase/migrations/20261101090000_replace_shopify_order_line_items.sql"));

const schema = psql(`
select json_build_object(
  'source_line_item_id', exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_line_items' and column_name='source_line_item_id'),
  'unfulfilled_quantity', exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_line_items' and column_name='unfulfilled_quantity'),
  'requires_shipping', exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_line_items' and column_name='requires_shipping'),
  'rpc', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='replace_shopify_order_line_items')
);
`);
console.log("Schema:", schema.trim());

const org = psql("select id from public.organizations limit 1;").match(
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
)?.[0];
if (!org) throw new Error("No staging organization");

const order = psql(`
insert into public.orders (organization_id, order_number, source, status, metadata)
values ('${org}', 'STG-PARTIAL-1', 'SHOPIFY', 'READY', '{"shopifyPayment":{"updatedAt":"2026-10-14T12:00:00Z"}}'::jsonb)
returning id;
`).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
if (!order) throw new Error("Could not insert staging order");

const replaced = psql(`
select public.replace_shopify_order_line_items(
  '${org}'::uuid,
  '${order}'::uuid,
  '2026-10-14T13:00:00Z'::timestamptz,
  '[{"title":"Product A","sku":"A","quantity":1,"unit_price":1049,"source_line_item_id":"gid://shopify/LineItem/2"},{"title":"Product A XL","sku":"A","quantity":1,"unit_price":1049,"source_line_item_id":"gid://shopify/LineItem/3"}]'::jsonb
);
`);
console.log("Replace:", replaced.trim());

const stale = psql(`
select public.replace_shopify_order_line_items(
  '${org}'::uuid,
  '${order}'::uuid,
  '2026-10-14T11:00:00Z'::timestamptz,
  '[{"title":"Deposit","sku":"A","quantity":1,"unit_price":314.70,"source_line_item_id":"gid://shopify/LineItem/1"}]'::jsonb
);
`);
console.log("Stale:", stale.trim());

const rows = psql(`
select json_agg(json_build_object('title', title, 'qty', quantity, 'price', unit_price, 'sid', source_line_item_id) order by source_line_item_id)
from public.order_line_items where order_id = '${order}';
`);
console.log("Rows:", rows.trim());

console.log("Production project hgacoeoovjxkzfbesmvl was not used.");
