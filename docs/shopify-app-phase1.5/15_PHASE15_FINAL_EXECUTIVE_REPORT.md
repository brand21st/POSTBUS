# 15 Phase 1.5 final executive report

## Part A — Executive summary

Phase 1 local tests were **reproduced** (11 files / 51 tests). Hardening added webhook/flag split, stale-uninstall protection, RPC deny, payload limit, BFF rate limit, and extra tests (**12 files / 65 tests**). Production was not touched. Live Shopify Admin iframe remains **PENDING LIVE VERIFICATION**.

## Part B — Implementation status

| Area | Status |
|------|--------|
| App Bridge / UI | Code present; live iframe BLOCKED |
| Authentication | Local PASS; live BLOCKED |
| Token exchange | Mock PASS; live BLOCKED |
| Org provisioning | PGlite PASS |
| Database migration | PGlite PASS; hosted NOT TESTED |
| Webhooks HMAC | PASS; live BLOCKED |
| GDPR | Persist only — FAIL complete |
| CSP | Unit PASS; Admin BLOCKED |
| Feature flags | PASS (UI off; webhooks if public secret set) |

## Part C — Test results

- Stage A reproduce: 11 files, 51 passed, 0 failed.
- After hardening: 12 files, 65 passed, 0 failed.
- Live Admin checklist 01–25: 25 BLOCKED.
- Hosted migrate: 0 (forbidden).

## Part D — Security status

- No remaining P0 in local code review after hardening.
- High: GDPR not processed; live iframe unverified; multi-instance refresh lock.
- Residual: static `*.myshopify.com` frame-ancestors (Shopify-documented pattern, not query interpolation).

## Part E — Environment

Local verification PASS. Database = PGlite only. Development store BLOCKED. Production untouched PASS (`hgacoeoovjxkzfbesmvl` not migrated).

## Part F — Shopify Admin experience

Cannot claim merchants can open PostBus inside Admin. **NOT TESTED live.**

## Part G — Existing SaaS

BYO oauth tests PASS. v1 webhook path unchanged. CEPT/Razorpay unused. Dashboard gate unchanged.

## Part H — Production blockers

See [14_PHASE15_PRODUCTION_BLOCKERS.md](14_PHASE15_PRODUCTION_BLOCKERS.md).

## Part I — Phase 2 readiness

**CONDITIONAL GO**

May begin **offline** Phase 2 design/docs and BFF contracts that reuse `requireShopifyAppContext` + tenant wrapper, without calling live Admin APIs.

**Prohibited until Stage D iframe PASS:** Shopify order sync, booking, barcodes, labels, fulfillment, production flag, production migrate, App Store submit.

## Part J — Recommended Phase 2 sequence (do not implement now)

1. Authorized dev-store iframe + token exchange proof.
2. Isolated DB migrate.
3. Orders BFF (GraphQL Admin only) behind the same ID token.
4. India Post connect in embedded UI (no CEPT from CI).
5. Booking reuse existing locks.
6. Fulfillment/tracking later.
7. Shopify Billing before any App Store listing.
