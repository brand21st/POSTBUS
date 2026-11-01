# PostBus affiliate production readiness

Status: not ready for production.

| Area | State |
| --- | --- |
| Local commission, tax classification, and reconciliation | Verified locally |
| Hosted Supabase migrations | Not applied |
| Staging | Blocked. Gate exited 1 |
| Production flags | Untouched and expected off |
| Payouts | Not authorized |
| Automatic GST | Not implemented |

## Blockers

1. Apply the five affiliate SQL files only after the staging gate passes and a person names that project.
2. Prove one staging payment stays at zero commissions until a real tax figure is entered, then accrues once.
3. Keep `POSTBUS_AFFILIATE_ACCRUAL_ENABLED` and `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` off in production until that proof exists.
4. Do not ship the webhook lease behavior inside an unrelated India Post release.

## Approval still required

Remote staging migration, production migration, production deploy, flag changes, and any payout.
