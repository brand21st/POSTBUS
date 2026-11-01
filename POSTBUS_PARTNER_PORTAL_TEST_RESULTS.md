# Test results

Date: 17 Oct 2026. Local only.

## Automated

- `npx vitest run lib/security/origin.test.ts modules/affiliates/policy.test.ts modules/affiliates/api.test.ts modules/affiliates/ledger.pg.test.ts`
- 4 files, 60 passed, including new portal reporting PGlite case and campaign landing rejection.
- `npx tsc --noEmit` exit 0.

## Browser

- Journey 1: `http://127.0.0.1:3000/partner/login` with `Post@post.com`. Sign in succeeded. Landed on `/partner/dashboard`.
- Dashboard/links: API `/api/partner/me` returns “Partner reporting tables are not installed on this database yet.” (schema missing on remote project). Metrics, date-range, copy-link, QR download, referral pagination, profile persist: UNVERIFIED against live data.
- Payouts page route exists. Transfer execution not exercised. Flag remains off.

## RLS / financial

Covered in PGlite suite already: own-row reads, denied writes, immutable commissions, no IP column, first-touch signup.
