# PostBus affiliate implementation plan

Do not start this implementation from an empty module. The local draft in `modules/affiliates` and the four unapplied SQL files is the implementation. This plan finishes, proves, and documents it. It does not apply SQL to production and does not deploy.

## Phase A — Keep the audit set

Deliverables already in the repo root:

- `POSTBUS_AFFILIATE_AUDIT.md`
- `POSTBUS_AFFILIATE_PRD.md`
- `POSTBUS_AFFILIATE_ARCHITECTURE.md`
- `POSTBUS_AFFILIATE_DATABASE_SCHEMA.md`
- `POSTBUS_AFFILIATE_SECURITY_PLAN.md`
- `POSTBUS_AFFILIATE_IMPLEMENTATION_PLAN.md`
- `POSTBUS_AFFILIATE_TEST_PLAN.md`
- `POSTBUS_AFFILIATE_DEPLOYMENT_PLAN.md`

Acceptance: each file describes the current code and marks production apply as not done.

## Phase B — Staging schema

Dependency: a non-production Supabase or PGlite database.

Tasks:

- Apply the four SQL files in timestamp order on staging only.
- Leave `create_organization_for_user` in place.
- Confirm RLS, immutability triggers, and service-role grants.

Acceptance: `modules/affiliates/ledger.pg.test.ts` passes against that schema. Production is unchanged.

## Phase C — Flags stay off in production

Code already checks:

- `POSTBUS_AFFILIATES_ENABLED`
- `POSTBUS_AFFILIATE_ACCRUAL_ENABLED`
- `POSTBUS_AFFILIATE_PAYOUTS_ENABLED`

Tasks before any environment is switched on:

- Set `POSTBUS_AFFILIATE_COOKIE_SECRET` to a random value of at least 32 characters.
- Confirm `INTEGRATION_ENCRYPTION_KEY` and `ADMIN_ACCOUNT_ACTION_PIN` exist in that environment.
- Do not commit those values.

Acceptance: with the variables unset or not equal to `true`, signup, organization create, webhook processing, and the billing cron behave as they do today.

## Phase D — Registration and admin approval

Already implemented:

- `POST /api/partner/application`
- `affiliate_admin_action` action `status`
- Primary link insert on approval
- Rejection reason and notification row

Finish only if review finds a UI hole. Do not add a second application table.

Acceptance: a second application for the same user returns conflict. A non-admin cannot approve. Approval writes an audit row and one primary link.

## Phase E — Links, clicks, attribution

Already implemented:

- Opaque 24-character codes.
- Homepage rewrite only when the master flag is on.
- Signed cookie and `affiliate_bind_signup`.
- `affiliate_create_organization` first-touch insert.

Acceptance: an existing member does not get a new attribution. A self-link does not attribute. An expired claim does not attribute. Tests 6 and 8 in the test plan stay green.

## Phase F — Commission accuracy

Already implemented in `affiliate_accrue` and `runAffiliateSweep`.

Operating rule before the accrual flag: super admin records tax evidence for the payment. Until that row exists, accrue returns `TAX_REVIEW` and inserts no commission.

Acceptance: one commission per payment, a second renewal payment can accrue, duplicate webhooks do not duplicate ledger rows, failed or AI-credit payments stay ineligible, refunds append reversals, and a later policy row does not change the stored amount.

## Phase G — Payouts

Already implemented as manual UPI payouts.

Acceptance: concurrent reservations cannot spend the same balance, duplicate settlement does not pay twice, suspension blocks new payout requests and does not delete existing ledger rows.

## Phase H — Dashboards

Partner and admin screens already call the SQL projections. Any UI work must keep using those responses. Empty and disabled states stay honest. No sample analytics.

Share buttons, if added, are links only:

- WhatsApp `https://wa.me/?text=<encoded url>`
- Facebook sharer URL
- LinkedIn share URL

QR stays on `/api/partner/qr` for a code the signed-in partner owns.

## Phase I — Explicitly not in this release

- RazorpayX.
- Public `PB12345` aliases.
- Automatic GST parsing.
- India Post or storefront payment hooks.
- Production migration and Coolify deploy.

## Dependencies

Schema phase before any flag. Cookie secret before referral traffic. Tax procedure before accrual. Encryption key and admin PIN before payout accounts and admin mutations. Master flag before either of the other two flags.

## Acceptance for the whole plan

The ten scenarios in `POSTBUS_AFFILIATE_TEST_PLAN.md` pass. Production billing webhooks, merchant onboarding, and India Post flows are unchanged while flags are off.
