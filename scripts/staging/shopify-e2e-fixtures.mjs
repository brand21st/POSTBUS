/**
 * Staging Postgres fixtures for Shopify partial-payment / lock / invoice safety.
 * Isolated cluster only. No production, no live Shopify, no live India Post.
 */
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";
import { psql } from "./psql.mjs";
import { PGHOST, PGPORT, PGDATABASE } from "./paths.mjs";

printTarget({
  environment: "postbus-staging-local",
  action: "shopify e2e fixtures",
  host: PGHOST,
  port: PGPORT,
  database: PGDATABASE,
});
assertIsolatedTarget("host", PGHOST);

function uuid(text) {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
}

function jsonOut(text) {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  return match ? JSON.parse(match[0]) : text.trim();
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (!pass) console.error("FAIL", name, detail);
  else console.log("PASS", name);
}

const org = uuid(psql("select id from public.organizations limit 1;"));
if (!org) throw new Error("No staging org");

const partial = uuid(
  psql(`
insert into public.orders (organization_id, order_number, status, total_amount, amount_paid, cod_amount, metadata)
values ('${org}', 'STG-E2E-PARTIAL', 'READY', 1049, 314.70, 734.30,
  '{"shopifyPayment":{"updatedAt":"2026-11-01T02:00:00Z"}}'::jsonb)
returning id;
`)
);

const replaced = jsonOut(
  psql(`
select public.replace_shopify_order_line_items(
  '${org}'::uuid, '${partial}'::uuid, '2026-11-01T03:00:00Z'::timestamptz,
  '[{"title":"Product A","sku":"A","quantity":1,"unit_price":1049,"source_line_item_id":"gid://shopify/LineItem/B"}]'::jsonb
);
`)
);
const partialRows = jsonOut(
  psql(`select coalesce(json_agg(source_line_item_id), '[]'::json) from public.order_line_items where order_id='${partial}';`)
);
check("scenario-1-partial-active-only", replaced.action === "replaced" && JSON.stringify(partialRows) === JSON.stringify(["gid://shopify/LineItem/B"]), { replaced, partialRows });

const paid = uuid(
  psql(`
insert into public.orders (organization_id, order_number, status, total_amount, amount_paid, cod_amount)
values ('${org}', 'STG-E2E-PAID', 'READY', 1049, 1049, 0) returning id;
`)
);
const paidRpc = jsonOut(
  psql(`
select public.replace_shopify_order_line_items(
  '${org}'::uuid, '${paid}'::uuid, null,
  '[{"title":"Mug","sku":"M","quantity":1,"unit_price":1049,"source_line_item_id":"gid://shopify/LineItem/P"}]'::jsonb
);
`)
);
check("scenario-2-paid", paidRpc.action === "replaced" && paidRpc.count === 1, paidRpc);

const cod = uuid(
  psql(`
insert into public.orders (organization_id, order_number, status, total_amount, amount_paid, cod_amount)
values ('${org}', 'STG-E2E-COD', 'READY', 499, 0, 499) returning id;
`)
);
const money = jsonOut(
  psql(`select json_build_object('paid', amount_paid, 'cod', cod_amount, 'total', total_amount) from public.orders where id='${cod}';`)
);
check("scenario-3-cod-amounts", Number(money.paid) === 0 && Number(money.cod) === 499 && Number(money.total) === 499, money);

const booked = uuid(
  psql(`
insert into public.orders (organization_id, order_number, status, total_amount)
values ('${org}', 'STG-E2E-BOOKED', 'BOOKED', 1049) returning id;
`)
);
psql(`
insert into public.shipments (organization_id, order_id, status, barcode, booked_at, payment_mode, weight_grams)
values ('${org}', '${booked}', 'BOOKED', 'ET214330016IN', now(), 'COD', 800);
`);
psql(`
insert into public.order_line_items (organization_id, order_id, title, sku, quantity, unit_price, source_line_item_id)
values ('${org}', '${booked}', 'Locked product', 'A', 1, 1049, 'gid://shopify/LineItem/LOCK');
`);
const locked = jsonOut(
  psql(`
select public.replace_shopify_order_line_items(
  '${org}'::uuid, '${booked}'::uuid, '2026-11-01T04:00:00Z'::timestamptz,
  '[{"title":"Should not apply","sku":"X","quantity":2,"unit_price":1,"source_line_item_id":"gid://shopify/LineItem/NEW"}]'::jsonb
);
`)
);
const awb = jsonOut(
  psql(`select json_build_object('barcode', barcode, 'status', status, 'cod_mode', payment_mode, 'grams', weight_grams) from public.shipments where order_id='${booked}';`)
);
const lockedLines = jsonOut(
  psql(`select coalesce(json_agg(source_line_item_id), '[]'::json) from public.order_line_items where order_id='${booked}';`)
);
check(
  "scenario-4-booked-awb-unchanged",
  locked.action === "skipped_locked" && awb.barcode === "ET214330016IN" && JSON.stringify(lockedLines) === JSON.stringify(["gid://shopify/LineItem/LOCK"]),
  { locked, awb, lockedLines }
);

const invoiceOrder = uuid(
  psql(`
insert into public.orders (organization_id, order_number, status)
values ('${org}', 'STG-E2E-INV', 'READY') returning id;
`)
);
psql(`
insert into public.order_line_items (organization_id, order_id, title, quantity, unit_price, source_line_item_id)
values ('${org}', '${invoiceOrder}', 'Historical deposit', 1, 314.70, 'gid://shopify/LineItem/OLD');
`);
const invoice = uuid(
  psql(`
insert into public.sales_invoices (organization_id, order_id, status, lines, grand_total)
values ('${org}', '${invoiceOrder}', 'FINALIZED', '[{"title":"Historical deposit","qty":1}]'::jsonb, 314.70)
returning id;
`)
);
jsonOut(
  psql(`
select public.replace_shopify_order_line_items(
  '${org}'::uuid, '${invoiceOrder}'::uuid, '2026-11-01T05:00:00Z'::timestamptz,
  '[{"title":"Product A","sku":"A","quantity":1,"unit_price":1049,"source_line_item_id":"gid://shopify/LineItem/B"}]'::jsonb
);
`)
);
const invoiceAfter = jsonOut(
  psql(`select json_build_object('status', status, 'lines', lines, 'total', grand_total) from public.sales_invoices where id='${invoice}';`)
);
check(
  "scenario-7-existing-invoice-unchanged",
  invoiceAfter.status === "FINALIZED" && Number(invoiceAfter.total) === 314.7,
  invoiceAfter
);

const orgB = uuid(
  psql(`insert into public.organizations (name) values ('staging-tenant-b') returning id;`)
);
let crossTenant = "not-run";
try {
  psql(`
select public.replace_shopify_order_line_items(
  '${orgB}'::uuid, '${partial}'::uuid, null,
  '[{"title":"X","quantity":1,"unit_price":1}]'::jsonb
);
`);
  crossTenant = "unexpected-success";
} catch (error) {
  crossTenant = error instanceof Error ? error.message : String(error);
}
check("scenario-8-cross-tenant-rejected", /order not found/i.test(crossTenant), crossTenant.slice(0, 180));

const failed = checks.filter((row) => !row.pass);
console.log(JSON.stringify({ ok: failed.length === 0, passed: checks.filter((row) => row.pass).length, failed: failed.length, productionUnused: true }, null, 2));
if (failed.length) process.exit(1);
console.log("Production project hgacoeoovjxkzfbesmvl was not used.");
