# POSTBUS PHASE 3.2 — MIGRATION AUDIT

Inventory (exact order on disk, no ninth 20261017 affiliate file):

1. `supabase/migrations/20261017120000_affiliate_program.sql`
2. `supabase/migrations/20261017121000_affiliate_operations.sql`
3. `supabase/migrations/20261017122000_affiliate_webhook_leases.sql`
4. `supabase/migrations/20261017123000_affiliate_reporting.sql`
5. `supabase/migrations/20261017124000_affiliate_reconciliation.sql`
6. `supabase/migrations/20261017125000_affiliate_partner_portal.sql`
7. `supabase/migrations/20261017130000_subscription_tax_policy.sql`
8. `supabase/migrations/20261017140000_subscription_tax_invoices.sql`

Remote apply of this list is **not** in scope this phase.

## Risk summary (local SQL review, not hosted apply)

| File | Intent | Destructive? | Touches live shipping/orders? |
| --- | --- | --- | --- |
| 120000 | Affiliate program core tables, RLS, opaque codes | Additive | No |
| 121000 | Operations / applications / campaigns | Additive | No |
| 122000 | Webhook lease columns on `razorpay_webhook_events` | Additive ALTER | Existing webhook rows gain columns; no rewrite of payment amounts |
| 123000 | Reporting views/RPCs for partner stats | Additive | No |
| 124000 | Reconciliation helpers | Additive | No |
| 125000 | Partner portal `landing_path` / UTM / `affiliate_partner_link_stats` | Additive | No |
| 130000 | `subscription_tax_policies` / apply-approved-tax | Additive | Does not rewrite historical payments |
| 140000 | Tax invoice **schema** (issuance flag still OFF) | Additive | Does not issue invoices |

## Constraints preserved by design

- Financial ledger immutability (no partner UPDATE of commissions from the client).
- Opaque 24-char public codes; not sequential IDs.
- Organization ownership on merchant-facing objects.
- `SECURITY DEFINER` RPCs must keep `search_path` pinned (verified in SQL files in earlier phases; not re-applied remotely).

## Compatibility limitation

PGlite unit tests prove create/order/idempotency locally. That is **not** hosted Supabase verification. Multi-session PostgreSQL concurrency remains **BLOCKED** without docker/psql or approved staging Postgres.

## Production

These files were **not** applied to `hgacoeoovjxkzfbesmvl`.
