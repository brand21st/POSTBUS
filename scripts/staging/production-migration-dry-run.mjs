/**
 * Print-only production migration dry run.
 * Does not connect to production. Does not apply SQL.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";

printTarget({
  environment: "print-only",
  action: "production migration dry run (no apply)",
  production_project: "hgacoeoovjxkzfbesmvl (blocked write target)",
});
assertIsolatedTarget("script", "127.0.0.1/dry-run");

const files = [
  "supabase/migrations/20261029120001_shopify_fulfillment_eligibility.sql",
  "supabase/migrations/20261101090000_replace_shopify_order_line_items.sql",
];

const destructive =
  /\bdrop table\b|\bdrop column\b|\btruncate\b|\bdelete from\b(?![\s\S]*order_line_items)/i;

const report = files.map((rel) => {
  const sql = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const additive =
    /add column if not exists/i.test(sql) &&
    /create or replace function|create table if not exists/i.test(sql);
  return {
    file: rel,
    bytes: sql.length,
    additiveColumnIfNotExists: /add column if not exists/i.test(sql),
    createOrReplaceFunction: /create or replace function/i.test(sql),
    uniqueIndexOnSourceLineItemId: /unique \(.*source_line_item_id/i.test(sql),
    looksDestructive: destructive.test(sql),
    recommended: "apply on isolated staging first, then production after backup + PostgREST reload",
    applyNow: false,
  };
});

console.log(
  JSON.stringify(
    {
      ok: report.every((row) => !row.looksDestructive && !row.uniqueIndexOnSourceLineItemId),
      write: false,
      applyToProduction: false,
      pendingOnProductionFromLastReadOnlyCheck: [
        "20261029120001_shopify_fulfillment_eligibility",
        "20261101090000_replace_shopify_order_line_items",
      ],
      files: report,
      note: "MCP/production SQL was read-only in the operator session. This script does not open a production connection.",
    },
    null,
    2
  )
);
