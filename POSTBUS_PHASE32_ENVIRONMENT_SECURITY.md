# POSTBUS PHASE 3.2 — ENVIRONMENT SECURITY

Classification: **PARTIAL** locally; hosted staging **NOT STARTED**.

## Effective local Next runtime (`.env.local`)

Verified previously and not rewritten: production Supabase `hgacoeoovjxkzfbesmvl`. Service-role and publishable keys live in env files (gitignored via `.env*`). They are not printed here.

`NEXT_PUBLIC_*` must not carry the service-role key. No change this phase to expose one.

## Isolation controls

- `lib/env/staging-isolation.ts`: `PRODUCTION_SUPABASE_REF`, `assertNonProductionMutationTarget`, `assertStagingRuntimeEnv` (missing URL, production URL, `rzp_live_`, payouts=true, tax invoice=true all throw).
- `modules/affiliates/tax-evidence.ts` `assertAffiliateStagingTarget` fail-closed reasons: `missing_project_ref`, `production_project`, `production_hostname`, `environment_not_staging`, `staging_not_approved`, `remote_write_not_authorized`.
- `.gitignore`: `.env*`, `/.next-verify/`, `/.staging/`. Exception: `.env.example`, `.env.staging.example`.

## Silent production fallback

`npm run next dev` (ordinary) still uses `.env.local` production. That is why Partner Dashboard cannot load affiliate tables. `npm run dev:staging` refuses to start without a non-production `.env.staging.local`.

## Feature flags (templates / local UI)

| Flag | `.env.example` default | `.env.staging.example` | `.env.development.local` | Production this phase |
| --- | --- | --- | --- | --- |
| `POSTBUS_AFFILIATES_ENABLED` | false | true (template only) | true (local UI) | not changed |
| `POSTBUS_AFFILIATE_ACCRUAL_ENABLED` | false | false | unset | not changed |
| `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` | false | false | unset | OFF |
| `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` | false | false | unset | not changed |
| `POSTBUS_BILLING_GST_INCLUSIVE_LABEL` | (see example) | not forced on | unset | not changed |
| `POSTBUS_BILLING_TAX_INVOICE_ENABLED` | false | false | unset | OFF |

Payouts and tax invoice issuance stay OFF in all authorized templates.

## Razorpay / India Post / notifications

No live keys used for test writes. Staging Razorpay test-mode **UNVERIFIED** (no approved test keys/webhook). India Post booking tests not run. Production Coolify env not overwritten.
