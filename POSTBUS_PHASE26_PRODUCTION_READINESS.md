# PostBus Phase 2.6 production readiness

Status: not ready.

| Area | State |
| --- | --- |
| Inclusive calculation | Verified locally |
| Approved-policy gate | Verified locally |
| Affiliate consumption of that evidence | Verified locally |
| Customer price display | Unchanged on the running pricing page |
| Tax invoice legal fields | Not started |
| Staging migration | Not run |
| Production migration and flags | Untouched |

## Blockers

1. A tax advisor must confirm the rate, place of supply, GSTIN, and invoice content.
2. The six SQL files, including `20261017130000_subscription_tax_policy.sql`, are not on production.
3. Staging has no approved project ref.
4. `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` and the affiliate accrual and payout flags must stay off until a staging payment is shown to accrue once from an approved policy.
5. Business on the connected catalog is ₹3,500 a month. The seed file still says 550000 paise. Neither value may be overwritten from this work.

## Approval still required

Remote staging migration, production migration, production deploy, any flag change, any live price change, and any payout.
