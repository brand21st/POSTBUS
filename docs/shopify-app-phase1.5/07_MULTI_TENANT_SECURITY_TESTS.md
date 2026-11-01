# 07 Multi-tenant security tests

**Scope:** Shop A must not access org B. Service-role must be filtered.

**Classification:** PASS for unit/PGlite isolation. Future order APIs: NOT APPLICABLE (Phase 2 not built).

## Evidence

- Identity from verified dest only.
- `createShopifyTenantAdmin` requires org id; always `.eq("organization_id")` / org `id`; forbids `shopify_connections`.
- **Phase 1.5 fix:** `rpc()` throws (no unbounded service-role RPC).
- Unique `shop_domain` prevents a second public-app install row from claiming the same shop.

## Tests

`tenant-admin.test.ts`, `handle.test.ts` org mismatch, PGlite shop A ≠ shop B: PASS.

Live cross-shop Admin session: NOT TESTED.
