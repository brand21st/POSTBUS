# POSTBUS PHASE 2.8 — FINAL REPORT

Environment: implemented and verified locally where noted. Not verified on staging. Not deployed.

## 1. Executive summary

The pricing toggle failed because the Next.js 16 development server refused the hot-reload socket for `127.0.0.1`, so React never hydrated. Allowing that development origin, and keeping the HMR path out of the session proxy, made the toggle update yearly and monthly prices in headless Chrome. Merchant and admin invoice lists now filter and paginate on the server. Issuance stays off. No remote database was changed.

## 2. Existing system audit

See `POSTBUS_PHASE28_GAP_AUDIT.md`. Billing, affiliates, and the receipt invoice path were not rebuilt.

## 3. Hydration root cause

Next.js 16.3.8 waits for the dev debug-channel websocket before `hydrateRoot`. The server log blocked `/_next/hmr` from `127.0.0.1` as cross-origin. Chrome reported `net::ERR_INVALID_HTTP_RESPONSE`. No React root was committed. `http://localhost:3000` hydrated and the toggle worked, which isolates the cause to that dev origin check.

## 4. Hydration fix status

COMPLETE for the development server. `allowedDevOrigins: ["127.0.0.1"]` in `next.config.ts`. `proxy.ts` excludes `_next/hmr` and `_next/webpack-hmr`. Verified locally. Production build UNVERIFIED.

## 5. Monthly/yearly pricing verification

VERIFIED LOCALLY. Yearly shows ₹4,790.40, ₹14,390.40, and ₹33,600.00 per year. Monthly returns ₹499.00, ₹1,499.00, and ₹3,500.00 per month. Viewport width was 390.

## 6. Business plan price mismatch

BLOCKED. Catalog ₹3,500 and seed ₹5,500 were both left unchanged.

## 7. Merchant billing dashboard

PARTIAL. Implemented locally on `/dashboard/billing`. Logged-in browser use is UNVERIFIED.

## 8. Invoice search and pagination

IMPLEMENTED LOCALLY. Server-side page, search, status, payment status, and date filters. Browser use UNVERIFIED.

## 9. PDF preview and download

PARTIAL. Authenticated streaming and preview labeling are in place. A signed-in download was not executed.

## 10. Super Admin invoice management

PARTIAL. Filters, captured-payment count, issued count, and audit rows are implemented locally. Browser use UNVERIFIED.

## 11. Invoice issuance safety

COMPLETE as a disabled gate. `POSTBUS_BILLING_TAX_INVOICE_ENABLED` was not set. The issue API still returns an error while it is off.

## 12. Invoice numbering concurrency

BLOCKED. Sequential PGlite proof exists. No disposable PostgreSQL server was available for two sessions.

## 13. GST-inclusive billing verification

COMPLETE. Prices stay GST-inclusive. No rate was assumed. The public label flag stays off.

## 14. Affiliate commission integration

VERIFIED LOCALLY through the existing affiliate tests. No second ledger. Payouts were not enabled.

## 15. Financial reconciliation

COMPLETE as read-only. Categories match the existing SQL function. It does not write financial rows.

## 16. Supabase security and RLS

PARTIAL. Local grants and a cross-organization PGlite read passed. Hosted RLS is UNVERIFIED.

## 17. Automated test results

`npx tsc --noEmit` exited 0.

`npx vitest run` on the billing, invoice, affiliate, webhook, header, role, and proxy-matcher files: 13 files, 105 tests, all passed.

## 18. Browser test results

Journey A passed in headless Chrome. Journeys B–E were not executed. Details are in `POSTBUS_PHASE28_BROWSER_TEST_RESULTS.md`.

## 19. Files modified

- `next.config.ts`
- `proxy.ts`
- `modules/billing/subscription-invoice.ts`
- `modules/billing/subscription-invoice.test.ts`
- `modules/billing/subscription-invoice-access.ts`
- `lib/api/v1/billing.ts`
- `app/dashboard/billing/page.tsx`
- `app/(admin)/admin/invoices/page.tsx`
- `lib/security/proxy-matcher.test.ts`
- The twelve `POSTBUS_PHASE28_*.md` reports

## 20. Database migrations created

None. `20261017140000_subscription_tax_invoices.sql` was not edited and was not applied remotely.

## 21. Staging readiness

BLOCKED. The staging gate was not bypassed.

## 22. Production readiness

NOT STARTED. No deploy, flag change, price change, or production SQL.

## 23. Known blockers

Business price. Supplier GSTIN and statutory numbering. Credit notes. Multi-session numbering. Hosted RLS. Logged-in billing and admin browser passes. Production-build hydration pass.

## 24. Required business approvals

GST rate, place of supply, supplier legal identity and GSTIN, invoice series, financial-year rule, cancellation treatment, and the Business plan price.

## 25. Recommended next action

Approve an isolated staging project, then apply the seven local SQL files with issuance still off. Run two PostgreSQL sessions against `subscription_allocate_invoice_number` on that database only.
