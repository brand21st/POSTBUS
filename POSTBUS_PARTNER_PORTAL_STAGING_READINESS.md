# Staging readiness

BLOCKED until an authorized staging database applies affiliate migrations 20261017120000 through 20261017125000 in order.

`scripts/affiliate-staging-gate.mts` must still fail closed without `staging_approved`.

Do not apply to production. Do not enable `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` or `POSTBUS_AFFILIATE_ACCRUAL_ENABLED` as a side effect of this portal.

After staging apply: create a disposable partner, approve via admin PIN flow, generate a link, click `/?ref=`, sign up a new merchant, confirm attribution. Do not capture live Razorpay or pay partners.
