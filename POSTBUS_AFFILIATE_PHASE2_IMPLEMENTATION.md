# PostBus affiliate Phase 2 implementation

Phase 1 was kept. No second ledger was added.

## Reused

- `affiliate_accrue`, `affiliate_balance`, `affiliate_request_payout`, `affiliate_settle_payout`
- `affiliate_payment_evidence` and `affiliate_tax_evidence`
- `runAffiliateSweep` and the billing cron
- Ledger kinds `ACCRUAL`, `APPROVAL`, `REVERSAL`, `ADJUSTMENT`, `RESERVATION`, `RELEASE`, `PAYOUT`, `PAYOUT_RETURN`
- Unique `affiliate_commissions.payment_id` and unique `affiliate_ledger_entries.idempotency_key`

## Added

- `supabase/migrations/20261017124000_affiliate_reconciliation.sql`
- `affiliate_reconciliation_report(integer)`, service role only, select-only
- `affiliate_summary.reversed` for reversal paise in the selected date range
- Admin section `report` in `modules/affiliates/api.ts` and `components/affiliates/admin-dashboard.tsx`
- Partner overview card `Reversed` in `components/affiliates/partner-dashboard.tsx`
- PGlite coverage in `modules/affiliates/ledger.pg.test.ts`

## Not changed

- Razorpay signature verification
- India Post booking and tracking
- Payout execution. The partner payout screen stays closed for this phase.
- Historical commission rows. A new policy still does not rewrite them.

## Flags

`POSTBUS_AFFILIATE_ACCRUAL_ENABLED` remains off unless that environment variable is set. The sweep returns before any provider call when accrual is off.
