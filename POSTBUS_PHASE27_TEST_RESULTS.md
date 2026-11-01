# PostBus Phase 2.7 test results

Executed in this session on 17 October 2026.

## TypeScript

`npx tsc --noEmit` exited 0.

## Automated tests

```
npx vitest run modules/billing/subscription-invoice.test.ts modules/billing/subscription-invoice.pg.test.ts modules/billing/inclusive-tax.test.ts modules/billing/inclusive-tax.pg.test.ts modules/affiliates/policy.test.ts modules/affiliates/api.test.ts modules/affiliates/reconcile.test.ts modules/affiliates/ledger.pg.test.ts app/api/affiliate-referral/route.test.ts modules/billing/webhooks.test.ts
```

Result: 10 files passed, 97 tests passed, exit 0. Duration 2.36s. The previous Phase 2.6 baseline was 89 tests. These 97 include that set plus the invoice cases in the two new files.

## Invoice cases that ran

- Checkout uses the stored paise amount, including a ₹3,500 catalog fixture and a ₹5,500 seed fixture, without choosing between them.
- Issuance flag defaults off.
- 17 October 2026 formats as `2026-27`. 31 March 2026 formats as `2025-26`. Sequence 1 formats as `PB/2026-27/000001`.
- A missing approved policy and a missing supplier GSTIN block readiness.
- An empty customer GSTIN is allowed when name and address exist.
- Preview PDF bytes start with `%PDF-`. Titles differ for preview and issued documents.
- PGlite issues `PB/2026-27/000001` once, the repeat call returns the same number, the invoice count stays 1, the payment amount stays 149900, update raises, and reconcile returns `MATCHED`.
- Empty supplier GSTIN and a non-admin actor raise.
- A cross-organization payload raises.
- An authenticated member of another organization reads zero rows.
- Reconcile returns `MISSING_INVOICE` before issuance.

## Not executed as separate cases

Concurrent issuance from two database sessions, a full refund webhook matrix, annual renewal issuance, and hosted RLS were not separate new tests. Affiliate accrual, webhook idempotency, and inclusive-tax behavior remain covered by the existing files in the 97.

## Browser

`http://127.0.0.1:3000/pricing` returned the catalog JSON-LD above. The Yearly control did not change the displayed amounts because the dev client did not commit hydration. Merchant billing, PDF download, and `/admin/invoices` were not opened in a logged-in session.
