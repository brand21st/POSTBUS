# PHASE 3.3 — RAZORPAY WEBHOOK COMPATIBILITY

Migration `20261017122000_affiliate_webhook_leases.sql` is **HIGH-SENSITIVITY**.

## Production table today

Columns: `id`, `event_id` (unique), `event`, `payload`, `status` default `received`, `processed_at`, `error`, `created_at`.

**Missing:** `processing_lease`, `processing_until`.

**Missing RPC:** `claim_razorpay_webhook`.

Rows: 4, all `status=processed`. Additive nullable columns do not rewrite payloads.

## Application coupling

`app/api/webhooks/razorpay/route.ts` calls `claimBillingWebhook` **only when** `POSTBUS_AFFILIATES_ENABLED === "true"`. Duplicates currently return success without the RPC.

If affiliates are enabled **before** 122000: unique retries throw, handler returns **503** “Webhook processing is temporarily unavailable.” That can stall subscription and AI-credit capture.

If affiliates stay **false**: current production webhook path does not require the RPC.

Local PGlite proves lease busy/complete/retry (`ledger.pg.test.ts`). That is not live Razorpay.

## Required sequencing

1. Backup confirmed.  
2. Apply 120000–122000 (minimum before enabling the affiliate flag).  
3. Keep `POSTBUS_AFFILIATES_ENABLED=false` until schema + app are both live.  
4. Only then consider UI activation. Accrual remains a later approval.

Do not enable the affiliate flag on a Coolify deploy that ships this webhook code against a database without `claim_razorpay_webhook`.
