# PostBus affiliate staging migration plan

Do not run this plan until the staging gate exits 0 and a person approves the staging project in the same request.

## Order

Apply these files in order on the approved staging database only:

1. `supabase/migrations/20261017120000_affiliate_program.sql`
2. `supabase/migrations/20261017121000_affiliate_operations.sql`
3. `supabase/migrations/20261017122000_affiliate_webhook_leases.sql`
4. `supabase/migrations/20261017123000_affiliate_reporting.sql`
5. `supabase/migrations/20261017124000_affiliate_reconciliation.sql`

File 3 adds nullable `processing_lease` and `processing_until` on `razorpay_webhook_events`. With the affiliate flag off, the webhook route keeps the original duplicate-event path.

File 5 replaces `affiliate_summary` and creates `affiliate_reconciliation_report`. It inserts no tax and no commissions.

## Local proof

PGlite applies the same five files in `modules/affiliates/ledger.pg.test.ts`. That does not prove Supabase RLS or hosted extension behavior.

## After a future approved apply

1. Flags remain unset.
2. Create a partner, approve them, and attribute one test organization.
3. Capture a test-mode subscription payment.
4. Confirm reconciliation shows `MISSING_TAX_EVIDENCE` and the commission count is 0.
5. Insert one tax row whose paise are below the capture.
6. Confirm one commission. Replay the webhook. Confirm the count stays 1.
7. Do not mark a payout paid.

## Production

These files are not applied on production. An earlier check found `affiliate_settings` absent. Applying file 5 alone fails because `affiliate_summary` calls `affiliate_balance` and reads affiliate tables that are not there.
