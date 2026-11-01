# POSTBUS PHASE 3.2 — RAZORPAY TEST MODE

Classification: **PREPARED**, **UNVERIFIED**. No live Razorpay calls. No second billing engine.

Existing platform billing (`modules/billing/*`) is the only payment path.

## Required before remote test-mode (all missing)

- Isolated staging webhook URL
- `rzp_test_` keys (not `rzp_live_`)
- Test webhook secret
- Explicit test-mode approval
- Synthetic merchant + subscription only

`assertStagingRuntimeEnv` refuses `rzp_live_` if `npm run dev:staging` is used with a properly isolated file.

## Scenarios not executed

Payment verify, webhook signature, ownership, capture, renewal, duplicate webhook, failed payment, refund event, amount mismatch, AI-credit exclusion, storefront exclusion.

Duplicate webhook / idempotency **VERIFIED LOCALLY** in affiliate policy/ledger tests, not against Razorpay’s API.
