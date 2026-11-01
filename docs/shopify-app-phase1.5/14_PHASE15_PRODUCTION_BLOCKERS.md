# 14 Phase 1.5 production blockers

1. Live Shopify Admin iframe not executed (Stage D not approved).
2. Partner public-app credentials are placeholders.
3. Migration not applied to any hosted DB (correct). Production `hgacoeoovjxkzfbesmvl` must not receive it until a change window.
4. GDPR redact is PENDING_REVIEW only; legal ownership vs standalone SaaS unresolved.
5. No Shopify Billing for a public listing.
6. Token refresh lock is process-local.
7. No HTTPS App URL / webhook registration.
8. Feature flag must stay **false** in production.
9. Phase 2 orders/booking/fulfillment not in scope and not verified.

Rollback: `SHOPIFY_EMBEDDED_APP_ENABLED=false`. Do not drop `shopify_connections`. Do not reverse CEPT bookings.
