# Shopify payment classification

Single mapper: `classifyShopifyRemotePayment` in `modules/shopify/payment.ts`.

Used by webhook import, manual sync, and background sync through `upsertShopifyOrder`.

| Shopify evidence | PostBus status |
|---|---|
| `financial_status` / `displayFinancialStatus` = paid | PAID |
| Successful sale/capture covering the total | PAID |
| pending/authorized + COD gateway name or COD transaction gateway | COD |
| pending + `manual` or empty gateway | PENDING |
| Merchant confirm Prepaid (collection mode) | PAID enum for booking; not proof Shopify captured funds |
| Merchant confirm COD | COD |
| partially_paid | PARTIAL (outstanding → remaining collect) |
| refunded / partially_refunded | REFUNDED |
| voided | FAILED |

`manual` is never COD. Shopify pending is never assumed COD.

Evidence snapshot is stored on `orders.metadata.shopifyPayment` (no new columns).

Shopify PENDING orders cannot be booked to India Post until a merchant confirms Prepaid or COD (`POST /api/v1/orders/:id/shopify-payment`). Processing/packing without booking remains allowed.

Shopify `paid` always wins over a merchant override.
