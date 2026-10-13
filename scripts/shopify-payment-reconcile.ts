/**
 * Read-only / dry-run Shopify payment reconciliation entrypoint.
 * Does not UPDATE, DELETE, book, fulfill, or notify.
 *
 *   npx tsx scripts/shopify-payment-reconcile.ts
 */
import {
  categorizePendingShopifyOrder,
  categorizePrepaidShipmentRisk,
} from "../modules/shopify/reconcile";

console.log(
  JSON.stringify(
    {
      dryRun: true,
      helpers: {
        categorizePendingShopifyOrder: typeof categorizePendingShopifyOrder,
        categorizePrepaidShipmentRisk: typeof categorizePrepaidShipmentRisk,
      },
      note: "Dry-run only. Do not UPDATE/DELETE. An authorized operator later: read PostBus Shopify PENDING orders and PREPAID shipments, GET Admin REST /orders/{id}.json (no PII in logs), pass rows into categorizePendingShopifyOrder / categorizePrepaidShipmentRisk, print bucket counts. CONFIRMED_VALID_PREPAID requires paid/capture evidence, not a booked prepaid AWB alone.",
    },
    null,
    2
  )
);
