/**
 * Two real psql sessions against isolated staging Postgres.
 * Never production. Never Shopify HTTP.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { PGBIN, PGHOST, PGPORT, PGUSER, PGDATABASE } from "./paths.mjs";
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";
import { psql } from "./psql.mjs";

printTarget({
  environment: "postbus-staging-local",
  action: "dual-session replace_shopify_order_line_items",
  host: PGHOST,
  port: PGPORT,
  database: PGDATABASE,
});
assertIsolatedTarget("host", PGHOST);
assertIsolatedTarget("database", PGDATABASE);

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(PGBIN, "psql.exe"),
      ["-v", "ON_ERROR_STOP=1", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-tAc", sql],
      { env: { ...process.env, PGSSLMODE: "disable" } }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || stdout || `psql exit ${code}`));
      else resolve(stdout.trim());
    });
  });
}

const org = psql("select id from public.organizations limit 1;")
  .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
if (!org) throw new Error("No staging org");

const order = psql(`
insert into public.orders (organization_id, order_number, status, metadata)
values ('${org}', 'STG-CONCUR-1', 'READY', '{"shopifyPayment":{"updatedAt":"2026-11-01T00:00:00Z"}}'::jsonb)
returning id;
`).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
if (!order) throw new Error("Could not insert concurrency order");

const linesA = `[{"title":"Product A","sku":"A","quantity":1,"unit_price":1049,"source_line_item_id":"gid://shopify/LineItem/2"}]`;
const linesB = `[{"title":"Product A","sku":"A","quantity":1,"unit_price":1049,"source_line_item_id":"gid://shopify/LineItem/2"},{"title":"Product B","sku":"B","quantity":1,"unit_price":499,"source_line_item_id":"gid://shopify/LineItem/9"}]`;

const call = (lines) => `
select public.replace_shopify_order_line_items(
  '${org}'::uuid,
  '${order}'::uuid,
  '2026-11-01T01:00:00Z'::timestamptz,
  '${lines}'::jsonb
);
`;

const started = Date.now();
const [a, b] = await Promise.all([psqlAsync(call(linesA)), psqlAsync(call(linesB))]);
const elapsedMs = Date.now() - started;

const rows = psql(`
select coalesce(json_agg(source_line_item_id order by source_line_item_id), '[]'::json)
from public.order_line_items where order_id = '${order}';
`);
const ids = JSON.parse(rows.replace(/^[^\[]+/, "").match(/\[.*\]/s)?.[0] || "[]");

const mixedIllegal =
  ids.includes("gid://shopify/LineItem/1") ||
  (ids.includes("gid://shopify/LineItem/2") === false && ids.length > 0);

const completeA = ids.length === 1 && ids[0] === "gid://shopify/LineItem/2";
const completeB = ids.length === 2 && ids.includes("gid://shopify/LineItem/2") && ids.includes("gid://shopify/LineItem/9");
const ok = !mixedIllegal && (completeA || completeB);

console.log(
  JSON.stringify(
    {
      ok,
      elapsedMs,
      sessionA: a,
      sessionB: b,
      finalLineItemIds: ids,
      winner: completeB ? "session-B-two-lines" : completeA ? "session-A-one-line" : "unexpected",
      productionUnused: true,
    },
    null,
    2
  )
);

if (!ok) process.exit(1);
console.log("Production project hgacoeoovjxkzfbesmvl was not used.");
