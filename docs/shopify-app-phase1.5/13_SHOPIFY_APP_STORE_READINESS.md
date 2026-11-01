# 13 Shopify App Store readiness (precheck)

**Source:** live [AI self-review requirements](https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements) (fetched 2026-10-20). This is **not** App Store approval.

## Summary

✅ **Likely passing:** session-token / App Bridge CDN (`app-bridge.js` before other scripts in [`app/shopify/layout.tsx`](../../app/shopify/layout.tsx)); no fake order stats; no shop-URL install form; no theme store violation detected; no POS third-party.

❌ **Likely failing if submitted today:**

- **1.2.1 Billing:** SaaS uses Razorpay. Public app has no Shopify Billing API / App Pricing. Off-platform app charges cannot be listed.
- **Functional completeness:** no orders/fulfillment UI (2.x merchant value). Settings page is “coming later”.
- **3.1.1 TLS:** `application_url` is `http://localhost:3000/shopify`.
- **GDPR:** persist-only; not complete processing (5.x privacy).

⚠️ **Needs review:**

- **2.2.4 GraphQL Admin API:** Phase 1 has token exchange to `/admin/oauth/access_token` (OAuth, not REST Admin resources). No order GraphQL yet. Acceptable for foundation; Phase 2 must not add REST Admin `.json` APIs.
- **2.3.2 / managed install:** Shopify-managed installation vs classic OAuth callback redirect only.
- Live iframe / incognito session tokens.

⏭️ **Skipped groups:** checkout UI, POS UI, theme app extensions, payments app, capital lending, marketplace — signals not present.

**Billing:** Razorpay does **not** satisfy public App Store billing. Defer to a later Shopify Billing phase.

Resources: [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements), [Billing](https://shopify.dev/docs/apps/launch/billing).
